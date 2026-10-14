import { describe, expect, test } from "bun:test";
import { validateCanopusIdFormat } from "../../app/logic/publish/canopus-id";

describe("canopus id", () => {
  test("validate accepts bare module names", () => {
    expect(validateCanopusIdFormat("bluetoothaudio")).toBeNull();
    expect(validateCanopusIdFormat("lyra_player_2")).toBeNull();
    expect(validateCanopusIdFormat("bluetooth_audio")).toBeNull();
  });

  test("validate rejects empty and bad charset", () => {
    expect(validateCanopusIdFormat("")).toContain("请填写模块名称");
    expect(validateCanopusIdFormat("   ")).toContain("请填写模块名称");
    expect(validateCanopusIdFormat("a.b")).toContain("仅支持");
    expect(validateCanopusIdFormat("模块")).toContain("仅支持");
    expect(validateCanopusIdFormat("_leading")).toContain("仅支持");
    expect(validateCanopusIdFormat("lyra-player")).toContain("仅支持");
    expect(validateCanopusIdFormat("Bluetooth")).toContain("仅支持");
    expect(validateCanopusIdFormat("a_very_long_module_id")).toContain("仅支持");
  });
});