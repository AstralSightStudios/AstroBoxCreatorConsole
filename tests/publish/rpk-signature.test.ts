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
function syntheticRpk(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = new TextEncoder().encode(content);
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
