/**
 * `.canopus` 包的测试夹具：手写未压缩 tar（mtime 为 0、无签名），
 * 结构与 canopus package 的真实产物一致，但只有 manifest.json，
 * 不携带 ELF 字节，够覆盖清单解析的每条校验。
 */

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

export function tar(entries: Array<[string, Uint8Array]>): Uint8Array {
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

export function pack(manifest: Record<string, unknown>): Uint8Array {
  return tar([["manifest.json", new TextEncoder().encode(JSON.stringify(manifest))]]);
}

/** 各用例共用的清单底稿，只覆盖会被改写的字段。 */
export const CANOPUS_BASE = {
  schema: 1,
  module_id: "hello_portable",
  version: "1.2.0",
  version_code: 12,
  canopus_abi: "1",
};
