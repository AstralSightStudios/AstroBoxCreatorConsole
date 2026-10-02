import { describe, expect, test } from "bun:test";
import { deflateSync } from "fflate";
import {
  CORONA_MANIFEST_NAME,
  LEGACY_CORONA_MANIFEST_NAME,
  byteLengthUtf8,
  estimateTsvBytes,
  parseCrpack,
  readCrpackThemeId,
  rewriteCrpackCorona,
  validateCrpack,
} from "../../app/logic/publish/crpack-validate";

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// 手工 zip 构造器：能造出 fflate 造不出来的畸形包（重复路径、路径穿越、
// 声明尺寸造假、加密标志、非法压缩方式等）。
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntrySpec {
  path: string;
  data: Uint8Array;
  /** 0 = Stored，8 = Deflated。 */
  method?: number;
  flags?: number;
  /** 覆盖声明的解压后尺寸（用于模拟中央目录撒谎）。 */
  declaredSize?: number;
  /** 原始压缩数据，指定后忽略 method 自动压缩。 */
  rawPayload?: Uint8Array;
  /** 覆盖中央目录的外部属性（Unix 文件类型放在高 16 位）。 */
  externalAttrs?: number;
}

const UNIX_FILE = 0o100644;
const DEFAULT_VERSION_MADE_BY = 0x0314; // Unix / version 2.0

