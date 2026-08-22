export type ResourceType = "quick_app" | "watchface" | "canopus";

export function isResourceType(value: unknown): value is ResourceType {
  return value === "quick_app" || value === "watchface" || value === "canopus";
}

export function normalizeResourceType(value: unknown): ResourceType {
  return isResourceType(value) ? value : "quick_app";
}

export function formatResourceType(restype?: string): string {
  if (restype === "quick_app") return "快应用";
  if (restype === "watchface") return "表盘";
  if (restype === "canopus") return "模块";
  if (restype === "resource") return "资源";
  return restype || "未知";
}
