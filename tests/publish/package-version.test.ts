import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  WATCHFACE_MAGIC,
  readPackageVersion,
  writePackageVersion,
  xiaomiVersionCodeFromVersion,
} from "../../app/logic/publish/package-version";
import { detectRpkDebug } from "../../app/logic/publish/rpk-signature";
import { replaceWatchfaceIdInPackage } from "../../app/logic/publish/watchface-id";

/** 真实小米表盘（SekaiUI 9pro v1.1.2）的前 64 字节：magic + offset4 版本 02 01 01 + offset40 ID。 */
const REAL_XIAOMI_HEADER = new Uint8Array([
  0x5a, 0xa5, 0x34, 0x12, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x06, 0x00, 0x38, 0x0e, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

function xiaomiBinFile(name = "watchface.bin"): File {
  return new File([REAL_XIAOMI_HEADER], name, {
    type: "application/octet-stream",
  });
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2));
}

function readJson(entries: Record<string, Uint8Array>, name: string): any {
  return JSON.parse(new TextDecoder().decode(entries[name]));
}

describe("readPackageVersion - 小米表盘二进制", () => {
  test("解析真实表盘头：1.1.2 / 65794 / 12 位 ID", async () => {
    const info = await readPackageVersion(xiaomiBinFile());
    expect(info.source).toBe("xiaomi-bin");
    expect(info.readable).toBe(true);
    expect(info.writable).toBe(true);
    expect(info.version).toBe("1.1.2");
    expect(info.versionCode).toBe(65794);
    expect(info.identity).toBe("000000000000");
    expect(info.identityKind).toBe("watchface-id");
  });

  test("识别 .face 扩展名与自定义 ID", async () => {
    const bytes = new Uint8Array(REAL_XIAOMI_HEADER);
    bytes.set(strToU8("979812345678"), 40);
    const info = await readPackageVersion(
      new File([bytes], "custom.face", { type: "application/octet-stream" }),
    );
    expect(info.identity).toBe("979812345678");
  });

  test("文件过短时不可读", async () => {
    const info = await readPackageVersion(
      new File([new Uint8Array([0x5a, 0xa5, 0x34, 0x12, 0x01])], "short.bin"),
    );
    expect(info.readable).toBe(false);
    expect(info.writable).toBe(false);
  });
});

describe("writePackageVersion - 小米表盘二进制", () => {
  test("改写 offset4 并保持其余字节不变", async () => {
    const source = xiaomiBinFile();
    const updated = await writePackageVersion(source, {
      version: "2.3.4",
      versionCode: (2 << 16) | (3 << 8) | 4,
    });
    const info = await readPackageVersion(updated);
    expect(info.version).toBe("2.3.4");
    expect(info.versionCode).toBe(131844);

    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const updatedBytes = new Uint8Array(await updated.arrayBuffer());
    expect(updatedBytes[4]).toBe(4);
    expect(updatedBytes[5]).toBe(3);
    expect(updatedBytes[6]).toBe(2);
    // 除版本三字节外内容一致
    for (let i = 0; i < sourceBytes.length; i += 1) {
      if (i >= 4 && i <= 6) continue;
      expect(updatedBytes[i]).toBe(sourceBytes[i]);
    }
  });

  test("版本字段越界抛错", async () => {
    await expect(
      writePackageVersion(xiaomiBinFile(), { version: "1.0.256", versionCode: 0 }),
    ).rejects.toThrow("0-255");
  });
});

