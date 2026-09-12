import { describe, expect, test } from "bun:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  WATCHFACE_MAGIC,
  readPackageVersion,
  writePackageVersion,
} from "../../app/logic/publish/package-version";

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

  test("写入时统一更新包内所有 versionName / versionCode", async () => {
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
    const updated = await writePackageVersion(new File([rpk], "app.rpk"), {
      version: "2.5.0",
      versionCode: 250,
    });
    const entries = unzipSync(new Uint8Array(await updated.arrayBuffer()));
    expect(readJson(entries, "manifest.json").versionName).toBe("2.5.0");
    expect(readJson(entries, "manifest.json").versionCode).toBe(250);
    expect(readJson(entries, "manifest-watch.json").versionName).toBe("2.5.0");
    expect(readJson(entries, "manifest-watch.json").versionCode).toBe(250);
    expect(readJson(entries, "config-watch.json")).toEqual({});
    expect(Array.from(entries["META-INF/CERT"])).toEqual([9, 8, 7]);

    const info = await readPackageVersion(updated);
    expect(info.version).toBe("2.5.0");
    expect(info.versionCode).toBe(250);
  });
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
