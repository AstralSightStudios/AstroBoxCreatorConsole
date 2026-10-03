/**
 * 与 AstroBox-NG `parse_index` 对齐的 index_v2.csv 解析。
 * 见 `src-tauri/modules/provider/src/community/officialv2/network.rs`。
 */

const REQUIRED_COLUMNS = [
  "id",
  "name",
  "restype",
  "repo_owner",
  "repo_name",
  "repo_commit_hash",
  "icon",
  "cover",
  "tags",
  "device_vendors",
  "devices",
  "paid_type",
] as const;

const RESOURCE_TYPES = [
  "quick_app",
  "watchface",
  "canopus",
  "firmware",
  "res_pack",
] as const;

const PAID_TYPES = ["free", "paid", "force_paid"] as const;

const ZERO_WIDTH = /[\u200b\u200c\u200d\u2060\ufeff]/g;

export type IndexResourceType = (typeof RESOURCE_TYPES)[number];
export type IndexPaidType = (typeof PAID_TYPES)[number];

export interface IndexV2Entry {
  id: string;
  name: string;
  restype: IndexResourceType;
  repo_owner: string;
  repo_name: string;
  repo_commit_hash: string;
  icon: string;
  cover: string;
  tags: string[];
  device_vendors: string[];
  devices: string[];
  paid_type: IndexPaidType;
}

const RESOURCE_TYPE_LABELS: Record<IndexResourceType, string> = {
  quick_app: "快应用",
  watchface: "表盘",
  canopus: "模块",
  firmware: "固件",
  res_pack: "资源包",
};

const PAID_TYPE_LABELS: Record<IndexPaidType, string> = {
  free: "免费",
  paid: "付费",
  force_paid: "强制付费",
};

export function formatIndexResourceType(restype: IndexResourceType) {
  return RESOURCE_TYPE_LABELS[restype];
}

export function formatIndexPaidType(paidType: IndexPaidType) {
  return PAID_TYPE_LABELS[paidType];
}

export function indexItemRepoUrl(entry: Pick<IndexV2Entry, "repo_owner" | "repo_name">) {
  return `https://github.com/${encodeURIComponent(entry.repo_owner)}/${encodeURIComponent(entry.repo_name)}`;
}

/** 与 NG `resolve_repo_asset_url` 相同：绝对地址原样使用，相对路径拼到仓库 raw 根上。 */
export function indexItemIconUrl(entry: IndexV2Entry) {
  const path = entry.icon.trim();
  if (!path) return "";
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith("tauri:") ||
    path.startsWith("/")
  ) {
    return path;
  }
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(entry.repo_owner)}/${encodeURIComponent(entry.repo_name)}/${encodeURIComponent(entry.repo_commit_hash)}`;
  return `${base}/${path.replace(/^\/+/, "")}`;
}

export function parseIndexV2(csv: string): IndexV2Entry[] {
  const text = csv.replace(/^\uFEFF/, "").replace(ZERO_WIDTH, "");
  const records = parseCsvRecords(text);
  const header = records[0];
  if (!header) {
    throw new Error("index_v2.csv 缺少列 id");
  }
  const columns = new Map<string, number>();
  header.forEach((name, index) => {
    if (!columns.has(name)) columns.set(name, index);
  });
  for (const required of REQUIRED_COLUMNS) {
    if (!columns.has(required)) {
      throw new Error(`index_v2.csv 缺少列 ${required}`);
    }
  }

  const entries: IndexV2Entry[] = [];
  records.slice(1).forEach((record, row) => {
    if (record.length !== header.length || record.every((field) => field === "")) {
      return;
    }
    const value = (name: string) => record[columns.get(name) ?? -1] ?? "";
    const restype = value("restype");
    const rawPaidType = value("paid_type");
    if (!isResourceType(restype) || !isRawPaidType(rawPaidType)) return;

    let id = value("id");
    const repoOwner = value("repo_owner");
    const repoName = value("repo_name");
    const commit = value("repo_commit_hash");
    if (!id || !repoOwner || !repoName || !commit) return;
    if (id === "<placeholder>") id = `placeholder_${row}`;

    entries.push({
      id,
      name: value("name"),
      restype,
      repo_owner: repoOwner,
      repo_name: repoName,
      repo_commit_hash: commit,
      icon: value("icon"),
      cover: value("cover"),
      tags: splitSemicolon(value("tags")),
      device_vendors: splitSemicolon(value("device_vendors")),
      devices: splitSemicolon(value("devices")),
      paid_type: rawPaidType === "" ? "free" : rawPaidType,
    });
  });

  if (entries.length === 0) {
    throw new Error("index_v2.csv 没有解析出任何资源");
  }
  return entries;
}

function isResourceType(value: string): value is IndexResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

function isRawPaidType(value: string): value is "" | "paid" | "force_paid" {
  return value === "" || value === "paid" || value === "force_paid";
}

function splitSemicolon(value: string) {
  return value.split(";").map((part) => part.trim());
}

/** RFC 4180，字段按 csv crate 的 Trim::All 去掉首尾空白。 */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawField = false;

  const pushField = () => {
    record.push(field.trim());
    field = "";
    sawField = false;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      sawField = true;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      sawField = true;
      continue;
    }
    if (char === ",") {
      pushField();
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      if (record.length > 0 || sawField || field.length > 0) pushRecord();
      continue;
    }
    field += char;
    sawField = true;
  }

  if (record.length > 0 || sawField || field.length > 0) pushRecord();
  return records;
}