describe("readPackageVersion / writePackageVersion - rpk manifest", () => {
  test("小米 rpk 优先 manifest-watch.json 并给出 package 标识", async () => {
    const rpk = zipSync({
      "manifest.json": jsonBytes({
        package: "com.example.app",
        versionName: "1.0.0",
        versionCode: 1,
        router: { pages: {} },
      }),
      "manifest-watch.json": jsonBytes({
        package: "com.example.app",
        versionName: "2.0.0",
        versionCode: 2,
        router: { pages: {} },
      }),
      "META-INF/CERT": new Uint8Array([1, 2, 3, 4]),
    });
    const info = await readPackageVersion(new File([rpk], "app.rpk"));
    expect(info.source).toBe("zip-manifest");
    expect(info.version).toBe("2.0.0");
    expect(info.versionCode).toBe(2);
    expect(info.identity).toBe("com.example.app");
    expect(info.identityKind).toBe("package");
  });

  test("Vivo rpk（无 manifest-watch）读取 manifest.json", async () => {
    const rpk = zipSync({
      "manifest.json": jsonBytes({
        package: "com.Dreamqiu.9way",
        versionName: "1.5",
        versionCode: 150,
        router: { pages: {} },
      }),
      "META-INF/build.txt": strToU8("toolkit=1.0.9"),
    });
    const info = await readPackageVersion(new File([rpk], "vivo.rpk"));
    expect(info.version).toBe("1.5");
    expect(info.versionCode).toBe(150);
    expect(info.identity).toBe("com.Dreamqiu.9way");
    expect(info.identityKind).toBe("package");
  });

  test("Vivo 表盘从 router.watchfaces 取 dial id", async () => {
    const rpk = zipSync({
      "manifest.json": jsonBytes({
        package: "com.vivo.wf.watch107475",
        versionName: "1.0.0.2",
        versionCode: 10002,
        router: { watchfaces: { watchface: { id: "107475" } } },
      }),
    });
    const info = await readPackageVersion(new File([rpk], "dial.rpk"));
    expect(info.identity).toBe("107475");
    expect(info.identityKind).toBe("dial-id");
    expect(info.version).toBe("1.0.0.2");
    expect(info.versionCode).toBe(10002);
  });

  test("rpk 一律只读：读得到版本但 writable=false 且给出原因", async () => {
    const rpk = zipSync({
      "manifest.json": jsonBytes({
        package: "com.example.app",
        versionName: "1.0.0",
        versionCode: 1,
        router: { pages: {} },
      }),
      "manifest-watch.json": jsonBytes({
        package: "com.example.app",
        versionName: "1.0.0",
        versionCode: 1,
        router: { pages: {} },
      }),
      "config-watch.json": strToU8("{}"),
      "META-INF/CERT": new Uint8Array([9, 8, 7]),
    });
    const info = await readPackageVersion(new File([rpk], "app.rpk"));
    expect(info.source).toBe("zip-manifest");
    expect(info.readable).toBe(true);
    expect(info.version).toBe("1.0.0");
    expect(info.versionCode).toBe(1);
    expect(info.writable).toBe(false);
    expect(info.reason).toContain("rpk");
  });

  /**
   * 禁掉的只是「写」，「读」必须完好——versionName / versionCode 仍是发布流程
   * 锁定版本、判断递增的唯一数据源。哪天这里挂了，rpk 会退化成「版本未知」
   * 而创作者看不到任何提示。
   */
  test("禁写后仍要完整读出版本、包名与来源条目", async () => {
    const rpk = zipSync({
      "manifest.json": jsonBytes({
        package: "com.example.app",
        versionName: "1.0.0",
        versionCode: 1,
      }),
      "manifest-watch.json": jsonBytes({
        package: "com.example.app",
        versionName: "2.3.4",
        versionCode: 234,
      }),
    });
    const info = await readPackageVersion(new File([rpk], "app.rpk"));
    // manifest-watch.json 优先，与真包一致
    expect(info.version).toBe("2.3.4");
    expect(info.versionCode).toBe(234);
    expect(info.identity).toBe("com.example.app");
    expect(info.identityKind).toBe("package");
    expect(info.entry).toBe("manifest-watch.json");
    expect(info.readable).toBe(true);
    expect(info.writable).toBe(false);
  });

  test("reason 必须同时说明「为什么」和「怎么办」", async () => {
    const rpk = zipSync({
      "manifest.json": jsonBytes({
        package: "com.example.app",
        versionName: "1.0.0",
        versionCode: 1,
      }),
    });
    const { reason } = await readPackageVersion(new File([rpk], "app.rpk"));
    // 只说「不能改」等于把创作者推到死路，必须给出唯一出路。
    expect(reason).toContain("aiot release");
    expect(reason).toContain("manifest.json");
  });
});

// ---------------------------------------------------------------------------
// rpk 禁止改写
// ---------------------------------------------------------------------------

/** rpk 签名块尾魔数（SignUtil.SigMagic）。 */
const SIG_MAGIC = "RPK Sig Block 42";

const EOCD_SIG = 0x06054b50;

const u32le = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>>
  0;

