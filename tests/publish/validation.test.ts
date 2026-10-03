import { describe, expect, test } from "bun:test";
import {
  containsUrlUnsafeFilename,
  normalizeLinkUrl,
  PUBLISH_TAGS_MIN,
  validateLink,
  validatePublish,
  validatePushQuality,
} from "../../app/logic/publish/validation";
import {
  createUploadItem,
  sanitizeFileName,
} from "../../app/routes/resource/publish/components/uploadUtils";

const image = { file: new Blob(), width: 100, height: 100 };
const coverImage = { file: new Blob(), width: 150, height: 100 };
const validInput = {
  itemId: "com.example.app",
  itemName: "Example",
  description: "一个示例资源，用于演示各项功能。",
  tags: ["tool", "demo", "sample"],
  previews: [{ ...coverImage, id: "preview" }],
  icon: image,
  cover: null,
  usePreviewAsCover: true,
  coverPreviewId: "preview",
  downloads: [{ platformId: "device", version: "1.0", file: image }],
  trialDownloads: [],
  links: [],
  enableAstroBoxCreatorFeatures: false,
};

describe("publish validation", () => {
  test("简介为空时拦截发布并说明它参与算法与推流", () => {
    for (const description of ["", "   ", "\n\t "]) {
      const joined = validatePublish({ ...validInput, description }).errors.join();
      expect(joined).toContain("请填写资源简介");
      expect(joined).toContain("参与算法与推流");
    }
  });

  test("标签数量不足时拦截发布并说明它参与搜索与推流", () => {
    // 下限为 3：恰好 3 个通过，2 个拦截
    expect(PUBLISH_TAGS_MIN).toBe(3);
    expect(
      validatePublish({ ...validInput, tags: ["a", "b", "c"] }).errors,
    ).toEqual([]);
    const joined = validatePublish({ ...validInput, tags: ["a", "b"] }).errors.join();
    expect(joined).toContain("标签数量不足");
    expect(joined).toContain("参与搜索与推流");
    expect(joined).toContain("与资源功能贴合");
    expect(
      validatePublish({ ...validInput, tags: [] }).errors.join(),
    ).toContain("标签数量不足");
  });

  test("空白标签不计入有效数量", () => {
    // 3 个有效标签 + 若干空白段：空白不算数也不影响通过
    expect(
      validatePushQuality("简介", ["a", " ", "b", "", "  ", "c"]),
    ).toEqual([]);
    // 去掉 c 后只剩 2 个有效标签，应拦截
    expect(validatePushQuality("简介", ["a", " ", "b", ""])).toHaveLength(1);
  });

  test("简介与标签同时不合规时两条错误都给出", () => {
    const issues = validatePushQuality("", ["only-one"]);
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.message).join()).toContain("请填写资源简介");
    expect(issues.map((issue) => issue.message).join()).toContain("标签数量不足");
    // 字段归属决定滚动闪烁的落点
    expect(issues.map((issue) => issue.field)).toEqual(["description", "tags"]);
  });

  test("每条校验项都带字段归属，供滚动闪烁定位", () => {
    expect(validatePushQuality("", []).map((issue) => issue.field)).toEqual([
      "description",
      "tags",
    ]);
    const cases: Array<[Parameters<typeof validatePublish>[0], string]> = [
      [{ ...validInput, itemName: " " }, "itemName"],
      [{ ...validInput, itemId: "" }, "itemId"],
      [{ ...validInput, resourceType: "res_pack", itemId: "Bad Id" }, "itemId"],
      [{ ...validInput, icon: null }, "icon"],
      [{ ...validInput, previews: [] }, "previews"],
      [{ ...validInput, cover: null, usePreviewAsCover: false }, "cover"],
      [{ ...validInput, downloads: [] }, "downloads"],
      [
        {
          ...validInput,
          downloads: [{ platformId: "", version: "", file: null }],
        },
        "downloads",
      ],
      [
        {
          ...validInput,
          trialDownloads: [{ platformId: "d", version: "", file: null }],
        },
        "trialDownloads",
      ],
      [{ ...validInput, links: [{ icon: "i", title: "t", url: "http://x" }] }, "links"],
      // 加密一致性错误落在 ext 的开关上，不是下载行
      [
        {
          ...validInput,
          downloads: [
            {
              platformId: "device",
              version: "1.0",
              file: image,
              encryptOnUpload: true,
            },
          ],
        },
        "creatorFeatures",
      ],
    ];
    for (const [input, field] of cases) {
      const issues = validatePublish(input).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].field).toBe(field as never);
    }
  });

  test("开了 ext 开关但既无加密也无付费映射时拦截", () => {
    // 已确认下载配置里没有付费平台映射，且没有任何设备开加密 → 拦截
    const blocked = validatePublish({
      ...validInput,
      enableAstroBoxCreatorFeatures: true,
      hasPaidPlatformMapping: false,
    }).errors.join();
    expect(blocked).toContain("多请求一次拿不到内容的购买信息");
    expect(
      validatePublish({
        ...validInput,
        enableAstroBoxCreatorFeatures: true,
        hasPaidPlatformMapping: false,
      }).issues.some((issue) => issue.field === "creatorFeatures"),
    ).toBe(true);

    // 有加密包体 → 放行
    expect(
      validatePublish({
        ...validInput,
        enableAstroBoxCreatorFeatures: true,
        hasPaidPlatformMapping: false,
        downloads: [
          {
            platformId: "device",
            version: "1.0",
            file: image,
            encryptOnUpload: true,
          },
        ],
      }).errors,
    ).toEqual([]);

    // 有付费平台映射 → 放行
    expect(
      validatePublish({
        ...validInput,
        enableAstroBoxCreatorFeatures: true,
        hasPaidPlatformMapping: true,
      }).errors,
    ).toEqual([]);

    // 开关关着 → 本条不适用
    expect(
      validatePublish({
        ...validInput,
        hasPaidPlatformMapping: false,
      }).errors,
    ).toEqual([]);
  });

  test("付费映射尚未查出时不拦截（fail-open）", () => {
    expect(
      validatePublish({
        ...validInput,
        enableAstroBoxCreatorFeatures: true,
      }).errors,
    ).toEqual([]);
    expect(
      validatePublish({
        ...validInput,
        enableAstroBoxCreatorFeatures: true,
        hasPaidPlatformMapping: undefined,
      }).errors,
    ).toEqual([]);
  });

  test("资源 ID 格式不合规时拦截发布（按资源类型）", () => {
    // 资源包：只允许小写字母、数字、下划线、连字符
    expect(
      validatePublish({ ...validInput, resourceType: "res_pack", itemId: "My Theme" })
        .errors.join(),
    ).toContain("小写字母");
    expect(
      validatePublish({ ...validInput, resourceType: "res_pack", itemId: "奶蛙" })
        .errors.join(),
    ).toContain("小写字母");
    expect(
      validatePublish({ ...validInput, resourceType: "res_pack", itemId: "a".repeat(65) })
        .errors.join(),
    ).toContain("最长");
    expect(
      validatePublish({ ...validInput, resourceType: "res_pack", itemId: "my-theme" })
        .errors,
    ).toEqual([]);

    // 表盘与模块沿用各自既有规则
    expect(
      validatePublish({ ...validInput, resourceType: "watchface", itemId: "123456789012" })
        .errors.join(),
    ).toContain("9798");
    // 模块不再强制 canopus_ 前缀，仅校验模块名字符集
    expect(
      validatePublish({ ...validInput, resourceType: "canopus", itemId: "bluetooth" })
        .errors,
    ).toEqual([]);
    expect(
      validatePublish({ ...validInput, resourceType: "canopus", itemId: "蓝牙.音频" })
        .errors.join(),
    ).toContain("仅支持");
  });

  test("未指定资源类型时不对 ID 做格式校验", () => {
    expect(validatePublish(validInput).errors).toEqual([]);
  });

  test("accepts complete input and rejects required fields and rows", () => {
    expect(validatePublish(validInput).errors).toEqual([]);
    const result = validatePublish({
      ...validInput,
      itemId: "",
      itemName: "",
      previews: [],
      icon: { ...image, width: 100, height: 90 },
      downloads: [{ platformId: "", version: "", file: null }],
      trialDownloads: [{ platformId: "device", version: "", file: null }],
    });
    expect(result.errors.join(" ")).toContain("资源名称");
    expect(result.errors.join(" ")).toContain("资源 ID");
    expect(result.errors.join(" ")).toContain("正方形");
    expect(result.errors.join(" ")).toContain("预览图");
    expect(result.errors.join(" ")).toContain("正式下载第 1 行");
    expect(result.errors.join(" ")).toContain("试用下载第 1 行");
  });

  test("rejects cover with wrong aspect ratio or over 1MB", () => {
    const wrongRatioPreview = validatePublish({
      ...validInput,
      previews: [{ ...image, id: "preview" }],
    });
    expect(wrongRatioPreview.errors.join(" ")).toContain("3:2");

    const wrongRatioUpload = validatePublish({
      ...validInput,
      usePreviewAsCover: false,
      coverPreviewId: null,
      cover: image,
    });
    expect(wrongRatioUpload.errors.join(" ")).toContain("3:2");

    const oversized = validatePublish({
      ...validInput,
      usePreviewAsCover: false,
      coverPreviewId: null,
      cover: { ...coverImage, file: new Blob([new Uint8Array(1024 * 1024 + 1)]) },
    });
    expect(oversized.errors.join(" ")).toContain("1MB");

    const unreadable = validatePublish({
      ...validInput,
      usePreviewAsCover: false,
      coverPreviewId: null,
      cover: { file: new Blob() },
    });
    expect(unreadable.errors.join(" ")).toContain("无法读取");
  });

  test("reports invalid links without blocking publishing", () => {
    expect(validateLink({ icon: "", title: "", url: "" })).toBeNull();
    expect(validateLink({ icon: "Link", title: "", url: "" })).toContain("标题、网址");
    expect(validateLink({ icon: "", title: "Site", url: "https://example.com" })).toContain("图标");
    expect(validateLink({ icon: "Link", title: "Site", url: "http://example.com" })).toContain("HTTPS");
    expect(validateLink({ icon: "Link", title: "Site", url: "https://example.com" })).toBeNull();
    expect(validateLink({ icon: "Link", title: "Site", url: "`https://example.com`" })).toBeNull();
    expect(normalizeLinkUrl("`https://example.com`")).toBe("https://example.com");
    const result = validatePublish({
      ...validInput,
      links: [{ icon: "Link", title: "Site", url: "http://example.com" }],
    });
    expect(result.errors.join(" ")).toContain("外部链接填写不完整");
    expect(result.linkErrors[0]).toContain("HTTPS");
  });

  test("rejects referenced filenames containing URL-unsafe characters", () => {
    const result = validatePublish({
      ...validInput,
      previews: [
        { ...coverImage, id: "p1", name: "20260817111124#2.png" },
        { ...coverImage, id: "p2", name: "clean.png" },
      ],
      downloads: [
        { platformId: "device", version: "1.0", file: image, existingFileName: "pkg?1.bin" },
      ],
    });
    const joined = result.errors.join(" ");
    expect(joined).toContain("重命名后重新上传");
    expect(joined).toContain("预览图 1「20260817111124#2.png」");
    expect(joined).toContain("正式包「pkg?1.bin」");
    expect(joined).not.toContain("clean.png");

    const clean = validatePublish({
      ...validInput,
      previews: [{ ...coverImage, id: "p2", name: "clean.png" }],
      cover: null,
      usePreviewAsCover: true,
      coverPreviewId: "p2",
    });
    expect(clean.errors.filter((e) => e.includes("重命名"))).toEqual([]);
  });

  test("requires enableAstroBoxCreatorFeatures when a download row is encrypted", () => {
    const encryptedRow = {
      platformId: "device",
      version: "1.0",
      file: image,
      encryptOnUpload: true,
    };

    // 加密上传但未开启开关：拦截，并点名具体设备
    const blocked = validatePublish({
      ...validInput,
      downloads: [encryptedRow],
      enableAstroBoxCreatorFeatures: false,
    });
    const joined = blocked.errors.join(" ");
    expect(joined).toContain("启用购买与资源加密相关功能");
    expect(joined).toContain("device");
    expect(joined).toContain("不解密");

    // 加密上传且已开启开关：放行
    const allowed = validatePublish({
      ...validInput,
      downloads: [encryptedRow],
      enableAstroBoxCreatorFeatures: true,
    });
    expect(allowed.errors).toEqual([]);

    // 未加密且未开启开关：与本次改动无关，不产生提示
    expect(validatePublish(validInput).errors).toEqual([]);

    // encryptOnUpload 为 false / undefined 均视为未加密
    expect(
      validatePublish({
        ...validInput,
        downloads: [{ ...encryptedRow, encryptOnUpload: false }],
      }).errors,
    ).toEqual([]);

    // 多设备加密时列出全部设备标识
    const multi = validatePublish({
      ...validInput,
      downloads: [
        encryptedRow,
        { platformId: "device2", version: "1.0", file: image, encryptOnUpload: true },
      ],
      enableAstroBoxCreatorFeatures: false,
    }).errors.join(" ");
    expect(multi).toContain("device、device2");

    // 试用包体不支持加密上传，即便误带 encryptOnUpload 也不参与判断
    expect(
      validatePublish({
        ...validInput,
        trialDownloads: [encryptedRow],
        enableAstroBoxCreatorFeatures: false,
      }).errors,
    ).toEqual([]);
  });
});

describe("filename sanitization", () => {
  test("detects URL-unsafe characters", () => {
    expect(containsUrlUnsafeFilename("a#b.png")).toBe(true);
    expect(containsUrlUnsafeFilename("a?b.png")).toBe(true);
    expect(containsUrlUnsafeFilename("100%.png")).toBe(true);
    expect(containsUrlUnsafeFilename("Frame 6-2 1.png")).toBe(false);
  });

  test("sanitizeFileName replaces unsafe characters with dashes", () => {
    expect(sanitizeFileName("20260817111124#2.png")).toBe("20260817111124-2.png");
    expect(sanitizeFileName("a?b%c.png")).toBe("a-b-c.png");
    expect(sanitizeFileName("clean.png")).toBe("clean.png");
  });

  test("createUploadItem keeps safe filenames untouched", () => {
    const item = createUploadItem(new File([new Uint8Array([1])], "shot3.png"));
    expect(item.name).toBe("shot3.png");
    expect(containsUrlUnsafeFilename(item.name)).toBe(false);
  });
});
