/**
 * 快应用 rpk「debug 调试包」判定。
 *
 * 背景：部分创作者用工具链的调试构建产物（`hap/aiot build`、`watch`、`run`）而不是
 * 正式发布产物（`aiot release`）打包后提交。调试包由工具链自带的公开证书签名
 * （任何人都能复现），未压缩未混淆，完整源码与 source map 直接躺在包体里。
 *
 * 判定依据（均来自 aiot-toolkit / @aiot-toolkit/aiotpack 反编译核实）：
 *
 * 1. **构建模式由命令名硬编码**（aiot-toolkit/lib/bin.js:58）
 *      option.mode = command === 'release' ? PRODUCTION : DEVELOPMENT
 *    且 UxBuilderBase.js:120 里 mode 缺省也是 DEVELOPMENT —— 只有 `aiot release`
 *    才是 PRODUCTION。
 *
 * 2. **签名证书按模式解析**（aiot-pack/.../signature/SignUtil.js:58-67）
 *      DEVELOPMENT: [sign/debug, sign/, defaultDevelopment]  ← 有内置证书兜底
 *      PRODUCTION:   [sign/release, sign/]                  ← 无内置证书兜底
 *    PRODUCTION 找不到开发者私钥会直接抛错，因此**物理上不可能**用工具链内置证书
 *    签名。这是整套判定里唯一的逻辑保证（零误报来源）。
 *
 * 3. **`.map` 文件在 PRODUCTION 被显式排除**（ZipUtil.js:222）
 *      item.startsWith(DIGEST_ZIP_DIR) || mode === PRODUCTION && /\.map$/.test(item)
 *    即 rpk 里出现 `.map` ⇒ 必然是 DEVELOPMENT 构建。
 *
 * 4. **压缩行为按模式分叉**（JavascriptCompiler.js:93）
 *    DEVELOPMENT 不压缩不混淆；PRODUCTION 压缩 + 混淆。
 *
 * 以下特征在两种模式间完全重叠，**不得**用于判定：`.jsc` 存在与否、
 * `.style.bin`/`.template.bin`、`manifest.json` 的缩进与 `packageInfo`、
 * `META-INF/build.txt` 全部字段、zip 注释、`config.logLevel`、
 * `manifest.config.debug`、以及文件名里的 `debug`/`release`
 * （可被 `defineOptions.PACKAGE_TYPE` 覆盖，也可直接改名；线上同时存在
 * 「名字带 .debug. 却是正式私钥签名」与「名字干净却是内置 debug 证书」双向样本）。
 */

// ---------------------------------------------------------------------------
// 阈值常量（来源见上）
// ---------------------------------------------------------------------------

/** 工具链内置 debug 证书的 SHA-256 指纹（大写冒号分隔）。 */
const TOOLKIT_DEBUG_CERT_FINGERPRINTS = new Set([
  // aiot-toolkit / aiotpack 2.0.5 与 @hap-toolkit/packager 2.x 内置同一张
  // subject=CN=localhost, serial=B478C65891B3EABF, 2021-04-07 ~ 2031-04-05
  "4E:8E:1E:E2:49:68:B0:DA:D6:D0:95:6A:7E:14:D8:48:B3:8B:22:A2:03:F3:9C:38:9A:45:D8:73:7B:DC:45:85",
  // 早期 hap-toolkit 0.0.x ~ 0.3.x 工程模板 sign/debug/certificate.pem
  // subject=C=CN, O=RPK, CN=RPKDebug
  "6D:3E:6A:3D:CB:DA:DB:0A:A9:4F:64:E3:3A:36:B0:12:54:CB:6E:F7:E1:4B:E2:82:D8:85:CD:95:AE:B9:52:E0",
]);

/** 无 `crypto.subtle`（非安全上下文）时的 CN 兜底白名单。 */
const TOOLKIT_DEBUG_CERT_CNS = new Set(["localhost", "rpkdebug"]);

/**
 * 入口 JS 平均行长低于此值视为「未压缩未格式化」。
 *
 * 实测 367 个官方源真实 rpk：被判 beautify 的入口平均行长落在 31.7 ~ 147.8，
 * 而 298 个 pass 包中最低的一例也有 492.5，阈值两侧有 3.3 倍间隔。保持 soft。
 */
const BEAUTIFY_LINE_THRESHOLD = 400;