function indexOfAscii(bytes: Uint8Array, ascii: string): number {
  const first = ascii.charCodeAt(0);
  outer: for (let i = 0; i + ascii.length <= bytes.length; i += 1) {
    if (bytes[i] !== first) continue;
    for (let k = 1; k < ascii.length; k += 1) {
      if (bytes[i + k] !== ascii.charCodeAt(k)) continue outer;
    }
    return i;
  }
  return -1;
}

function eocdOf(bytes: Uint8Array): number {
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (u32le(bytes, i) === EOCD_SIG) return i;
  }
  return -1;
}

/** 文件摘要列表里单条记录的字节步长（实测 `[int16 0x0020][int16 len][摘要]`）。 */
const SIG_DIGEST_STRIDE = 38;

/**
 * 造一个带签名块的 rpk。
 *
 * 签名块按 SignUtil.saveChunk 的布局插在条目区与中央目录之间，尾部带
 * `RPK Sig Block 42` 魔数，并按真实布局带上 `0x01000201` 全包文件摘要列表
 * （每个文件一条记录）。
 *
 * 这里刻意造得「结构上完全正常」：如果实现仍试图改写并搬运签名块，测试就会
 * 产出一个签名块与内容互相矛盾的包——正是线上装不上的那种包。
 */
function signedRpk(
  entries: Record<string, Uint8Array>,
  fileDigestCount: number,
): Uint8Array {
  const zip = zipSync(entries);
  const eocd = eocdOf(zip);
  const cdOffset = u32le(zip, eocd + 16);

  // 块布局：[int32 摘要条目数][int32 0][摘要记录 × n][int32 size][int32 0][魔数]
  const headerLen = 8;
  const digestRows = fileDigestCount * SIG_DIGEST_STRIDE;
  const block = new Uint8Array(headerLen + digestRows + 8 + SIG_MAGIC.length);
  block.set(
    [fileDigestCount & 0xff, (fileDigestCount >>> 8) & 0xff, 0, 0],
    0,
  );
  for (let i = 0; i < fileDigestCount; i += 1) {
    block.set([0x20, 0x00], headerLen + i * SIG_DIGEST_STRIDE);
  }
  // 块尾 [int32 size][int32 0]：size = 摘要记录区 + 魔数，与块头声明自洽。
  const tailSize = digestRows + SIG_MAGIC.length;
  block.set(
    [tailSize & 0xff, (tailSize >>> 8) & 0xff, 0, 0],
    headerLen + digestRows,
  );
  block.set([0, 0, 0, 0], headerLen + digestRows + 4);
  block.set(strToU8(SIG_MAGIC), headerLen + digestRows + 8);

  const out = new Uint8Array(zip.length + block.length);
  out.set(zip.subarray(0, cdOffset), 0);
  out.set(block, cdOffset);
  out.set(zip.subarray(cdOffset), cdOffset + block.length);
  const shifted = cdOffset + block.length;
  out[eocd + block.length + 16] = shifted & 0xff;
  out[eocd + block.length + 17] = (shifted >>> 8) & 0xff;
  return out;
}

describe("writePackageVersion - rpk 一律拒绝改写", () => {
  test("带签名块的 rpk 抛错，且不产出被改动的包体", async () => {
    const signed = signedRpk(
      {
        "manifest.json": jsonBytes({
          package: "com.example.app",
          versionName: "1.0.0",
          versionCode: 1,
          router: { pages: {} },
        }),
        "pages/index.js": strToU8("console.log(1)"),
      },
      2,
    );
    const before = new Uint8Array(signed);

    await expect(
      writePackageVersion(new File([signed], "app.rpk"), {
        version: "2.0.0",
        versionCode: 200,
      }),
    ).rejects.toThrow("rpk");

    // 抛错即不得有任何字节落到包里：签名块与 manifest 必须原封不动。
    // 真去改了 manifest 却把旧签名块搬回去，产出的包看着正常、装上去必被拒。
    const entries = unzipSync(before);
    expect(readJson(entries, "manifest.json").versionCode).toBe(1);
    expect(indexOfAscii(before, SIG_MAGIC)).toBeGreaterThan(0);
  });

  test("无签名块的 rpk 同样拒绝（签名缺失不代表可以改）", async () => {
    // 曾按「有没有签名块」分流：无块的走改写路径。这正是漏洞本身——
    // 工具链没签的包不代表手环会放行，而有块的包才是被签名保护的那批。
    const plain = zipSync({
      "manifest.json": jsonBytes({
        package: "com.example.app",
        versionName: "1.0.0",
        versionCode: 1,
      }),
    });
    const info = await readPackageVersion(new File([plain], "app.rpk"));
    expect(info.writable).toBe(false);
    await expect(
      writePackageVersion(new File([plain], "app.rpk"), {
        version: "2.0.0",
        versionCode: 200,
      }),
    ).rejects.toThrow("rpk");
  });

  test("Vivo 表盘 rpk（router.watchfaces）同样不可改写", async () => {
    const rpk = zipSync({
      "manifest.json": jsonBytes({
        package: "com.vivo.dial",
        versionName: "1.0.0.2",
        versionCode: 10002,
        router: { watchfaces: { main: { id: "778899" } } },
      }),
    });
    const info = await readPackageVersion(new File([rpk], "dial.rpk"));
    expect(info.source).toBe("zip-manifest");
    expect(info.identityKind).toBe("dial-id");
    expect(info.writable).toBe(false);
  });
});

