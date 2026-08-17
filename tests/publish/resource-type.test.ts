import { describe, expect, test } from "bun:test";
import {
  formatResourceType,
  isResourceType,
  normalizeResourceType,
} from "../../app/logic/publish/resource-type";

describe("resource type labels", () => {
  test("formats supported resource types", () => {
    expect(formatResourceType("quick_app")).toBe("快应用");
    expect(formatResourceType("watchface")).toBe("表盘");
    expect(formatResourceType("canopus")).toBe("模块");
  });

  test("preserves unknown labels and normalizes editor values", () => {
    expect(formatResourceType("future_type")).toBe("future_type");
    expect(formatResourceType("")).toBe("未知");
    expect(isResourceType("canopus")).toBe(true);
    expect(isResourceType("future_type")).toBe(false);
    expect(normalizeResourceType("canopus")).toBe("canopus");
    expect(normalizeResourceType("future_type")).toBe("quick_app");
  });
});
