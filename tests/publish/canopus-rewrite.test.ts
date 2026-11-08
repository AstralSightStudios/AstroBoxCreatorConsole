import { describe, expect, test } from "bun:test";
import {
  canopusPackageWriteBlocker,
  readCanopusTarEntries,
  rewriteCanopusPackage,
} from "../../app/logic/publish/canopus-package";
import { readPackageVersion, writePackageVersion } from "../../app/logic/publish/package-version";
import { tar } from "./canopus-fixtures";

const enc = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(await sha256(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function putU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

async function buildReceipt(
  moduleId: string,
  targetId: string,
  versionCode: number,
  artifact: Uint8Array,
): Promise<Uint8Array> {
  const receipt = new Uint8Array(176);
  receipt.set(enc.encode("CMI2"), 0);
  putU32(receipt, 4, 2);
  putU32(receipt, 8, 176);
  putU32(receipt, 16, 0);
  putU32(receipt, 20, versionCode);
  putU32(receipt, 24, artifact.length);
  receipt.set(enc.encode(moduleId), 32);
  receipt.set(enc.encode(targetId), 64);
  receipt.set(new Uint8Array(32).fill(7), 112);
  receipt.set(await sha256(artifact), 144);
  return receipt;
}

async function buildPackage(
  options: { signed?: boolean; missingReceipt?: boolean } = {},
) {
  const moduleId = "hello_portable";
  const targetId = "t";
  const versionCode = 12;
  const artifact = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4]);
  const receipt = await buildReceipt(moduleId, targetId, versionCode, artifact);
  const manifest: Record<string, unknown> = {
    schema: 1,
    module_id: moduleId,
    version: "1.2.0",
    version_code: versionCode,
    build_generation: versionCode,
    canopus_abi: "2",
    lifecycle: "removable",
    artifacts: [
      {
        target_id: targetId,
        path: "artifacts/t/module.elf",
        sha256: await sha256Hex(artifact),
        ...(options.missingReceipt
          ? {}
          : { receipt_path: "receipts/t.cmi", receipt_sha256: await sha256Hex(receipt) }),
      },
    ],
  };
  const entries: Array<[string, Uint8Array]> = [
    ["artifacts/t/module.elf", artifact],
    ["manifest.json", enc.encode(JSON.stringify(manifest))],
  ];
  if (!options.missingReceipt) entries.push(["receipts/t.cmi", receipt]);
  if (options.signed) entries.push(["signature.ed25519", new Uint8Array(64)]);
  return { bytes: tar(entries), artifact, receipt };
}

describe("canopus package version rewrite", () => {
  test("a package with complete receipts is writable", async () => {
    const { bytes } = await buildPackage();
    expect(canopusPackageWriteBlocker(bytes)).toBeNull();
    const info = await readPackageVersion(new Blob([bytes as BlobPart]));
    expect(info.writable).toBe(true);
    expect(info.version).toBe("1.2.0");
    expect(info.versionCode).toBe(12);
  });

  test("rewriting version and versionCode updates receipts and their hashes", async () => {
    const { bytes, artifact } = await buildPackage();
    const file = new File([bytes as BlobPart], "hello.canopus", {
      type: "application/octet-stream",
    });
    const rewritten = await writePackageVersion(file, {
      version: "2.0.0",
      versionCode: 20,
    });
    const after = await readPackageVersion(rewritten);
    expect(after.version).toBe("2.0.0");
    expect(after.versionCode).toBe(20);
    expect(after.writable).toBe(true);

    const entries = readCanopusTarEntries(
      new Uint8Array(await rewritten.arrayBuffer()),
    );
    const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
    expect(manifestEntry).toBeDefined();
    const manifest = JSON.parse(
      new TextDecoder().decode(manifestEntry!.bytes),
    ) as Record<string, unknown>;
    expect(manifest.version).toBe("2.0.0");
    expect(manifest.version_code).toBe(20);
    expect(manifest.build_generation).toBe(20);

    const receiptEntry = entries.find((entry) => entry.name === "receipts/t.cmi");
    expect(receiptEntry).toBeDefined();
    expect(readU32(receiptEntry!.bytes, 20)).toBe(20);
    expect((manifest.artifacts as Array<Record<string, unknown>>)[0].receipt_sha256).toBe(
      await sha256Hex(receiptEntry!.bytes),
    );

    const artifactEntry = entries.find(
      (entry) => entry.name === "artifacts/t/module.elf",
    );
    expect(Array.from(artifactEntry!.bytes)).toEqual(Array.from(artifact));
  });

  test("signed packages are refused instead of producing a broken package", async () => {
    const { bytes } = await buildPackage({ signed: true });
    expect(canopusPackageWriteBlocker(bytes)).toContain("签名");
    const info = await readPackageVersion(new Blob([bytes as BlobPart]));
    expect(info.writable).toBe(false);
    expect(info.reason).toContain("签名");
    await expect(
      rewriteCanopusPackage(bytes, { version: "2.0.0", versionCode: 20 }),
    ).rejects.toThrow("签名");
  });

  test("packages without install receipts are refused", async () => {
    const { bytes } = await buildPackage({ missingReceipt: true });
    expect(canopusPackageWriteBlocker(bytes)).toContain("回执");
    const info = await readPackageVersion(new Blob([bytes as BlobPart]));
    expect(info.writable).toBe(false);
    expect(info.reason).toContain("回执");
    await expect(
      rewriteCanopusPackage(bytes, { version: "2.0.0", versionCode: 20 }),
    ).rejects.toThrow("回执");
  });
});
