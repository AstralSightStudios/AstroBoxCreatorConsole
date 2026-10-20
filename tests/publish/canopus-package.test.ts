import { describe, expect, test } from "bun:test";
import {
  canopusEntryProblems,
  isTarArchive,
  readCanopusPackage,
} from "../../app/logic/publish/canopus-package";
import { readPackageVersion } from "../../app/logic/publish/package-version";
import { buildManifest } from "../../app/logic/publish/manifest";
import { rowsWithoutCanopusMeta } from "../../app/logic/publish/pre-publish-checks";

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function tar(entries: Array<[string, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const text = new TextEncoder();
  for (const [name, data] of entries) {
    const header = new Uint8Array(512);
    header.set(text.encode(name), 0);
    header.set(text.encode(octal(0o644, 8)), 100);
    header.set(text.encode(octal(data.length, 12)), 124);
    header.set(text.encode("        "), 148);
    header[156] = "0".charCodeAt(0);
    header.set(text.encode("ustar\0" + "00"), 257);
    let sum = 0;
    for (const b of header) sum += b;
    header.set(text.encode(octal(sum, 7) + " "), 148);
    parts.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function pack(manifest: Record<string, unknown>): Uint8Array {
  return tar([["manifest.json", new TextEncoder().encode(JSON.stringify(manifest))]]);
}

const base = {
  schema: 1,
  module_id: "hello_portable",
  version: "1.2.0",
  version_code: 12,
  canopus_abi: "1",
};

const portable = pack({
  ...base,
  artifacts: [
    { target_id: "xiaomi-band-11-4.100.155", path: "artifacts/abi-1-thumbv8m/module.elf" },
    { target_id: "xiaomi-band-11-4.100.139", path: "artifacts/abi-1-thumbv8m/module.elf" },
  ],
});

const bound = pack({
  ...base,
  artifacts: [
    { target_id: "xiaomi-band-10-pro-3.101.043", path: "artifacts/xiaomi-band-10-pro-3.101.043/module.elf" },
    { target_id: "xiaomi-band-10-pro-3.101.036", path: "artifacts/xiaomi-band-10-pro-3.101.036/module.elf" },
  ],
});

describe("canopus package", () => {
  test("portable packages declare only the ABI", () => {
    expect(isTarArchive(portable)).toBe(true);
    expect(readCanopusPackage(portable)).toEqual({
      moduleId: "hello_portable",
      version: "1.2.0",
      versionCode: 12,
      canopus: { abi: 1 },
    });
  });

  test("target-bound packages list every target, sorted", () => {
    expect(readCanopusPackage(bound).canopus).toEqual({
      abi: 1,
      targets: ["xiaomi-band-10-pro-3.101.036", "xiaomi-band-10-pro-3.101.043"],
    });
  });

  test("rejects malformed manifests", () => {
    const artifacts = [{ target_id: "t", path: "artifacts/t/module.elf" }];
    expect(() => readCanopusPackage(tar([["other.txt", new Uint8Array(3)]]))).toThrow("manifest.json");
    expect(() => readCanopusPackage(pack({ ...base, module_id: "Bad-Id", artifacts }))).toThrow("不合法");
    expect(() => readCanopusPackage(pack({ ...base, version: "1.2", artifacts }))).toThrow("major.minor.patch");
    expect(() => readCanopusPackage(pack({ ...base, version_code: 0, artifacts }))).toThrow("大于 0");
    expect(() => readCanopusPackage(pack({ ...base, version_code: 2 ** 32, artifacts }))).toThrow("整数");
    expect(() => readCanopusPackage(pack({ ...base, canopus_abi: "x", artifacts }))).toThrow("正整数");
    expect(() => readCanopusPackage(pack({ ...base, artifacts: [] }))).toThrow("没有任何产物");
    expect(() =>
      readCanopusPackage(pack({ ...base, artifacts: [{ target_id: "t", path: "artifacts/other/module.elf" }] })),
    ).toThrow("不对应");
    expect(() =>
      readCanopusPackage(
        pack({
          ...base,
          artifacts: [
            { target_id: "a", path: "artifacts/abi-1-thumbv8m/module.elf" },
            { target_id: "b", path: "artifacts/b/module.elf" },
          ],
        }),
      ),
    ).toThrow("混合");
    expect(() =>
      readCanopusPackage(
        pack({ ...base, artifacts: [{ target_id: "a", path: "artifacts/abi-2-thumbv8m/module.elf" }] }),
      ),
    ).toThrow("不一致");
  });

  test("the version reader exposes identity, version and metadata", async () => {
    const info = await readPackageVersion(new Blob([bound as BlobPart]));
    expect(info.source).toBe("canopus-manifest");
    expect(info.readable).toBe(true);
    expect(info.writable).toBe(false);
    expect(info.identity).toBe("hello_portable");
    expect(info.versionCode).toBe(12);
    expect(info.canopus?.targets).toHaveLength(2);

    const broken = await readPackageVersion(new Blob([tar([["other.txt", new Uint8Array(3)]]) as BlobPart]));
    expect(broken.readable).toBe(false);
    expect(broken.reason).toContain("manifest.json");
  });

  test("entry claims must match the package", () => {
    const claim = {
      device: "xiaomi-band-10-pro",
      version: "1.2.0",
      versionCode: 12,
      canopus: {
        abi: 1,
        targets: ["xiaomi-band-10-pro-3.101.043", "xiaomi-band-10-pro-3.101.036"],
        minFramework: 3,
      },
    };
    expect(canopusEntryProblems(bound, "hello_portable", [claim])).toEqual([]);
    const problems = canopusEntryProblems(bound, "other_id", [
      { ...claim, versionCode: 11, canopus: { abi: 2, targets: ["xiaomi-band-10-pro-3.101.043"] } },
      { device: "x", version: "1.2.0", versionCode: 12 },
    ]);
    expect(problems.join("\n")).toContain("资源 ID");
    expect(problems.join("\n")).toContain("声明 ABI 2");
    expect(problems.join("\n")).toContain("target");
    expect(problems.join("\n")).toContain("versionCode 11");
    expect(problems.join("\n")).toContain("缺少 canopus");
    expect(
      canopusEntryProblems(portable, "hello_portable", [
        { ...claim, canopus: { abi: 1, targets: ["xiaomi-band-11-4.100.155"] } },
      ]).join(),
    ).toContain("portable");
  });

  test("the manifest carries canopus metadata and rows without it are flagged", () => {
    const file = new File([bound as BlobPart], "hello-1.2.0.canopus");
    const row = {
      uid: "1",
      platformId: "xiaomi-band-10-pro",
      version: "1.2.0",
      versionCode: 12,
      file: { id: "f", name: file.name, file, source: "local" as const },
      canopus: { abi: 1, targets: ["xiaomi-band-10-pro-3.101.043"] },
    };
    const result = buildManifest({
      itemId: "hello_portable",
      itemName: "Hello",
      description: "",
      resourceType: "canopus",
      previews: [],
      icon: null,
      cover: null,
      usePreviewAsCover: false,
      coverPreviewId: null,
      authors: [],
      links: [],
      downloads: [row],
      trialDownloads: [],
      ext: {},
      enableAstroBoxCreatorFeatures: false,
    });
    const manifest = JSON.parse(result.manifestJson);
    expect(manifest.downloads["xiaomi-band-10-pro"].canopus).toEqual(row.canopus);

    expect(rowsWithoutCanopusMeta([row], "canopus")).toEqual([]);
    expect(rowsWithoutCanopusMeta([{ ...row, canopus: undefined }], "canopus")).toHaveLength(1);
    expect(rowsWithoutCanopusMeta([{ ...row, canopus: undefined }], "quick_app")).toEqual([]);
  });
});
