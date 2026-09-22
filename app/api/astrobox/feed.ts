import { sendApiRequest } from "./request";

export type FeedFeature = {
  tag: string;
  confidence: number;
  evidence: string;
  source: "rule" | "ai" | "manual";
};

export type FeedStatus = {
  enabled: boolean;
  workerEnabled: boolean;
  aiEnabled: boolean;
  aiDailyLimit: number;
  bandbbsConfigured: boolean;
  algorithmVersion: string;
  sources: Array<{ _id: { source: string; status: string }; count: number }>;
  jobs: Array<{ _id: { kind: string; state: string }; count: number }>;
  pendingProfiles: number;
  tracking: { inFlight: number; droppedSinceStart: number; failedSinceStart: number };
  states: Array<{ _id: string; data?: Record<string, unknown>; updatedAt?: string }>;
};

export type FeedItem = {
  key: string;
  source: "astrobox" | "bandbbs";
  sourceId: string;
  provider: string;
  title: string;
  summary?: string;
  resourceType: string;
  sourceTags: string[];
  ruleFeatures: FeedFeature[];
  aiFeatures: FeedFeature[];
  manualFeatures: FeedFeature[] | null;
  compatibility: {
    verifiedDeviceIds: string[];
    possibleDeviceIds: string[];
    evidence: string[];
  };
  manualCompatibility?: FeedItem["compatibility"] | null;
  status: string;
  hidden: boolean;
  canonicalGroupId?: string;
  sourceRevision: string;
  detailRevision: string;
  ai: { fingerprint: string; model?: string; generatedAt?: string; error?: string };
  detail?: Record<string, unknown>;
  version?: string;
  stats?: { views: number; downloads: number; ratingCount: number; ratingSum: number; trend: number };
  lastSeenAt?: string;
  firstSeenAt?: string;
};

export type FeedJob = {
  _id: string;
  kind: string;
  state: string;
  attempts: number;
  lastError?: string;
  availableAt?: string;
  updatedAt?: string;
};

function query(params: Record<string, string | number | undefined>) {
  const value = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return value ? `?${value}` : "";
}

export const FeedAdminApi = {
  status: () => sendApiRequest<FeedStatus>("/admin/feed/status", "GET"),
  items: (params: { source?: string; status?: string; after?: string; limit?: number } = {}) =>
    sendApiRequest<{ items: FeedItem[]; nextCursor: string | null }>(`/admin/feed/items${query(params)}`, "GET"),
  item: (key: string) => sendApiRequest<FeedItem>(`/admin/feed/items/${encodeURIComponent(key)}`, "GET"),
  patchItem: (key: string, body: Partial<Pick<FeedItem, "hidden" | "canonicalGroupId" | "manualFeatures" | "manualCompatibility">>) =>
    sendApiRequest<FeedItem>(`/admin/feed/items/${encodeURIComponent(key)}`, "PATCH", undefined, body),
  enrich: (key: string) => sendApiRequest<{ queued: boolean }>(`/admin/feed/items/${encodeURIComponent(key)}/enrich`, "POST", undefined, {}),
  jobs: () => sendApiRequest<{ items: FeedJob[] }>("/admin/feed/jobs", "GET"),
  retryJob: (jobId: string) => sendApiRequest<{ queued: boolean }>("/admin/feed/jobs/retry", "POST", undefined, { jobId }),
  run: (task: "official" | "devices" | "bandbbs" | "enrichment" | "stats" | "profiles") =>
    sendApiRequest<{ queued: boolean }>("/admin/feed/run", "POST", undefined, { task }),
};
