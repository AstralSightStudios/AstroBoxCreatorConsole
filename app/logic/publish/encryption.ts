import { invoke } from "@tauri-apps/api/core";

function isTauriEnvironment() {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as any).__TAURI_INTERNALS__ ||
        (window as any).__TAURI_METADATA__ ||
        (window as any).__TAURI_IPC__,
    )
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const normalized = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", normalized.buffer);
  return bytesToHex(new Uint8Array(digest));
}

function randomKeyBase64(): string {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return bytesToBase64(key);
}

export async function encryptFileWithAes256Ecb(file: File): Promise<{
  encryptedFile: File;
  encryptedHash: string;
  keyBase64: string;
}> {
  if (!isTauriEnvironment()) {
    throw new Error("AES-256-ECB 加密仅支持 Tauri 客户端环境。");
  }

  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const keyBase64 = randomKeyBase64();
  const encryptedBase64 = await invoke<string>("encrypt_aes_256_ecb", {
    dataBase64: bytesToBase64(originalBytes),
    keyBase64,
  });

  const encryptedBytes = base64ToBytes(encryptedBase64);
  const encryptedHash = await sha256Hex(encryptedBytes);
  const encryptedBuffer = Uint8Array.from(encryptedBytes).buffer;
  const encryptedFile = new File([encryptedBuffer], file.name, {
    type: file.type || "application/octet-stream",
  });

  return {
    encryptedFile,
    encryptedHash,
    keyBase64,
  };
}