/** rpk 签名块尾的固定 16 字节 ASCII 魔数（SignUtil.SigMagic）。 */
const SIG_MAGIC = "RPK Sig Block 42";

function emptyVerdict(reason: string): RpkDebugVerdict {
  return {
    level: "skip",
    hard: [],
    soft: [],
    certificates: [],
    details: [],
    reason,
  };
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type RpkDebugLevel = "pass" | "warn" | "fail" | "skip";

export interface RpkCertificateInfo {
  subjectCn?: string;
  issuerCn?: string;
  serial?: string;
  /** 大写冒号分隔十六进制；非安全上下文取不到 `crypto.subtle` 时为 undefined。 */
  fingerprintSha256?: string;
  isToolkitDebug: boolean;
}

export interface RpkDebugVerdict {
  level: RpkDebugLevel;
  /** 硬证据 ID 列表，命中任意一条即 fail。 */
  hard: string[];
  /** 软证据 ID 列表，仅用于警告。 */
  soft: string[];
  certificates: RpkCertificateInfo[];
  details: string[];
  /** skip / warn 的原因说明。 */
  reason?: string;
}

// ---------------------------------------------------------------------------
// 字节工具
// ---------------------------------------------------------------------------

const i32le = (b: Uint8Array, o: number): number =>
  b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

/**
 * 在字节流中查找 ASCII 子串。
 *
 * 注意：不能直接用 `Uint8Array.prototype.indexOf` —— 它不接受 string/Buffer
 * 作为 needle，会把参数强制转成数字（NaN）后恒返回 -1。必须手写字节比较。
 */
function indexOfAscii(bytes: Uint8Array, ascii: string): number {
  const first = ascii.charCodeAt(0);
  const limit = bytes.length - ascii.length;
  outer: for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] !== first) continue;
    for (let k = 1; k < ascii.length; k += 1) {
      if (bytes[i + k] !== ascii.charCodeAt(k)) continue outer;
    }
    return i;
  }
  return -1;
}

/** 读取 DER TLV 头；返回 {tag, content, next}，格式非法时返回 null。 */
function readDerTlv(der: Uint8Array, offset: number) {
  if (offset >= der.length) return null;
  const tag = der[offset];
  let p = offset + 1;
  if ((tag & 0x1f) === 0x1f) {
    while (p < der.length && (der[p] & 0x80) !== 0) p += 1;
    p += 1;
  }
  if (p >= der.length) return null;
  let len = der[p];
  p += 1;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) return null;
    len = 0;
    for (let i = 0; i < n; i += 1) len = (len << 8) | der[p + i];
    p += n;
  }
  return { tag, content: p, next: p + len };
}

/**
 * 在 DER 子树中查找 commonName（OID 2.5.4.3 = 55 04 03）并返回其字符串值。
 *
 * 必须递归下降 constructed tag：Name → RDNSequence → RelativeDistinguishedName
 * → SET → AttributeTypeAndValue 有四层嵌套，跳过而不下降就永远找不到 CN。
 */
function findCommonName(
  der: Uint8Array,
  start: number,
  end: number,
  depth = 0,
): string | undefined {
  if (depth > 12) return undefined;
  let p = start;
  while (p + 2 <= end) {
    const tlv = readDerTlv(der, p);
    if (!tlv || tlv.next > end) return undefined;
    if (
      tlv.tag === 0x06 &&
      tlv.next - tlv.content === 3 &&
      der[tlv.content] === 0x55 &&
      der[tlv.content + 1] === 0x04 &&
      der[tlv.content + 2] === 0x03
    ) {
      const value = readDerTlv(der, tlv.next);
      if (value && value.next <= end) {
        return new TextDecoder().decode(der.subarray(value.content, value.next));
      }
    }
    if ((tlv.tag & 0x20) !== 0) {
      const found = findCommonName(der, tlv.content, tlv.next, depth + 1);
      if (found !== undefined) return found;
    }
    p = tlv.next;
  }
  return undefined;
}

