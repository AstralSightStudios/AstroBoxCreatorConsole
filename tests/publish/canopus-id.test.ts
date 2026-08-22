import { describe, expect, test } from "bun:test";
import {
  CANOPUS_ID_PREFIX,
  normalizeCanopusIdInput,
  validateCanopusIdFormat,
} from "../../app/logic/publish/canopus-id";

describe("canopus id", () => {
  test("prefix constant", () => {
    expect(CANOPUS_ID_PREFIX).toBe("canopus_");
  });

  test("normalize keeps ids already prefixed", () => {
    expect(normalizeCanopusIdInput("canopus_bluetoothaudio")).toBe(
      "canopus_bluetoothaudio",
    );
  });

  test("normalize restores prefix when cleared", () => {
    expect(normalizeCanopusIdInput("")).toBe("canopus_");
    expect(normalizeCanopusIdInput("   ")).toBe("canopus_");
  });

  test("normalize prepends prefix to bare names", () => {
    expect(normalizeCanopusIdInput("lyraplayer")).toBe("canopus_lyraplayer");
    expect(normalizeCanopusIdInput("canopus")).toBe("canopus");
  });

  test("validate accepts real-world module ids", () => {
    expect(validateCanopusIdFormat("canopus_bluetoothaudio")).toBeNull();
    expect(validateCanopusIdFormat("canopus_lyra-player_2")).toBeNull();
  });

  test("validate rejects missing/empty suffix and bad charset", () => {
    expect(validateCanopusIdFormat("bluetoothaudio")).toContain("canopus_ 开头");
    expect(validateCanopusIdFormat("canopus_")).toContain("前缀后填写模块名称");
    expect(validateCanopusIdFormat("canopus_a.b")).toContain("仅支持");
    expect(validateCanopusIdFormat("canopus_模块")).toContain("仅支持");
  });
});
