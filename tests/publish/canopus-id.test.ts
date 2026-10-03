import { describe, expect, test } from "bun:test";
import { validateCanopusIdFormat } from "../../app/logic/publish/canopus-id";

describe("canopus id", () => {
  test("validate accepts bare module names", () => {
    expect(validateCanopusIdFormat("bluetoothaudio")).toBeNull();
    expect(validateCanopusIdFormat("lyra-player_2")).toBeNull();
    expect(validateCanopusIdFormat("canopus_bluetoothaudio")).toBeNull();
  });

  test("validate rejects empty and bad charset", () => {
    expect(validateCanopusIdFormat("")).toContain("请填写模块名称");
    expect(validateCanopusIdFormat("   ")).toContain("请填写模块名称");
    expect(validateCanopusIdFormat("a.b")).toContain("仅支持");
    expect(validateCanopusIdFormat("模块")).toContain("仅支持");
    expect(validateCanopusIdFormat("_leading")).toContain("仅支持");
  });
});