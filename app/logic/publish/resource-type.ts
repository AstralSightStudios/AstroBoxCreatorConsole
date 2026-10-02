export type ResourceType = "quick_app" | "watchface" | "canopus" | "res_pack";

export function isResourceType(value: unknown): value is ResourceType {
  return (
    value === "quick_app" ||
    value === "watchface" ||
    value === "canopus" ||
    value === "res_pack"
  );
}

export function normalizeResourceType(value: unknown): ResourceType {
  return isResourceType(value) ? value : "quick_app";
}

export function formatResourceType(restype?: string): string {
  if (restype === "quick_app") return "快应用";
  if (restype === "watchface") return "表盘";
  if (restype === "canopus") return "模块";
  if (restype === "res_pack") return "资源包";
  if (restype === "resource") return "资源";
  return restype || "未知";
}

export function getRepoTopicsForResourceType(restype?: string): string[] {
  const baseTopics = ["astrobox-resource"];
  switch (restype) {
    case "quick_app":
      return [...baseTopics, "quickapp"];
    case "watchface":
      return [...baseTopics, "watchface"];
    case "canopus":
      return [...baseTopics, "canopus"];
    case "res_pack":
      return [...baseTopics, "res-pack"];
    default:
      return baseTopics;
  }
}
