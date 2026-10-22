/**
 * 资源包体的 AES-256-ECB（PKCS#7）解密，与 `encryption.ts` 的加密、AstroBox 客户端的
 * `commprov_resource_file_decrypt` 是同一套格式。
 *
 * 用 WebCrypto 实现，Tauri 与纯浏览器都能用，也不用把几十 MB 包体 base64 过一遍 IPC。
 * WebCrypto 没有 ECB，这里借 CBC 算：IV 全零时 CBC 解出的第 i 块是 D(Cᵢ) ⊕ Cᵢ₋₁，再异或回
 * Cᵢ₋₁ 就是 ECB 的 D(Cᵢ)。CBC 解密会校验末块的 PKCS#7 填充，所以先在密文后补一块
 * E(0x10×16 ⊕ Cₙ)，让它解出一整块合法填充、被 WebCrypto 自己剥掉。
 */

const BLOCK = 16;

function bytesFromHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesFromBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 解析服务端登记的密钥，顺序与 AstroBox 客户端 `decode_resource_key` 一致：
 * 64 位十六进制 → base64 → 恰好 32 字节的原文。
 */
export function decodeResourceKey(key: string): Uint8Array {
  const trimmed = key.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return bytesFromHex(trimmed);
  try {
    const decoded = bytesFromBase64(trimmed);
    if (decoded.length === 32) return decoded;
  } catch {
    // 不是 base64，继续按原文试
  }
  const utf8 = new TextEncoder().encode(trimmed);
  if (utf8.length === 32) return utf8;
  throw new Error("密钥格式无效（需要 32 字节的 AES-256 密钥）");
}

export async function decryptAes256Ecb(
  ciphertext: Uint8Array,
  key: string,
): Promise<Uint8Array> {
  if (ciphertext.length === 0 || ciphertext.length % BLOCK !== 0) {
    throw new Error("密文长度不是 16 字节的整数倍，不是加密包体");
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("当前环境不支持 WebCrypto，无法解密");

  const cryptoKey = await subtle.importKey(
    "raw",
    Uint8Array.from(decodeResourceKey(key)),
    { name: "AES-CBC" },
    false,
    ["encrypt", "decrypt"],
  );

  const lastBlock = ciphertext.slice(ciphertext.length - BLOCK);
  const fullPadding = new Uint8Array(BLOCK).fill(BLOCK);
  // CBC 加密一块的第一块输出就是 E(0x10×16 ⊕ Cₙ)
  const tail = new Uint8Array(
    await subtle.encrypt({ name: "AES-CBC", iv: lastBlock }, cryptoKey, fullPadding),
  ).subarray(0, BLOCK);

  const chained = new Uint8Array(ciphertext.length + BLOCK);
  chained.set(ciphertext);
  chained.set(tail, ciphertext.length);
  const plain = new Uint8Array(
    await subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(BLOCK) }, cryptoKey, chained),
  );

  // 去掉 CBC 的链式异或：每块再异或一次前一块密文（第一块对应的 IV 是零，不用动）
  for (let i = BLOCK; i < plain.length; i += 1) plain[i] ^= ciphertext[i - BLOCK];

  const padding = plain[plain.length - 1];
  if (padding < 1 || padding > BLOCK) throw new Error("密钥与包体不匹配");
  for (let i = plain.length - padding; i < plain.length; i += 1) {
    if (plain[i] !== padding) throw new Error("密钥与包体不匹配");
  }
  return plain.subarray(0, plain.length - padding);
}