function buildZip(specs: ZipEntrySpec[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const spec of specs) {
    const method = spec.method ?? 0;
    const nameBytes = enc.encode(spec.path);
    const payload = spec.rawPayload ?? (method === 8 ? deflateSync(spec.data) : spec.data);
    const declared = spec.declaredSize ?? spec.data.length;
    const crc = crc32(spec.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, method === 8 ? 20 : 10, true);
    lv.setUint16(6, spec.flags ?? 0, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, declared, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, DEFAULT_VERSION_MADE_BY, true);
    cv.setUint16(6, method === 8 ? 20 : 10, true);
    cv.setUint16(8, spec.flags ?? 0, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, declared, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(38, spec.externalAttrs ?? ((UNIX_FILE << 16) >>> 0), true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, specs.length, true);
  ev.setUint16(10, specs.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function manifestJson(patch: Record<string, unknown> = {}): Uint8Array {
  return enc.encode(
    JSON.stringify(
      {
        format: "canopus-resource-pack",
        formatVersion: 1,
        themeId: "theme",
        name: "Test Theme",
        mappings: [],
        ...patch,
      },
      null,
      2,
    ),
  );
}

/** 一个结构合法的最小包。 */
function pack(patch: Record<string, unknown> = {}, files: ZipEntrySpec[] = []): Uint8Array {
  return buildZip([
    { path: CORONA_MANIFEST_NAME, data: manifestJson(patch) },
    ...files,
  ]);
}

function errorsOf(bytes: Uint8Array, expected?: string): string[] {
  return validateCrpack(bytes, expected);
}

// ---------------------------------------------------------------------------

describe("crpack 容器识别", () => {
  test("合法包通过全部校验", () => {
    const bytes = pack({}, [{ path: "app/a.bin", data: new Uint8Array([1, 2, 3]) }]);
    expect(errorsOf(bytes, "theme")).toEqual([]);
  });

  test("非 zip 文件被拒绝", () => {
    const errors = validateCrpack(enc.encode("not a zip at all"));
    expect(errors[0]).toContain("不是有效的 CRPack");
  });

  test("缺清单被拒绝", () => {
    const errors = validateCrpack(buildZip([{ path: "app/a.bin", data: new Uint8Array([1]) }]));
    expect(errors[0]).toContain(`未找到根目录清单 ${CORONA_MANIFEST_NAME}`);
  });

  test(`legacy ${LEGACY_CORONA_MANIFEST_NAME} 被拒绝且提示 Builder 版本`, () => {
    const bytes = buildZip([
      { path: LEGACY_CORONA_MANIFEST_NAME, data: manifestJson() },
      { path: "app/a.bin", data: new Uint8Array([1]) },
    ]);
    const errors = errorsOf(bytes, "theme");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("canora.json");
    expect(errors[0]).toContain("1.0.6");
  });

  test("两个清单同存按歧义拒绝", () => {
    const bytes = buildZip([
      { path: CORONA_MANIFEST_NAME, data: manifestJson() },
      { path: LEGACY_CORONA_MANIFEST_NAME, data: manifestJson() },
    ]);
    expect(errorsOf(bytes)[0]).toContain("无法判定使用哪个清单");
  });

  test("清单是目录项被拒绝", () => {
    const bytes = buildZip([{ path: `${CORONA_MANIFEST_NAME}/`, data: new Uint8Array(0) }]);
    expect(errorsOf(bytes)[0]).toContain("必须是文件");
  });

  test("加密条目被拒绝", () => {
    const bytes = buildZip([
      { path: CORONA_MANIFEST_NAME, data: manifestJson() },
      { path: "app/a.bin", data: new Uint8Array([1, 2]), flags: 0x01 },
    ]);
    expect(errorsOf(bytes)[0]).toContain("加密条目");
  });

  test("非法压缩方式被拒绝", () => {
    const bytes = buildZip([
      { path: CORONA_MANIFEST_NAME, data: manifestJson() },
      { path: "app/a.bin", data: new Uint8Array([1, 2]), method: 12 },
    ]);
    expect(errorsOf(bytes)[0]).toContain("压缩方式");
  });

  test("符号链接被拒绝", () => {
    const bytes = pack({}, [
      { path: "app/link.bin", data: enc.encode("/etc/passwd"), externalAttrs: (0o120777 << 16) >>> 0 },
    ]);
    expect(errorsOf(bytes)[0]).toContain("符号链接");
  });

  test("特殊文件（FIFO / socket）被拒绝", () => {
    const fifo = pack({}, [
      { path: "app/pipe", data: new Uint8Array([1]), externalAttrs: (0o010644 << 16) >>> 0 },
    ]);
    expect(errorsOf(fifo)[0]).toContain("特殊文件");
  });
});

describe("crpack 路径安全", () => {
  const badPaths = [
    ["../escape.bin", "路径穿越"],
    ["/abs.bin", "绝对路径"],
    ["app\\a.bin", "反斜杠"],
    ["app//a.bin", "空段"],
    ["app/./a.bin", "路径穿越"],
    ["app/../a.bin", "路径穿越"],
  ] as const;

  for (const [path, hint] of badPaths) {
    test(`${path} 被拒绝（${hint}）`, () => {
      const bytes = buildZip([
        { path: CORONA_MANIFEST_NAME, data: manifestJson() },
        { path, data: new Uint8Array([1]) },
      ]);
      expect(errorsOf(bytes)[0]).toContain("包内条目");
    });
  }

  test("重复路径被拒绝", () => {
    const bytes = buildZip([
      { path: CORONA_MANIFEST_NAME, data: manifestJson() },
      { path: "app/a.bin", data: new Uint8Array([1]) },
      { path: "app/a.bin", data: new Uint8Array([2]) },
    ]);
    expect(errorsOf(bytes)[0]).toContain("重复条目");
  });

  test("包内携带 mappings.tsv 被拒绝", () => {
    const bytes = pack({}, [{ path: "themes/theme/mappings.tsv", data: new Uint8Array([1]) }]);
    expect(errorsOf(bytes)[0]).toContain("mappings.tsv");
  });

  test("设备端路径达到 256 字节被拒绝，255 字节通过", () => {
    const atLimit = pack(
      { themeId: "t" },
      [{ path: `a${"b".repeat(204)}`, data: new Uint8Array([1]) }],
    );
    expect(errorsOf(atLimit, "t")).toEqual([]);

    const overLimit = pack(
      { themeId: "t" },
      [{ path: `a${"b".repeat(205)}`, data: new Uint8Array([1]) }],
    );
    expect(errorsOf(overLimit, "t").join("\n")).toContain("设备端路径");
  });
});

describe("crpack 清单字段", () => {
  test("format / formatVersion 错误被拒绝", () => {
    expect(errorsOf(pack({ format: "wrong" }), "theme").join("\n")).toContain("format");
    expect(errorsOf(pack({ formatVersion: 2 }), "theme").join("\n")).toContain("formatVersion");
  });

  test("themeId 边界：64 通过、65 拒绝", () => {
    expect(errorsOf(pack({ themeId: "a".repeat(64) }))).toEqual([]);
    const tooLong = errorsOf(pack({ themeId: "a".repeat(65) }));
    expect(tooLong.join("\n")).toContain("themeId");
  });

  test("themeId 含中文 / 大写 / 点号被拒绝", () => {
    expect(errorsOf(pack({ themeId: "奶蛙" })).join("\n")).toContain("themeId");
    expect(errorsOf(pack({ themeId: "Dawn" })).join("\n")).toContain("themeId");
    expect(errorsOf(pack({ themeId: "a.b" })).join("\n")).toContain("themeId");
  });

  test("themeId 与预期资源 id 不一致被拒绝", () => {
    const errors = errorsOf(pack({ themeId: "other" }), "theme");
    expect(errors.join("\n")).toContain("与资源 ID");
  });

  test("name 为空或超长被拒绝", () => {
    expect(errorsOf(pack({ name: "  " })).join("\n")).toContain("name");
    expect(errorsOf(pack({ name: "n".repeat(129) })).join("\n")).toContain("name");
  });

  test("version / author / description / targets 越界被拒绝", () => {
    expect(errorsOf(pack({ version: "v".repeat(65) })).join("\n")).toContain("version");
    expect(errorsOf(pack({ author: "a".repeat(129) })).join("\n")).toContain("author");
    expect(errorsOf(pack({ description: "d".repeat(1025) })).join("\n")).toContain("description");
    expect(
      errorsOf(pack({ targets: Array.from({ length: 17 }, (_, i) => `t${i}`) })).join("\n"),
    ).toContain("targets");
    expect(
      errorsOf(pack({ description: "ok\twith\r\ntabs" })),
    ).toEqual([]);
  });

  test("versionCode 缺失、0、上限均通过", () => {
    expect(errorsOf(pack({ versionCode: 1 }))).toEqual([]);
    expect(errorsOf(pack({ versionCode: 0 }))).toEqual([]);
    expect(errorsOf(pack({ versionCode: 2147483647 }))).toEqual([]);
    expect(errorsOf(pack())).toEqual([]);
  });

  test("versionCode 字符串 / 负数 / 小数 / 超上限被拒绝", () => {
    expect(errorsOf(pack({ versionCode: "1" })).join("\n")).toContain("versionCode");
    expect(errorsOf(pack({ versionCode: -1 })).join("\n")).toContain("versionCode");
    expect(errorsOf(pack({ versionCode: 1.5 })).join("\n")).toContain("versionCode");
    expect(errorsOf(pack({ versionCode: 2147483648 })).join("\n")).toContain("versionCode");
  });

  test("清单带 BOM 被拒绝", () => {
    const body = manifestJson();
    const withBom = new Uint8Array(body.length + 3);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(body, 3);
    const bytes = buildZip([{ path: CORONA_MANIFEST_NAME, data: withBom }]);
    expect(errorsOf(bytes)[0]).toContain("BOM");
  });

  test("未知字段被保留且不影响校验", () => {
    const bytes = pack({ customField: { keep: [1, 2, 3] } });
    expect(errorsOf(bytes)).toEqual([]);
    const parsed = parseCrpack(bytes);
    expect(parsed.manifest.customField).toEqual({ keep: [1, 2, 3] });
  });
});

describe("crpack 映射规则", () => {
  test("destination 不存在被拒绝", () => {
    const bytes = pack({ mappings: [{ source: "/resource/app/", destination: "app/" }] });
    expect(errorsOf(bytes).join("\n")).toContain("destination");
  });

  test("目录规则的 destination 必须有实际文件前缀命中", () => {
    const good = pack(
      { mappings: [{ source: "/resource/app/", destination: "app/" }] },
      [{ path: "app/a.bin", data: new Uint8Array([1]) }],
    );
    expect(errorsOf(good)).toEqual([]);
  });

  test("source 重复被拒绝", () => {
    const bytes = pack(
      {
        mappings: [
          { source: "/resource/app/", destination: "app/" },
          { source: "/resource/app/", destination: "other/" },
        ],
      },
      [
        { path: "app/a.bin", data: new Uint8Array([1]) },
        { path: "other/b.bin", data: new Uint8Array([1]) },
      ],
    );
    expect(errorsOf(bytes).join("\n")).toContain("重复");
  });

  test("source 非绝对路径被拒绝", () => {
    const bytes = pack(
      { mappings: [{ source: "resource/app/", destination: "app/" }] },
      [{ path: "app/a.bin", data: new Uint8Array([1]) }],
    );
    expect(errorsOf(bytes).join("\n")).toContain("绝对路径");
  });

  test("source 与 destination 斜杠不一致被拒绝", () => {
    const bytes = pack(
      { mappings: [{ source: "/resource/app/", destination: "app/a.bin" }] },
      [{ path: "app/a.bin", data: new Uint8Array([1]) }],
    );
    expect(errorsOf(bytes).join("\n")).toContain("斜杠");
  });

  test("quickappIcons 的 destination 必须是真实存在的小写 .bin", () => {
    const good = pack(
      { quickappIcons: [{ package: "ng.lst.corona", destination: "quickapp-icons/ab12.bin" }] },
      [{ path: "quickapp-icons/ab12.bin", data: new Uint8Array([1]) }],
    );
    expect(errorsOf(good)).toEqual([]);

    const notBin = pack({ quickappIcons: [{ package: "ng.lst.corona", destination: "quickapp-icons/AB12.png" }] }, [
      { path: "quickapp-icons/AB12.png", data: new Uint8Array([1]) },
    ]);
    expect(errorsOf(notBin).join("\n")).toContain(".bin");

    const missing = pack({ quickappIcons: [{ package: "ng.lst.corona", destination: "quickapp-icons/ab12.bin" }] });
    expect(errorsOf(missing).join("\n")).toContain("不存在");
  });

  test("mappings 超过 256 条被拒绝", () => {
    const mappings = Array.from({ length: 257 }, (_, i) => ({
      source: `/resource/${i}/`,
      destination: `d${i}/`,
    }));
    const files = mappings.map((m, i) => ({ path: `${m.destination}f.bin`, data: new Uint8Array([1]) }));
    const bytes = pack({ mappings }, files);
    expect(errorsOf(bytes).join("\n")).toContain("256");
  });
});

describe("TSV 预算实算", () => {
  test("byteLengthUtf8 按 UTF-8 字节算，不是 String.length", () => {
    expect(byteLengthUtf8("abc")).toBe(3);
    expect(byteLengthUtf8("奶蛙")).toBe(6);
    expect(byteLengthUtf8("😀")).toBe(4);
  });

  test("quickappIcons 的行按 @quickapp-icon/<package> 计源，而不是 destination", () => {
    const withKeys = estimateTsvBytes("t", [], [{ package: "ng.lst.corona", destination: "quickapp-icons/ab.bin" }]);
    const manual = byteLengthUtf8("@quickapp-icon/ng.lst.corona") + 1 + byteLengthUtf8("themes/t/") + byteLengthUtf8("quickapp-icons/ab.bin") + 1;
    expect(withKeys).toBe(manual);
  });

  test("含中文的 source 按字节而非码元计费", () => {
    const a = estimateTsvBytes("t", [{ source: "/资源/应用/", destination: "app/" }], []);
    const b = estimateTsvBytes("t", [{ source: "/abc/", destination: "app/" }], []);
    expect(a - b).toBe(byteLengthUtf8("/资源/应用/") - byteLengthUtf8("/abc/"));
    expect(a - b).toBeGreaterThan("/资源/应用/".length - "/abc/".length);
  });

  // 每行 = len("@quickapp-icon/p000") + 1 + len("themes/<themeId>/") + 35 + 1
  // themeId 63 字符时每行恰好 128 字节，256 行 = 32768（正好触顶）。
  function iconPack(themeId: string, ruleCount: number, extraPackageByte = false) {
    const icons = Array.from({ length: ruleCount }, (_, i) => ({
      package: `p${String(i).padStart(3, "0")}${extraPackageByte && i === 0 ? "x" : ""}`,
      destination: `quickapp-icons/${String(i).padStart(16, "0")}.bin`,
    }));
    const files = icons.map((icon) => ({ path: icon.destination, data: new Uint8Array([1]) }));
    return { bytes: pack({ themeId, quickappIcons: icons }, files), ruleCount };
  }

  test("恰好 32768 字节通过", () => {
    const { bytes, ruleCount } = iconPack("a".repeat(63), 256);
    expect(estimateTsvBytes("a".repeat(63), [], Array.from({ length: ruleCount }, (_, i) => ({
      package: `p${String(i).padStart(3, "0")}`,
      destination: `quickapp-icons/${String(i).padStart(16, "0")}.bin`,
    })))).toBe(32768);
    expect(errorsOf(bytes, "a".repeat(63))).toEqual([]);
  });

  test("32769 字节被拒绝", () => {
    const { bytes } = iconPack("a".repeat(63), 256, true);
    expect(errorsOf(bytes, "a".repeat(63)).join("\n")).toContain("32 KiB");
  });

  test("themeId 长度增加 1 字节即推高每行开销并触顶", () => {
    const { bytes } = iconPack("a".repeat(64), 256);
    expect(errorsOf(bytes, "a".repeat(64)).join("\n")).toContain("32 KiB");
  });

  test("超限时文案说明可缩短包标识", () => {
    const { bytes } = iconPack("a".repeat(64), 256);
    expect(errorsOf(bytes, "a".repeat(64)).join("\n")).toContain("缩短包标识");
  });
});

describe("解压字节预算", () => {
  test("按实际解压后大小计费，不信中央目录声明值", () => {
    // 声明只有 1 字节，实际解压 64 MiB+1：应按实际值拒绝。
    const bomb = new Uint8Array(64 * 1024 * 1024 + 1);
    const bytes = buildZip([
      { path: CORONA_MANIFEST_NAME, data: manifestJson() },
      { path: "app/bomb.bin", data: bomb, method: 8, declaredSize: 1 },
    ]);
    expect(errorsOf(bytes)[0]).toContain("超过");
  });
});

describe("读取与改写", () => {
  test("readCrpackThemeId 读出原值，解析失败返回 undefined", () => {
    expect(readCrpackThemeId(pack({ themeId: "original" }))).toBe("original");
    expect(readCrpackThemeId(enc.encode("nope"))).toBeUndefined();
  });

  test("parseCrpack 读出版本、versionCode 与条目", () => {
    const bytes = pack(
      { themeId: "orig", version: "1.0.0", versionCode: 3 },
      [{ path: "app/a.bin", data: new Uint8Array([7]) }],
    );
    const parsed = parseCrpack(bytes);
    expect(parsed.themeId).toBe("orig");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.versionCode).toBe(3);
    expect(parsed.manifestName).toBe(CORONA_MANIFEST_NAME);
    expect(parsed.entries.map((e) => e.path).sort()).toEqual(["app/a.bin", CORONA_MANIFEST_NAME]);
  });

  test("改写 themeId 后校验通过，且只动 themeId", () => {
    const bytes = pack(
      { themeId: "orig", version: "1.0.0", versionCode: 3, custom: "keep-me" },
      [{ path: "app/a.bin", data: new Uint8Array([7]) }],
    );
    const rewritten = rewriteCrpackCorona(bytes, { themeId: "target" });
    expect(errorsOf(rewritten, "target")).toEqual([]);
    const parsed = parseCrpack(rewritten);
    expect(parsed.themeId).toBe("target");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.versionCode).toBe(3);
    expect(parsed.manifest.custom).toBe("keep-me");
  });

  test("连续两次改写产出逐字节一致的包", () => {
    const bytes = pack({ themeId: "orig" }, [{ path: "app/a.bin", data: new Uint8Array([7]) }]);
    const once = rewriteCrpackCorona(bytes, { themeId: "target" });
    const twice = rewriteCrpackCorona(bytes, { themeId: "target" });
    expect(Array.from(once)).toEqual(Array.from(twice));
  });

  test("重打包保留全部资源文件", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `app/launcher/${i}.bin`,
      data: new Uint8Array([i, i + 1]),
    }));
    const bytes = pack({ themeId: "orig" }, files);
    const rewritten = rewriteCrpackCorona(bytes, { themeId: "target" });
    const parsed = parseCrpack(rewritten);
    expect(parsed.entries).toHaveLength(files.length + 1);
    for (const file of files) {
      expect(Array.from(parsed.entries.find((e) => e.path === file.path)!.bytes)).toEqual(
        Array.from(file.data),
      );
    }
  });
});