/**
 * 拦截口径必须认 manifest-watch.json，不能只认 manifest.json。
 *
 * 曾经的漏洞：只含 manifest-watch.json 且带 .bin 的签名 zip 会被 pickManifestName
 * 判成「不是 rpk」，落进 .mwz 表盘工程包分支，被 zipSync 重压——版本改成功，
 * 签名块静默丢失，产出一个装不上的包。读路径本就优先读 manifest-watch.json，
 * 说明这种布局是预期存在的。
 */
describe("rpk 拦截口径：manifest-watch.json 也要认", () => {
  function watchOnlyRpk(): Uint8Array {
    return zipSync({
      "manifest-watch.json": jsonBytes({
        package: "com.example.app",
        versionName: "1.0.0",
        versionCode: 1,
      }),
      // .bin 是关键：没有它就不会落进 .mwz 分支，测不出这个洞
      "resource.bin": REAL_XIAOMI_HEADER,
    });
  }

  test("只有 manifest-watch.json 的带 bin 包：写路径必须拒绝", async () => {
    const rpk = watchOnlyRpk();
    await expect(
      writePackageVersion(new File([rpk], "a.rpk"), {
        version: "2.0.0",
        versionCode: 2 << 16,
      }),
    ).rejects.toThrow("rpk");
  });

  test("只有 manifest-watch.json 的带 bin 包：表盘 ID 改写必须原样返回", async () => {
    const rpk = watchOnlyRpk();
    const before = new Uint8Array(rpk);
    const after = await replaceWatchfaceIdInPackage(
      new File([rpk], "a.rpk"),
      "979812345678",
    );
    const bytes = new Uint8Array(await after.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(before));
  });

  test("真 .mwz（无任何快应用清单）仍要能改，别把表盘工程包一起堵死", async () => {
    const mwz = zipSync({
      "description.xml": strToU8("<x/>"),
      "resource.bin": REAL_XIAOMI_HEADER,
    });
    const updated = await writePackageVersion(new File([mwz], "t.mwz"), {
      version: "9.9.9",
      versionCode: (9 << 16) | (9 << 8) | 9,
    });
    const info = await readPackageVersion(updated);
    expect(info.source).toBe("xiaomi-mwz");
    expect(info.versionCode).toBe(592137);
  });
});

/** 真实样本目录不在版本库，用 existsSync 守卫，缺失即跳过。 */
const SAMPLE_DIR = ".opencode/problem/debugreleaseexamplerpk";
const RELEASE_RPK = join(
  SAMPLE_DIR,
  "com.arknights.gpoor.gacha.release.1.1.2.rpk",
);
const DEBUG_RPK = join(SAMPLE_DIR, "com.arknights.gpoor.gacha.debug.1.0.4.rpk");

