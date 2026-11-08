import { describe, expect, test } from "bun:test";
import {
  canTogglePackageEncryption,
  packageSourcePath,
  rowsSharePackage,
} from "../../app/logic/publish/package-sharing";

type Row = {
  uid: string;
  file?:
    | {
        id?: string;
        file?: File;
        pathOverride?: string;
        skipUpload?: boolean;
      }
    | null;
  existingFileName?: string;
};

const row = (overrides: Row): Row => ({ uid: "row-1", ...overrides });

describe("packageSourcePath", () => {
  test("显式路径优先于编辑模式沿用的旧文件名", () => {
    expect(
      packageSourcePath(
        row({
          file: { pathOverride: "downloads/new.rpk" },
          existingFileName: "downloads/old.rpk",
        }),
      ),
    ).toBe("downloads/new.rpk");
  });

  test("没有显式路径时回退旧文件名", () => {
    expect(
      packageSourcePath(row({ file: {}, existingFileName: "downloads/old.rpk" })),
    ).toBe("downloads/old.rpk");
  });

  test("两者都没有时返回 undefined", () => {
    expect(packageSourcePath(row({ file: null }))).toBeUndefined();
  });
});

describe("rowsSharePackage", () => {
  test("一键填充复制的同一个 UploadItem 视为共用包体", () => {
    const shared = { id: "upload-1", file: new File([], "app.rpk") };
    const a = row({ uid: "a", file: shared });
    const b = row({ uid: "b", file: shared });
    expect(rowsSharePackage(a, b)).toBe(true);
  });

  test("草稿恢复后对象换了但 id 相同仍视为共用", () => {
    expect(
      rowsSharePackage(
        row({ uid: "a", file: { id: "upload-1" } }),
        row({ uid: "b", file: { id: "upload-1" } }),
      ),
    ).toBe(true);
  });

  test("不同 UploadItem 但底层的 File 是同一个对象时视为共用", () => {
    const file = new File([], "app.rpk");
    expect(
      rowsSharePackage(
        row({ uid: "a", file: { id: "upload-1", file } }),
        row({ uid: "b", file: { id: "upload-2", file } }),
      ),
    ).toBe(true);
  });

  test("编辑模式下复用同一仓库路径时视为共用", () => {
    expect(
      rowsSharePackage(
        row({ uid: "a", file: {}, existingFileName: "downloads/app.rpk" }),
        row({ uid: "b", file: {}, existingFileName: "downloads/app.rpk" }),
      ),
    ).toBe(true);
  });

  test("同名的不同包体不得仅凭文件名判为共用", () => {
    expect(
      rowsSharePackage(
        row({ uid: "a", file: { id: "upload-1", file: new File([], "app.rpk") } }),
        row({ uid: "b", file: { id: "upload-2", file: new File([], "app.rpk") } }),
      ),
    ).toBe(false);
  });

  test("没有可靠依据时按独立包体处理", () => {
    expect(rowsSharePackage(row({ uid: "a" }), row({ uid: "b" }))).toBe(false);
  });

  test("同一行始终视为共用", () => {
    const only = row({ uid: "a" });
    expect(rowsSharePackage(only, only)).toBe(true);
  });
});

describe("canTogglePackageEncryption", () => {
  test("本次会上传的新包体可切换加密", () => {
    expect(canTogglePackageEncryption(row({ file: {} }))).toBe(true);
    expect(
      canTogglePackageEncryption(row({ file: { skipUpload: false } })),
    ).toBe(true);
  });

  test("沿用仓库旧包时不可切换", () => {
    expect(
      canTogglePackageEncryption(row({ file: { skipUpload: true } })),
    ).toBe(false);
  });

  test("没有包体时不可切换", () => {
    expect(canTogglePackageEncryption(row({ file: null }))).toBe(false);
    expect(canTogglePackageEncryption(row({}))).toBe(false);
  });
});
