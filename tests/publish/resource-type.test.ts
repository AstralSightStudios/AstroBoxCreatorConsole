import { describe, expect, test } from "bun:test";
import {
  formatResourceType,
  getRepoTopicsForResourceType,
  isResourceType,
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
});
