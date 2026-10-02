import { describe, expect, test } from "bun:test";
import {
  RES_PACK_THEME_ID_MAX_LENGTH,
  normalizeResPackIdInput,
  validateResPackIdFormat,
} from "../../app/logic/publish/res-pack-id";

describe("res pack id", () => {
  test("normalize is idempotent", () => {
    const samples = ["  Hello World  ", "ABC__def", "---a--b---", "奶蛙主题", "ok"];
    for (const sample of samples) {
      const once = normalizeResPackIdInput(sample);
      expect(normalizeResPackIdInput(once)).toBe(once);
    }
  });

  test("folds case, whitespace and illegal characters", () => {
    expect(normalizeResPackIdInput("  Hello World  ")).toBe("hello-world");
    expect(normalizeResPackIdInput("ABC__def")).toBe("abc__def");
    expect(normalizeResPackIdInput("---a--b---")).toBe("a-b");
    expect(normalizeResPackIdInput("奶蛙")).toBe("");
    expect(normalizeResPackIdInput("１２３")).toBe("");
    expect(normalizeResPackIdInput("theme😀pack")).toBe("theme-pack");
  });

  test("validate accepts charset within 64", () => {
    expect(validateResPackIdFormat("dawn")).toBeNull();
    expect(validateResPackIdFormat("a".repeat(RES_PACK_THEME_ID_MAX_LENGTH))).toBeNull();
    expect(validateResPackIdFormat("recircle_01-b")).toBeNull();
  });

  test("validate rejects empty, uppercase, punctuation and overlong ids", () => {
    expect(validateResPackIdFormat("")).toContain("不能为空");
    expect(validateResPackIdFormat("Dawn")).toContain("仅支持");
    expect(validateResPackIdFormat("a.b")).toContain("仅支持");
    expect(validateResPackIdFormat("主题")).toContain("仅支持");
    expect(
      validateResPackIdFormat("a".repeat(RES_PACK_THEME_ID_MAX_LENGTH + 1)),
    ).toContain("最长");
  });
});
