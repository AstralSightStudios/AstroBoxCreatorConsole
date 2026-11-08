import { describe, expect, test } from "bun:test";
import {
  applyVersionCodeBackfills,
  collectVersionCodeBackfills,
  deriveXiaomiWatchfaceVersionCode,
  type VersionCodeBackfill,
} from "../../app/logic/publish/version-code-backfill";
import type { DownloadInput } from "../../app/routes/resource/publish/components/types";

/** 真实小米表盘前 64 字节：magic + offset4 版本 02 01 01（1.1.2）。 */
const REAL_XIAOMI_HEADER = new Uint8Array([
  0x5a, 0xa5, 0x34, 0x12, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x06, 0x00, 0x38, 0x0e, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
  0x30, 0x30, 0x30, 0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

function binFile(name = "watchface.bin"): File {
  return new File([REAL_XIAOMI_HEADER], name, {
    type: "application/octet-stream",
  });
}

function makeRow(
  partial: Partial<DownloadInput> & { uid: string },
): DownloadInput {
  return {
    platformId: "xmws4",
    version: "1.1.2",
    file: null,
    ...partial,
  } as DownloadInput;
}

function existingRow(
  partial: Partial<DownloadInput> & { uid: string },
): DownloadInput {
  const path = partial.existingFileName ?? "downloads/watch.bin";
  return makeRow({
    existingFileName: path,
    file: {
      id: `upload-${partial.uid}`,
      name: path.split("/").pop() || "watch.bin",
      url: "",
      file: new File([new Uint8Array()], path.split("/").pop() || "watch.bin"),
      pathOverride: path,
      skipUpload: true,
    },
    ...partial,
  });
}

describe("version-code-backfill: deriveXiaomiWatchfaceVersionCode", () => {
  test("小米表盘按 major.minor.patch 派生 versionCode", () => {
    const row = makeRow({ uid: "a", version: "1.1.2" });
    expect(
      deriveXiaomiWatchfaceVersionCode(row, {
        resourceType: "watchface",
        vendor: "xiaomi",
      }),
    ).toBe(65794);
    expect(
      deriveXiaomiWatchfaceVersionCode(row, {
        resourceType: "watchface",
        vendor: "XiaoMi",
      }),
    ).toBe(65794);
  });

  test("其他资源类型、厂商与四段版本号不套用该公式", () => {
    const row = makeRow({ uid: "a", version: "1.1.2" });
    expect(
      deriveXiaomiWatchfaceVersionCode(row, {
        resourceType: "quick_app",
        vendor: "xiaomi",
      }),
    ).toBeUndefined();
    expect(
      deriveXiaomiWatchfaceVersionCode(row, {
        resourceType: "watchface",
        vendor: "vivo",
      }),
    ).toBeUndefined();
    expect(
      deriveXiaomiWatchfaceVersionCode(
        makeRow({ uid: "b", version: "1.0.0.2" }),
        { resourceType: "watchface", vendor: "xiaomi" },
      ),
    ).toBeUndefined();
  });
});

describe("version-code-backfill: collectVersionCodeBackfills", () => {
  test("派生值不读包体，其余行按路径去重读取", async () => {
    const shared = "downloads/shared.bin";
    const rows = [
      existingRow({
        uid: "derived",
        version: "1.1.2",
        existingFileName: "downloads/watch.bin",
      }),
      existingRow({ uid: "read-a", version: "", existingFileName: shared }),
      existingRow({ uid: "read-b", version: "1.0.0", existingFileName: shared }),
    ];
    let loads = 0;
    const backfills = await collectVersionCodeBackfills({
      rows,
      loadPackage: async () => {
        loads += 1;
        return binFile();
      },
      catalogMode: true,
      deriveVersionCode: (row) => (row.uid === "derived" ? 65794 : undefined),
    });

    expect(loads).toBe(1);
    const byUid = new Map(backfills.map((item) => [item.uid, item]));
    expect(byUid.get("derived")?.versionCode).toBe(65794);
    expect(byUid.get("read-a")?.versionCode).toBe(65794);
    expect(byUid.get("read-a")?.version).toBe("1.1.2");
    expect(byUid.get("read-a")?.previousVersionCode).toBe(65794);
    expect(byUid.get("read-b")?.versionCode).toBe(65794);
  });

  test("PR 编辑不写递增基线", async () => {
    const rows = [existingRow({ uid: "a" })];
    const backfills = await collectVersionCodeBackfills({
      rows,
      loadPackage: async () => binFile(),
      catalogMode: false,
    });
    expect(backfills[0]?.versionCode).toBe(65794);
    expect(backfills[0]?.previousVersionCode).toBeUndefined();
  });

  test("已填写或读取失败的行不产生回填", async () => {
    const rows = [
      existingRow({ uid: "filled", versionCode: 5 }),
      existingRow({ uid: "broken", existingFileName: "downloads/broken.rpk" }),
      makeRow({ uid: "local-upload", version: "1.1.2" }),
    ];
    const errors: string[] = [];
    const backfills = await collectVersionCodeBackfills({
      rows,
      loadPackage: async () => {
        throw new Error("boom");
      },
      catalogMode: false,
      onError: (row) => errors.push(row.uid),
    });
    expect(backfills).toEqual([]);
    expect(errors).toEqual(["broken"]);
  });
});

describe("version-code-backfill: applyVersionCodeBackfills", () => {
  test("只补仍为空且包体路径未变的行", () => {
    const backfill: VersionCodeBackfill = {
      uid: "a",
      fileName: "downloads/watch.bin",
      version: "1.1.2",
      versionCode: 65794,
      previousVersionCode: 65794,
    };
    const rows = [
      existingRow({ uid: "a", version: "" }),
      existingRow({ uid: "b", versionCode: 1 }),
      existingRow({ uid: "c", existingFileName: "downloads/other.bin" }),
    ];
    const result = applyVersionCodeBackfills(rows, [
      backfill,
      {
        uid: "b",
        fileName: "downloads/watch.bin",
        versionCode: 65794,
      },
    ]);

    expect(result[0].versionCode).toBe(65794);
    expect(result[0].version).toBe("1.1.2");
    expect(result[0].previousVersionCode).toBe(65794);
    expect(result[1].versionCode).toBe(1);
    expect(result[2].versionCode).toBeUndefined();
  });

  test("读取期间被替换的包体不再回填", () => {
    const rows = [
      existingRow({ uid: "a", existingFileName: "downloads/new.bin" }),
    ];
    const result = applyVersionCodeBackfills(rows, [
      { uid: "a", fileName: "downloads/old.bin", versionCode: 1 },
    ]);
    expect(result[0].versionCode).toBeUndefined();
  });

  test("没有回填结果时原样返回", () => {
    const rows = [existingRow({ uid: "a" })];
    expect(applyVersionCodeBackfills(rows, [])).toBe(rows);
  });
});
