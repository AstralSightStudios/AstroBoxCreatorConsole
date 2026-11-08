import { describe, expect, test } from "bun:test";
import {
  createOverlayHistoryToken,
  getOverlayHistoryToken,
  OVERLAY_HISTORY_KEY,
  withOverlayHistoryToken,
} from "../../app/logic/ui/overlay-history";

describe("overlay history state", () => {
  test("保留原有路由 state 并写入 token", () => {
    const state = withOverlayHistoryToken(
      { usr: { path: "/resreview" }, key: "abc", idx: 2 },
      "overlay-1",
    );
    expect(state).toEqual({
      usr: { path: "/resreview" },
      key: "abc",
      idx: 2,
      [OVERLAY_HISTORY_KEY]: "overlay-1",
    });
    expect(getOverlayHistoryToken(state)).toBe("overlay-1");
  });

  test("非对象 state 与缺失 token 返回 null", () => {
    expect(getOverlayHistoryToken(null)).toBeNull();
    expect(getOverlayHistoryToken(undefined)).toBeNull();
    expect(getOverlayHistoryToken("x")).toBeNull();
    expect(getOverlayHistoryToken({})).toBeNull();
    expect(getOverlayHistoryToken({ [OVERLAY_HISTORY_KEY]: 1 })).toBeNull();
  });

  test("token 唯一", () => {
    const first = createOverlayHistoryToken();
    const second = createOverlayHistoryToken();
    expect(first).not.toBe(second);
    expect(first.startsWith("overlay-")).toBe(true);
  });
});
