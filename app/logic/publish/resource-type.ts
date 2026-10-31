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

/**
 * 资源包（CRPack）与模块（Canopus）目前只有小米设备消费，设备库里的
 * vivo 等厂商即便出现在下拉里也不该被选中。
 */
export function isXiaomiOnlyResourceType(restype?: string | null): boolean {
  return restype === "canopus" || restype === "res_pack";
}

/** 指定资源类型是否接受该厂商的设备；非小米专属类型不限制厂商。 */
export function isDeviceVendorSupportedByResourceType(
  restype: string | null | undefined,
  vendor: string | null | undefined,
): boolean {
  if (!isXiaomiOnlyResourceType(restype)) return true;
  return (vendor ?? "").trim().toLowerCase() === "xiaomi";
}

/** 按资源类型过滤设备选项，避免小米专属资源选到 vivo 设备。 */
export function filterDeviceOptionsByResourceType<T extends { vendor?: string }>(
  options: readonly T[],
  restype?: string | null,
): T[] {
  if (!isXiaomiOnlyResourceType(restype)) return [...options];
  return options.filter((option) =>
    isDeviceVendorSupportedByResourceType(restype, option.vendor),
  );
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
