import { describe, expect, test } from "bun:test";
import { resolveImportedPackage } from "../../app/logic/publish/package-import";
import { readPackageVersion } from "../../app/logic/publish/package-version";
import { rowsWithoutCanopusMeta } from "../../app/logic/publish/pre-publish-checks";
import type { DownloadInput } from "../../app/routes/resource/publish/components/types";
import { CANOPUS_BASE, pack } from "./canopus-fixtures";

const boundManifest = {
  ...CANOPUS_BASE,
  artifacts: [
    {
      target_id: "xiaomi-band-11-4.100.155",
      path: "artifacts/xiaomi-band-11-4.100.155/module.elf",
    },
    {
      target_id: "xiaomi-band-11-4.100.179",
      path: "artifacts/xiaomi-band-11-4.100.179/module.elf",
    },
  ],
};

function canopusFile(name = "corona.canopus"): File {
  return new File([pack(boundManifest) as BlobPart], name, {
    type: "application/octet-stream",
  });
}

describe("package import", () => {
  test("reads the package even when the caller passes no validateFile", async () => {
    const file = canopusFile();
    const { info, file: resolved } = await resolveImportedPackage(file);
    // 没有改写需求的类型（快应用、canopus）不传 validateFile，包体原样落库…
    expect(resolved).toBe(file);
    // …但包内信息必须照样读出来，否则版本、hash 与 canopus 元数据全为空。
    expect(info.source).toBe("canopus-manifest");
    expect(info.readable).toBe(true);
    expect(info.version).toBe("1.2.0");
    expect(info.identity).toBe("hello_portable");
    expect(info.canopus).toEqual({
      abi: 1,
      targets: ["xiaomi-band-11-4.100.155", "xiaomi-band-11-4.100.179"],
    });
  });

  test("canopus rows survive the pre-publish canopus check", async () => {
    const { info } = await resolveImportedPackage(canopusFile());
    const row = {
      uid: "row-1",
      platformId: "xiaomi-band-11",
      file: { id: "file-1" },
      canopus: info.canopus,
    } as unknown as DownloadInput;
    expect(rowsWithoutCanopusMeta([row], "canopus")).toHaveLength(0);
    // 元数据为空时就会被判成无效模块包，这正是导入阶段漏读包体的表现。
    expect(
      rowsWithoutCanopusMeta([{ ...row, canopus: undefined }], "canopus"),
    ).toHaveLength(1);
  });

  test("a provided validateFile wins and its rewritten file is kept", async () => {
    const file = canopusFile();
    const rewritten = new File([pack(CANOPUS_BASE) as BlobPart], "rewritten.canopus");
    const validated = {
      info: await readPackageVersion(rewritten),
      file: rewritten,
    };
    const result = await resolveImportedPackage(file, async () => validated);
    // 返回同一个对象：改写过的包体与它的 info 必须成对使用，不能重新读一遍原包。
    expect(result).toBe(validated);
    expect(result.file).toBe(rewritten);
  });

  test("validateFile errors bubble up to the caller", async () => {
    await expect(
      resolveImportedPackage(canopusFile(), async () => {
        throw new Error("资源包校验不通过");
      }),
    ).rejects.toThrow("资源包校验不通过");
  });
});
