import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  describeRpkDebug,
  detectRpkDebug,
} from "../../app/logic/publish/rpk-signature";

/**
 * 真实样本目录不入库。存在时跑真实包回归，不存在时跳过。
 * 样本需同时包含一个工具链内置 debug 证书包与一个正式私钥证书包。
 */
const SAMPLE_DIR = ".opencode/problem/debugreleaseexamplerpk";
const DEBUG_SAMPLE = join(SAMPLE_DIR, "com.arknights.gpoor.gacha.debug.1.0.4.rpk");
const RELEASE_SAMPLE = join(
  SAMPLE_DIR,
  "com.arknights.gpoor.gacha.release.1.1.2.rpk",
);
const HAS_SAMPLES = existsSync(DEBUG_SAMPLE) && existsSync(RELEASE_SAMPLE);

/** 构造一个只有内联 source map 这一个 soft 证据的合成 rpk（无签名块 → unsigned warn 需排除）。 */
function syntheticRpk(
  files: Record<string, string | Uint8Array>,
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
  }
  return zipSync(entries);
}

/** 未压缩源码：每行很短，平均行长远低于 400 阈值。 */
const UNMINIFIED_APP_JS = Array.from(
  { length: 200 },
  (_, i) => `  var v${i} = require("./mod${i}");`,
).join("\n");

/** 压缩产物：每行很长，平均行长远高于 400 阈值。 */
const MINIFIED_APP_JS = `var a=${Array.from({ length: 400 }, (_, i) => i).join(",")};var b=1;function f(){return a.map(function(x){return x*2+1})}`;

describe("detectRpkDebug 边界处理", () => {
  test("空输入 → skip 且有原因", async () => {
    const v = await detectRpkDebug(new Uint8Array(0));
    expect(v.level).toBe("skip");
    expect(v.reason).toBeTruthy();
  });

  test("非 ZIP 字节（CC 加密包）→ skip", async () => {
    // AES-256-ECB 密文，头部 PK\x03\x04 已破坏
    const cipher = new Uint8Array(4096).map((_, i) => (i * 37 + 11) & 0xff);
    const v = await detectRpkDebug(cipher);
    expect(v.level).toBe("skip");
    expect(v.reason).toContain("非 ZIP");
  });

  test("合法 ZIP 但无签名块 → warn（unsigned 软证据）", async () => {
    const rpk = syntheticRpk({ "manifest.json": '{"package":"com.demo"}' });
    const v = await detectRpkDebug(rpk);
    expect(v.level).toBe("warn");
    expect(v.soft).toContain("unsigned");
  });

  test("无签名块时内容层仍独立判定（不会因缺签名块漏掉调试特征）", async () => {
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "app.js": `${MINIFIED_APP_JS}\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==`,
    });
    const v = await detectRpkDebug(rpk);
    expect(v.soft).toContain("unsigned");
    expect(v.soft).toContain("entry-inline-sourcemap");
  });

  test("仅含 entry-inline-sourcemap 的合成包 → warn，soft 不升级为 fail", async () => {
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "app.js": `${MINIFIED_APP_JS}\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==`,
    });
    const v = await detectRpkDebug(rpk);
    expect(v.hard).toEqual([]);
    expect(v.soft).toContain("entry-inline-sourcemap");
    // soft 证据不升级为 fail
    expect(v.level).not.toBe("fail");
  });

  test("common/ 下带 sourcemap、入口干净 → 不命中（只看 webpack 入口）", async () => {
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "app.js": MINIFIED_APP_JS,
      // 预编译脚本自带 source map，若扫全包会误报
      "common/scripts/vendor.js": `${UNMINIFIED_APP_JS}\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==`,
    });
    const v = await detectRpkDebug(rpk);
    expect(v.soft).not.toContain("entry-inline-sourcemap");
    expect(v.soft).not.toContain("entry-js-unminified");
    expect(v.soft).toEqual(["unsigned"]);
  });

  test("包内出现 .map 文件 → hard", async () => {
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "app.js": MINIFIED_APP_JS,
      "app.js.map": "{}",
    });
    const v = await detectRpkDebug(rpk);
    expect(v.hard).toContain("map-file-in-package");
  });

  test("未压缩入口 → soft entry-js-unminified", async () => {
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "app.js": UNMINIFIED_APP_JS,
    });
    const v = await detectRpkDebug(rpk);
    expect(v.soft).toContain("entry-js-unminified");
  });

  test("accepts Blob 输入", async () => {
    const rpk = syntheticRpk({ "manifest.json": '{"package":"com.demo"}' });
    const v = await detectRpkDebug(new Blob([rpk]));
    expect(v.level).toBe("warn");
  });

  test("截断的 ZIP（中央目录缺失）→ skip 而非抛错", async () => {
    const rpk = syntheticRpk({ "manifest.json": '{"package":"com.demo"}' });
    const truncated = rpk.subarray(0, Math.floor(rpk.length / 2));
    const v = await detectRpkDebug(truncated);
    expect(v.level).toBe("skip");
    expect(v.reason).toContain("解压失败");
  });
});

