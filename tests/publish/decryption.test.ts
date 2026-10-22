import { describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  decodeResourceKey,
  decryptAes256Ecb,
} from "../../app/logic/publish/decryption";

// 与 CC 发布端（Rust aes/ecb + Pkcs7）和 AstroBox 客户端同一格式：AES-256-ECB + PKCS#7。
function encryptEcb(plain: Uint8Array, key: Uint8Array) {
  const cipher = createCipheriv("aes-256-ecb", key, null);
  return new Uint8Array(Buffer.concat([cipher.update(plain), cipher.final()]));
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

describe("decryptAes256Ecb", () => {
  test("round-trips every length around block boundaries and a large package", async () => {
    const key = randomBytes(32);
    for (const length of [0, 1, 15, 16, 17, 31, 32, 33, 4095, 1024 * 1024 + 3]) {
      const plain = new Uint8Array(randomBytes(length));
      const decrypted = await decryptAes256Ecb(encryptEcb(plain, key), toBase64(key));
      expect(decrypted.length).toBe(length);
      expect(Buffer.from(decrypted).equals(Buffer.from(plain))).toBe(true);
    }
  });

  test("identical plaintext blocks stay identical, i.e. this really is ECB", async () => {
    const key = new Uint8Array(32).fill(3);
    const plain = new Uint8Array(64).fill(0x41);
    const ciphertext = encryptEcb(plain, key);
    expect(Buffer.from(ciphertext.subarray(0, 16)).equals(Buffer.from(ciphertext.subarray(16, 32)))).toBe(true);
    expect(Array.from(await decryptAes256Ecb(ciphertext, toBase64(key)))).toEqual(Array.from(plain));
  });

  test("a wrong key or a non-ciphertext is rejected instead of yielding garbage", async () => {
    const plain = new TextEncoder().encode("PK\u0003\u0004 not really a quick app");
    const ciphertext = encryptEcb(plain, new Uint8Array(32).fill(1));
    await expect(decryptAes256Ecb(ciphertext, toBase64(new Uint8Array(32).fill(2)))).rejects.toThrow(
      "密钥与包体不匹配",
    );
    await expect(decryptAes256Ecb(plain, toBase64(new Uint8Array(32).fill(1)))).rejects.toThrow(
      "16 字节",
    );
    await expect(decryptAes256Ecb(new Uint8Array(0), toBase64(new Uint8Array(32)))).rejects.toThrow();
  });
});

describe("decodeResourceKey", () => {
  const raw = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 65));

  test("accepts the same key formats as the AstroBox client", () => {
    expect(Array.from(decodeResourceKey(Buffer.from(raw).toString("hex")))).toEqual(Array.from(raw));
    expect(Array.from(decodeResourceKey(` ${toBase64(raw)} `))).toEqual(Array.from(raw));
    expect(Array.from(decodeResourceKey(new TextDecoder().decode(raw)))).toEqual(Array.from(raw));
  });

  test("refuses keys that are not 32 bytes", () => {
    expect(() => decodeResourceKey(toBase64(new Uint8Array(16)))).toThrow("32 字节");
    expect(() => decodeResourceKey("short")).toThrow("32 字节");
  });
});