describe("真实 rpk 样本回归", () => {
  const samples = [
    { path: RELEASE_RPK, label: "release 样本" },
    { path: DEBUG_RPK, label: "debug 样本" },
  ].filter((s) => existsSync(s.path));

  if (samples.length === 0) {
    test.skip(`${SAMPLE_DIR} 不存在，跳过真实样本回归`, () => {});
  }

  for (const { path, label } of samples) {
    test(`${label}：能读出版本但拒绝改写`, async () => {
      const original = new Uint8Array(await Bun.file(path).arrayBuffer());
      expect(indexOfAscii(original, SIG_MAGIC)).toBeGreaterThan(0);

      const info = await readPackageVersion(new File([original], "a.rpk"));
      expect(info.source).toBe("zip-manifest");
      expect(info.readable).toBe(true);
      expect(info.version).toBeTruthy();
      expect(info.writable).toBe(false);

      await expect(
        writePackageVersion(new File([original], "a.rpk"), {
          version: "9.9.9",
          versionCode: 999999,
        }),
      ).rejects.toThrow("rpk");

      // 再次确认原始字节未被这次尝试改动
      const after = new Uint8Array(await Bun.file(path).arrayBuffer());
      expect(after.length).toBe(original.length);
    });
  }
});

describe("readPackageVersion / writePackageVersion - .mwz", () => {
  function mwzFile(): File {
    const mwz = zipSync({
      "description.xml": strToU8("<x/>"),
      "resource.bin": REAL_XIAOMI_HEADER,
      "resources/manifest.xml": strToU8("<y/>"),
    });
    return new File([mwz], "theme.mwz");
  }

  test("读取内层 resource.bin 的版本", async () => {
    const info = await readPackageVersion(mwzFile());
    expect(info.source).toBe("xiaomi-mwz");
    expect(info.version).toBe("1.1.2");
    expect(info.versionCode).toBe(65794);
    expect(info.entry).toBe("resource.bin");
  });

  test("只改写内层 bin，其余条目原样保留", async () => {
    const updated = await writePackageVersion(mwzFile(), {
      version: "9.9.9",
      versionCode: (9 << 16) | (9 << 8) | 9,
    });
    const entries = unzipSync(new Uint8Array(await updated.arrayBuffer()));
    expect(new TextDecoder().decode(entries["description.xml"])).toBe("<x/>");
    expect(new TextDecoder().decode(entries["resources/manifest.xml"])).toBe("<y/>");
    const inner = entries["resource.bin"];
    expect(inner[4]).toBe(9);
    expect(inner[5]).toBe(9);
    expect(inner[6]).toBe(9);

    const info = await readPackageVersion(updated);
    expect(info.version).toBe("9.9.9");
    expect(info.versionCode).toBe(592137);
  });

  test("优先根目录 .bin，其次任意 .bin", async () => {
    const nested = zipSync({ "sub/resource.bin": REAL_XIAOMI_HEADER });
    const nestedInfo = await readPackageVersion(new File([nested], "n.mwz"));
    expect(nestedInfo.source).toBe("xiaomi-mwz");
    expect(nestedInfo.entry).toBe("sub/resource.bin");
  });
});

describe("readPackageVersion - 不支持的格式", () => {
  test("非 zip / 非表盘返回 unknown", async () => {
    const info = await readPackageVersion(
      new File([strToU8("hello world")], "note.txt"),
    );
    expect(info.source).toBe("unknown");
    expect(info.readable).toBe(false);
    expect(info.writable).toBe(false);
    expect(info.reason).toBeTruthy();
  });

  test("zip 内既无 manifest 也无 bin", async () => {
    const zip = zipSync({ "readme.txt": strToU8("hi") });
    const info = await readPackageVersion(new File([zip], "x.zip"));
    expect(info.source).toBe("unknown");
    expect(info.reason).toContain(".bin");
  });
});

describe("WATCHFACE_MAGIC", () => {
  test("与小米表盘头一致", () => {
    expect(WATCHFACE_MAGIC).toEqual([0x5a, 0xa5, 0x34, 0x12]);
  });
});

describe("xiaomiVersionCodeFromVersion", () => {
  test("a.b.c 派生 versionCode", () => {
    expect(xiaomiVersionCodeFromVersion("1.2.4")).toBe(66052);
    expect(xiaomiVersionCodeFromVersion("1.1.2")).toBe(65794);
    expect(xiaomiVersionCodeFromVersion("0.0.0")).toBe(0);
    expect(xiaomiVersionCodeFromVersion("255.255.255")).toBe(16777215);
  });

  test("非 a.b.c 形式返回 undefined", () => {
    expect(xiaomiVersionCodeFromVersion("1.0.0.2")).toBeUndefined();
    expect(xiaomiVersionCodeFromVersion("2.5")).toBeUndefined();
    expect(xiaomiVersionCodeFromVersion("")).toBeUndefined();
  });
});
