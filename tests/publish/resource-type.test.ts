import { describe, expect, test } from "bun:test";
import {
  filterDeviceOptionsByResourceType,
  formatResourceType,
  getRepoTopicsForResourceType,
  isDeviceVendorSupportedByResourceType,
  isResourceType,
  isXiaomiOnlyResourceType,
  normalizeResourceType,
} from "../../app/logic/publish/resource-type";

describe("resource type labels", () => {
  test("formats supported resource types", () => {
    expect(formatResourceType("quick_app")).toBe("快应用");
    expect(formatResourceType("watchface")).toBe("表盘");
    expect(formatResourceType("canopus")).toBe("模块");
    expect(formatResourceType("res_pack")).toBe("资源包");
  });

  test("preserves unknown labels and normalizes editor values", () => {
    expect(formatResourceType("future_type")).toBe("future_type");
    expect(formatResourceType("")).toBe("未知");
    expect(isResourceType("canopus")).toBe(true);
    expect(isResourceType("res_pack")).toBe(true);
    expect(isResourceType("future_type")).toBe(false);
    expect(normalizeResourceType("canopus")).toBe("canopus");
    expect(normalizeResourceType("res_pack")).toBe("res_pack");
    expect(normalizeResourceType("future_type")).toBe("quick_app");
    expect(getRepoTopicsForResourceType("res_pack")).toEqual([
      "astrobox-resource",
      "res-pack",
    ]);
  });

  test("resource pack and canopus only accept Xiaomi devices", () => {
    expect(isXiaomiOnlyResourceType("res_pack")).toBe(true);
    expect(isXiaomiOnlyResourceType("canopus")).toBe(true);
    expect(isXiaomiOnlyResourceType("quick_app")).toBe(false);
    expect(isXiaomiOnlyResourceType("watchface")).toBe(false);

    expect(isDeviceVendorSupportedByResourceType("res_pack", "xiaomi")).toBe(true);
    expect(isDeviceVendorSupportedByResourceType("res_pack", "Xiaomi")).toBe(true);
    expect(isDeviceVendorSupportedByResourceType("canopus", "vivo")).toBe(false);
    expect(isDeviceVendorSupportedByResourceType("quick_app", "vivo")).toBe(true);

    const devices = [
      { id: "xmb10", vendor: "xiaomi" },
      { id: "vivowgt2", vendor: "vivo" },
      { id: "unknown" },
    ];
    expect(
      filterDeviceOptionsByResourceType(devices, "res_pack").map(
        (device) => device.id,
      ),
    ).toEqual(["xmb10"]);
    expect(
      filterDeviceOptionsByResourceType(devices, "canopus").map(
        (device) => device.id,
      ),
    ).toEqual(["xmb10"]);
    expect(filterDeviceOptionsByResourceType(devices, "quick_app")).toHaveLength(
      3,
    );
  });
});
