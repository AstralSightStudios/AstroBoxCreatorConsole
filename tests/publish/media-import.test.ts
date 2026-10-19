import { describe, expect, test } from "bun:test";
import { createMediaImportGate } from "../../app/logic/publish/media-import";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("媒体导入共享状态", () => {
  for (const target of ["icon", "cover", "previews"] as const) {
    test(`${target} 的两个导入入口在读取和处理期间共用状态`, async () => {
      const imports = createMediaImportGate();
      const reading = deferred();
      const processing = deferred();
      const events: string[] = [];

      const first = imports.run(target, async () => {
        events.push("开始读取");
        await reading.promise;
        events.push("开始处理");
        await processing.promise;
        events.push("导入完成");
      });
      const competingImport = async () => {
        events.push("并发导入");
      };

      expect(imports.isBusy(target)).toBe(true);
      await imports.run(target, competingImport);
      expect(events).toEqual(["开始读取"]);

      reading.resolve();
      await reading.promise;
      await imports.run(target, competingImport);
      expect(events).toEqual(["开始读取", "开始处理"]);

      processing.resolve();
      await first;
      expect(imports.isBusy(target)).toBe(false);
      await imports.run(target, competingImport);
      expect(events).toEqual(["开始读取", "开始处理", "导入完成", "并发导入"]);
    });
  }

  test("图标和预览图不会被正在导入的封面阻塞", async () => {
    const imports = createMediaImportGate();
    const pending = deferred();
    const cover = imports.run("cover", () => pending.promise);
    const completed: string[] = [];

    await imports.run("icon", async () => { completed.push("icon"); });
    await imports.run("previews", async () => { completed.push("previews"); });
    expect(completed).toEqual(["icon", "previews"]);
    expect(imports.isBusy("cover")).toBe(true);

    pending.resolve();
    await cover;
  });

  test("取消文件选择后释放状态，允许下次导入", async () => {
    const imports = createMediaImportGate();
    const chooseFiles = async (): Promise<File[]> => [];
    let uploads = 0;

    await imports.run("icon", async () => {
      const files = await chooseFiles();
      if (files.length === 0) return;
      uploads += 1;
    });
    expect(uploads).toBe(0);
    expect(imports.isBusy("icon")).toBe(false);
    await imports.run("icon", async () => { uploads += 1; });
    expect(uploads).toBe(1);
  });

  test("导入失败后释放状态，允许重试", async () => {
    const imports = createMediaImportGate();
    const failure = deferred();
    const task = imports.run("previews", () => failure.promise);
    expect(imports.isBusy("previews")).toBe(true);

    failure.reject(new Error("导入失败"));
    await expect(task).rejects.toThrow("导入失败");
    expect(imports.isBusy("previews")).toBe(false);

    let retried = false;
    await imports.run("previews", async () => { retried = true; });
    expect(retried).toBe(true);
  });
});