describe("describeRpkDebug", () => {
  test("无证据时显示正式发布包", async () => {
    const v = await detectRpkDebug(syntheticRpk({ "manifest.json": "{}" }));
    expect(v.soft).toEqual(["unsigned"]);
    // unsigned 是证据，必须出现在摘要里而不是被当成「正式发布包」
    expect(describeRpkDebug(v)).toContain("无签名");
  });

  test("skip 透传原因", async () => {
    const v = await detectRpkDebug(new Uint8Array([1, 2, 3, 4, 5]));
    expect(describeRpkDebug(v)).toBe(v.reason);
  });
});

describe("真实 rpk 样本回归", () => {
  test.skipIf(!HAS_SAMPLES)("debug 样本 → fail 且命中内置证书", async () => {
    const v = await detectRpkDebug(new Uint8Array(await readFile(DEBUG_SAMPLE)));
    expect(v.level).toBe("fail");
    expect(v.hard).toContain("toolkit-debug-certificate");
    expect(v.certificates[0]?.fingerprintSha256).toBe(
      "4E:8E:1E:E2:49:68:B0:DA:D6:D0:95:6A:7E:14:D8:48:B3:8B:22:A2:03:F3:9C:38:9A:45:D8:73:7B:DC:45:85",
    );
  });

  test.skipIf(!HAS_SAMPLES)("release 样本 → pass", async () => {
    const v = await detectRpkDebug(
      new Uint8Array(await readFile(RELEASE_SAMPLE)),
    );
    expect(v.level).toBe("pass");
    expect(v.certificates.length).toBeGreaterThan(0);
  });

  test.skipIf(!HAS_SAMPLES)("签名块样本仍可被 fflate 正常解包", async () => {
    const bytes = new Uint8Array(await readFile(DEBUG_SAMPLE));
    expect(() => unzipSync(bytes)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 签名块定位回归
// ---------------------------------------------------------------------------

const i32le = (n: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, n, true);
  return out;
};

const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * 造一个结构自洽的最小签名块，按 SignUtil.makeSignChunk 的布局：
 *
 *   [size][0] kv(0x01000101){block.size, signdata{digests, certs, additional},
 *   signatures.size, pubkey.size, pubkey} [size][0] "RPK Sig Block 42"
 *
 * `size` = 块总长 − 8（尾部 [size][0]），与 findSignatureCertificates 的
 * `blockStart = magicIndex - (tailSize + 8) + 16` 自洽。
 */
function syntheticSigBlock(certDer: Uint8Array): Uint8Array {
  const digestEntry = concat(i32le(40), i32le(0x00000103), i32le(32), new Uint8Array(32).fill(7));
  const certEntry = concat(i32le(certDer.length), certDer);
  const signdata = concat(
    i32le(digestEntry.length),
    digestEntry,
    i32le(certEntry.length),
    certEntry,
    i32le(0),
  );
  const pubkey = new Uint8Array(8).fill(9);
  const value = concat(
    i32le(signdata.length + 8),
    i32le(signdata.length),
    signdata,
    i32le(0),
    i32le(pubkey.length),
    pubkey,
  );
  const entry = concat(i32le(value.length), i32le(0), i32le(0x01000101), i32le(value.length), value);
  // 块总长 = 块头 8 + 条目 + 魔数 16；size 不含尾部 [size][0] 的 8 字节。
  const size = 8 + entry.length + 16;
  return concat(
    i32le(size),
    i32le(0),
    entry,
    i32le(size),
    i32le(0),
    new TextEncoder().encode("RPK Sig Block 42"),
  );
}

/**
 * 把签名块插到最后一个 local file header 之后、中央目录之前，并改写 EOCD 偏移。
 *
 * 条目一律以 stored 方式写入（level 0）：断言依赖 `RPK Sig Block 42` 这个 ASCII
 * 串在**原始字节**里可被搜到，而 deflate 会把它压没，断言就成了空转。
 */
function signedRpk(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
  }
  const plain = zipSync(entries, { level: 0 });
  const block = syntheticSigBlock(new Uint8Array([0x30, 0x02, 0x30, 0x00]));
  const central = findSig(plain, [0x50, 0x4b, 0x01, 0x02]);
  const out = new Uint8Array(plain.length + block.length);
  out.set(plain.subarray(0, central), 0);
  out.set(block, central);
  out.set(plain.subarray(central), central + block.length);
  const eocd = findSig(out, [0x50, 0x4b, 0x05, 0x06]);
  const view = new DataView(out.buffer);
  view.setUint32(eocd + 16, view.getUint32(eocd + 16, true) + block.length, true);
  return out;
}

/** 从尾部方向找第一个四字节标记（EOCD 必在文件末尾，方向反了会撞中央目录）。 */
function findSig(bytes: Uint8Array, sig: number[]): number {
  for (let i = 0; i + sig.length <= bytes.length; i += 1) {
    if (sig.every((b, k) => bytes[i + k] === b)) return i;
  }
  throw new Error(`未找到标记 ${sig.map((b) => b.toString(16)).join(" ")}`);
}

describe("签名块魔数定位", () => {
  test("正文里先出现魔数 → 仍能解析到后面的真签名块", async () => {
    // 一段提到该字符串的剧情/说明文本排在签名块之前。只认第一个魔数
    // 会把整包带成「无签名」。
    const rpk = signedRpk({
      "manifest.json": '{"package":"com.demo"}',
      "common/story/prologue.txt": "提示：RPK Sig Block 42 是工具链内部结构\n",
    });
    const v = await detectRpkDebug(rpk);
    expect(v.soft).not.toContain("unsigned");
    expect(v.certificates.length).toBe(1);
  });

  test("包内出现多个魔数时按上限截断，不至于把扫描拖死", async () => {
    const noise = Array.from({ length: 64 }, (_, i) => `RPK Sig Block 42 #${i}`).join("\n");
    const rpk = signedRpk({
      "manifest.json": '{"package":"com.demo"}',
      "common/story/noise.txt": noise,
    });
    const started = performance.now();
    const v = await detectRpkDebug(rpk);
    // 前 32 个魔数全在正文里，真签名块那个落在截断之外 → 允许判成 unsigned，
    // 但必须快速返回，不能因为每个魔数都触发一次线性兜底扫描而卡住。
    expect(v.soft).toContain("unsigned");
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("签名块前的魔数不会让真块被跳过（单次即可命中）", async () => {
    const rpk = signedRpk({
      "manifest.json": '{"package":"com.demo"}',
      "common/readme.txt": "RPK Sig Block 42\n",
    });
    const v = await detectRpkDebug(rpk);
    expect(v.certificates.length).toBe(1);
    expect(v.level).not.toBe("warn");
  });
});

describe("内容层覆盖边界", () => {
  test("小体积单行压缩入口不再误报「未压缩」", async () => {
    // 压缩产物常被压成单行，length/(lines+1) 会退化成 length/2。
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "app.js": "var a=1,b=2;function f(){return a+b}console.log(f(),a,b)",
    });
    const v = await detectRpkDebug(rpk);
    expect(v.soft).not.toContain("entry-js-unminified");
  });

  test("行数够多时「未压缩」判定仍然生效", async () => {
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "app.js": UNMINIFIED_APP_JS,
    });
    const v = await detectRpkDebug(rpk);
    expect(v.soft).toContain("entry-js-unminified");
  });

  test(".jsc 入口：显式回报字节码无法判定压缩，不再静默当作干净", async () => {
    // 线上 14 个真实包里 13 个的入口是 .jsc 字节码。
    const bytecode = concat(
      new Uint8Array([0x01, 0xc7, 0x01, 0x16]),
      new TextEncoder().encode("@aiot/index"),
      new Uint8Array([0xff, 0xfe, 0xfd]),
    );
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "pages/index/index.jsc": bytecode,
    });
    const v = await detectRpkDebug(rpk);
    expect(v.soft).not.toContain("entry-js-unminified");
    expect(v.details.join(" ")).toContain("字节码");
  });

  test(".jsc 字节码里的内联 source map 仍能命中（字符串池 ASCII 完好）", async () => {
    const bytecode = concat(
      new Uint8Array([0x01, 0xc7]),
      new TextEncoder().encode(
        "//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==",
      ),
      new Uint8Array([0xff, 0xfe]),
    );
    const rpk = syntheticRpk({
      "manifest.json": '{"package":"com.demo"}',
      "app.jsc": bytecode,
    });
    const v = await detectRpkDebug(rpk);
    expect(v.soft).toContain("entry-inline-sourcemap");
  });

  test("无任何入口脚本时明确回报未校验", async () => {
    const rpk = syntheticRpk({ "manifest.json": '{"package":"com.demo"}' });
    const v = await detectRpkDebug(rpk);
    expect(v.details.join(" ")).toContain("未识别到入口脚本");
  });
});