async function sha256Fingerprint(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  try {
    // 复制到自有 ArrayBuffer：subtle.digest 的 BufferSource 不接受
    // 泛型为 ArrayBufferLike 的视图（TS 5.7+ 的 Uint8Array 泛型）。
    const view = Uint8Array.from(bytes);
    const digest = await subtle.digest("SHA-256", view.buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(":")
      .toUpperCase();
  } catch {
    return undefined;
  }
}

/**
 * 轻量证书解析：只取 subject CN / issuer CN / 序列号，不做完整 ASN.1 校验。
 *
 * 字段顺序（X.509 tbsCertificate）：`[0]version? serial signature issuer
 * validity subject ...` —— serial 之后连续四个 SEQUENCE，只有 issuer 与 subject
 * 带 CN。漏掉任何一个都会读错字段。
 */
async function parseCertificate(der: Uint8Array): Promise<RpkCertificateInfo> {
  const info: RpkCertificateInfo = {
    fingerprintSha256: await sha256Fingerprint(der),
    isToolkitDebug: false,
  };
  try {
    const outer = readDerTlv(der, 0);
    if (!outer || outer.tag !== 0x30) return info;
    const tbs = readDerTlv(der, outer.content);
    if (!tbs || tbs.tag !== 0x30) return info;

    const outerEnd = Math.min(der.length, outer.next);
    const tbsEnd = Math.min(outerEnd, tbs.next);
    let r = tbs.content;

    if (der[r] === 0xa0) {
      const version = readDerTlv(der, r); // 可选的显式 [0] version
      if (!version) return info;
      r = version.next;
    }
    if (der[r] === 0x02) {
      const serial = readDerTlv(der, r);
      if (!serial) return info;
      info.serial = Array.from(der.subarray(serial.content, serial.next))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      r = serial.next;
    }

    const fields: Array<"issuer" | "subject" | null> = [
      null, // signature AlgorithmIdentifier
      "issuer",
      null, // validity
      "subject",
    ];
    for (const want of fields) {
      if (r >= tbsEnd) break;
      const fld = readDerTlv(der, r);
      if (!fld) return info;
      if (want) {
        const cn = findCommonName(der, fld.content, fld.next);
        if (want === "issuer") info.issuerCn = cn;
        else info.subjectCn = cn;
      }
      r = fld.next;
    }
  } catch {
    // CN / serial 是尽力而为，解析失败不影响指纹判据
  }
  return info;
}

// ---------------------------------------------------------------------------
// 签名块定位
// ---------------------------------------------------------------------------

/**
 * 定位签名块并取出其中的证书 DER。
 *
 * 字节布局（全部小端 int32，来自 SignUtil.makeSignChunk / saveSignChunk）：
 *
 *   [int32 signchunk.size][int32 0]                    ← 块头
 *     条目 1..n:
 *       [int32 kv.size][int32 0][int32 kv.id][int32 kv.value.size] <value>
 *         kv.id == 0x01000101 → 签名块数组（signdata / signatures / pubkey）
 *         kv.id == 0x01000201 → 文件摘要列表（不透明）
 *   [int32 signchunk.size][int32 0]
 *   "RPK Sig Block 42"                                  ← 16 字节块尾魔数
 *
 * `saveChunk` 把整个签名块插在**最后一个 local file header 之后、中央目录之前**
 * （只改写 EOCD 里的「中央目录起始偏移」），所以块尾魔数并不在文件末尾 ——
 * 魔数之后还有中央目录与 EOCD（实测 0.6KB ~ 87KB）。
 *
 * 由 `signchunk.len === signchunk.size + 8` 且魔数位于块的最后 16 字节可推出：
 *
 *   blockStart = magicIndex - (tailSize + 8) + 16
 *
 * 不能用「魔数前最后一个 00 00 00 00」当锚点：那个位置是块尾 `[size][0]` 里的
 * `0`，据此回推必然错位。
 */
function findSignatureCertificates(bytes: Uint8Array): Uint8Array[] | null {
  const magicIndex = indexOfAscii(bytes, SIG_MAGIC);
  if (magicIndex < 8) return null;

  const tailSize = i32le(bytes, magicIndex - 8);
  const blockEnd = magicIndex - 8; // 条目区结束位置（不含块尾 [size][0]）

  const parseFrom = (blockStart: number): Uint8Array[] | null => {
    if (blockStart < 0 || blockStart + 8 > bytes.length) return null;
    if (i32le(bytes, blockStart) !== tailSize) return null;
    if (i32le(bytes, blockStart + 4) !== 0) return null;

    const certs: Uint8Array[] = [];
    let p = blockStart + 8;
    let guard = 0;

    while (p < blockEnd) {
      if (guard > 64) return null;
      guard += 1;
      const id = i32le(bytes, p + 8);

      if (id === 0x01000101) {
        // kv 头之后是 [int32 block.size][int32 signdata.size][signdata...]
        const signdataSize = i32le(bytes, p + 20);
        const signdataStart = p + 24;
        const signdataEnd = signdataStart + signdataSize;
        if (signdataEnd > blockEnd) return null;

        // signdata ::= [int32 digests.size][摘要条目][int32 certs.size][证书条目][int32 additional]
        const digestsSize = i32le(bytes, signdataStart);
        let dp = signdataStart + 4;
        const digestsEnd = dp + digestsSize;
        if (digestsEnd > signdataEnd) return null;
        // 摘要条目：[int32 blobLen][int32 0x0103][int32 hashLen][hash]
        // 外层 size 字段与实际写入字节数不一致，只能靠内部自描述字段步进。
        while (dp < digestsEnd) {
          const hashLen = i32le(bytes, dp + 8);
          if (hashLen < 0) return null;
          dp += 12 + hashLen;
          if (dp > digestsEnd) return null;
        }
        if (dp !== digestsEnd) return null;

        const certsSize = i32le(bytes, digestsEnd);
        let cp = digestsEnd + 4;
        const certsEnd = cp + certsSize;
        if (certsEnd > signdataEnd) return null;
        while (cp < certsEnd) {
          const derSize = i32le(bytes, cp);
          if (derSize <= 0 || cp + 4 + derSize > certsEnd) return null;
          certs.push(bytes.subarray(cp + 4, cp + 4 + derSize));
          cp += 4 + derSize;
        }
        if (cp !== certsEnd) return null;

        // 之后是 [int32 signatures.size][签名条目...] 与 [int32 pubkey.size][公钥]。
        // 同样因为外层 size 比实际写入少 4，算不出数组终点；改为从块尾反推：
        // 公钥是块内最后一段 DER SPKI，其长度前缀紧贴它之前。
        let anchor = -1;
        for (let q = signdataEnd + 4; q < blockEnd; q += 1) {
          const pubSize = i32le(bytes, q);
          if (pubSize > 0 && q + 4 + pubSize === blockEnd) {
            anchor = q;
            break;
          }
        }
        if (anchor < 0) return null;

        // 签名块数组后可能还有 0x01000201 文件摘要条目。
        if (anchor + 4 + i32le(bytes, anchor) >= blockEnd) {
          p = blockEnd;
          break;
        }
        p = anchor + 4 + i32le(bytes, anchor);
      } else if (id === 0x01000201) {
        // 文件摘要列表不透明，且位于块尾，直接收尾。
        p = blockEnd;
        break;
      } else {
        return null;
      }
    }

    if (p !== blockEnd) return null;
    return certs;
  };

  const primary = parseFrom(magicIndex - (tailSize + 8) + 16);
  if (primary) return primary;

  // 兜底：在魔数附近扫描能顺解到块尾的候选块头。
  const lo = Math.max(0, magicIndex - tailSize - 256);
  for (let s = lo; s <= magicIndex - 16; s += 4) {
    const r = parseFrom(s);
    if (r) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 主判定
// ---------------------------------------------------------------------------

function isToolkitDebugCertificate(cert: RpkCertificateInfo): boolean {
  if (cert.fingerprintSha256 && TOOLKIT_DEBUG_CERT_FINGERPRINTS.has(cert.fingerprintSha256)) {
    return true;
  }
  const cn = cert.subjectCn?.toLowerCase();
  if (!cn || !TOOLKIT_DEBUG_CERT_CNS.has(cn)) return false;
  // 指纹不可用时的兜底：自签名 + 命中 CN 白名单。
  // 官方源里开发者证书几乎全是自签名，所以 CN 白名单才是有效约束，
  // 自签名只作为附加确认，不作为主要判据。
  return Boolean(cert.issuerCn) && cert.issuerCn === cert.subjectCn;
}

/** 快应用入口脚本：只认 app.js 与 pages/ 下的 js，不扫全包。 */
function isEntryScript(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  if (base === "app.js") return true;
  return base.endsWith(".js") && name.startsWith("pages/");
}

export async function detectRpkDebug(
  input: Blob | Uint8Array,
): Promise<RpkDebugVerdict> {
  let bytes: Uint8Array;
  try {
    bytes =
      input instanceof Uint8Array
        ? input
        : new Uint8Array(await (input as Blob).arrayBuffer());
  } catch {
    return emptyVerdict("包体读取失败");
  }

  if (bytes.length < 4) {
    return emptyVerdict("包体过小");
  }
  // CC 加密包为 AES-256-ECB 密文（src-tauri/src/lib.rs:137），头部魔数已被破坏。
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return emptyVerdict("非 ZIP 结构（已加密或非 rpk）");
  }

  const hard: string[] = [];
  const soft: string[] = [];
  const details: string[] = [];
  const certificates: RpkCertificateInfo[] = [];

  // L1 证书层。无签名块本身是一条 soft 证据（生产环境不应分发无签名包），
  // 但不能就此收尾 —— 内容层是独立判据，无签名包同样可能带调试产物特征。
  const ders = findSignatureCertificates(bytes);
  if (ders) {
    for (const der of ders) {
      const cert = await parseCertificate(der);
      cert.isToolkitDebug = isToolkitDebugCertificate(cert);
      certificates.push(cert);
      if (cert.isToolkitDebug) hard.push("toolkit-debug-certificate");
    }
    if (hard.length > 0) {
      const cn = certificates.find((c) => c.isToolkitDebug)?.subjectCn;
      details.push(
        `签名证书使用工具链内置调试证书${cn ? `（CN=${cn}）` : ""}，非正式发布包`,
      );
    }
  } else {
    soft.push("unsigned");
    details.push("未找到签名块，无签名包不应在生产环境分发");
  }

  // L2 内容层。解压失败时，已有 hard 证据仍足以判定为 fail，否则只能 skip。
  let entries: Record<string, Uint8Array>;
  try {
    const { unzipSync } = await import("fflate");
    entries = unzipSync(bytes);
  } catch {
    if (hard.length > 0) {
      return { level: "fail", hard, soft, certificates, details, reason: "包体解压失败，内容层未校验" };
    }
    return {
      level: "skip",
      hard,
      soft,
      certificates,
      details,
      reason: "包体解压失败（下载不完整或已损坏）",
    };
  }

  const names = Object.keys(entries);

  // PRODUCTION 显式排除 .map，因此出现即判定为 DEVELOPMENT 构建。
  if (names.some((n) => n.endsWith(".map"))) {
    hard.push("map-file-in-package");
    details.push("包内含 .map 源映射文件，正式构建不会产出");
  }
  if (names.some((n) => n.startsWith("debug/"))) {
    soft.push("root-debug-dir");
    details.push("包内含根目录 debug/");
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let inlineSourcemap = 0;
  let beautified = 0;
  for (const name of names) {
    if (!isEntryScript(name)) continue;
    const text = decoder.decode(entries[name]);
    if (text.includes("sourceMappingURL=data:")) inlineSourcemap += 1;
    const avgLineLength = text.length / (text.split("\n").length + 1);
    if (avgLineLength < BEAUTIFY_LINE_THRESHOLD) beautified += 1;
  }
  if (inlineSourcemap > 0) {
    soft.push("entry-inline-sourcemap");
    details.push(`${inlineSourcemap} 个入口脚本内联了 source map`);
  }
  if (beautified > 0) {
    soft.push("entry-js-unminified");
    details.push(`${beautified} 个入口脚本未压缩`);
  }

  const level: RpkDebugLevel =
    hard.length > 0 ? "fail" : soft.length > 0 ? "warn" : "pass";
  return { level, hard, soft, certificates, details };
}

const DEBUG_EVIDENCE_LABELS: Record<string, string> = {
  "toolkit-debug-certificate": "调试证书",
  "map-file-in-package": "含 .map",
  "entry-inline-sourcemap": "入口内联 source map",
  "entry-js-unminified": "入口未压缩",
  "root-debug-dir": "含 debug/ 目录",
  unsigned: "无签名",
};

/** 生成人类可读的结论摘要，用于检查项 detail 与包体行展示。 */
export function describeRpkDebug(verdict: RpkDebugVerdict): string {
  if (verdict.level === "skip") {
    return verdict.reason ?? "已跳过";
  }
  const evidence = [...verdict.hard, ...verdict.soft];
  if (evidence.length === 0) return "正式发布包";
  const label =
    verdict.level === "fail" ? "调试包" : verdict.level === "warn" ? "疑似调试包" : "通过";
  const shown = evidence.map((id) => DEBUG_EVIDENCE_LABELS[id] ?? id);
  return `${label}（${shown.join("、")}）`;
}
