import { describe, expect, test } from "bun:test";
import {
  dedupeLogsWithinGroup,
  foldUpdateLogsAcrossGroups,
  updateLogSignature,
} from "../../app/routes/resreview/utils/update-log-fold";

const log = (version: string, content: string) => ({ version, content });

describe("updateLogSignature", () => {
  test("版本与内容共同决定签名", () => {
    expect(updateLogSignature(log("1.0", "a"))).not.toBe(
      updateLogSignature(log("1.1", "a")),
    );
    expect(updateLogSignature(log("1.0", "a"))).not.toBe(
      updateLogSignature(log("1.0", "b")),
    );
    expect(updateLogSignature(log("1.0", "a"))).toBe(
      updateLogSignature(log("1.0", "a")),
    );
  });

  test("忽略首尾空白差异", () => {
    expect(updateLogSignature(log(" 1.0 ", " a\n"))).toBe(
      updateLogSignature(log("1.0", "a")),
    );
  });
});

describe("dedupeLogsWithinGroup", () => {
  test("同一分组内重复日志只保留第一次", () => {
    const result = dedupeLogsWithinGroup([
      log("1.0", "a"),
      log("1.1", "b"),
      log("1.0", "a"),
    ]);
    expect(result.map((l) => l.version)).toEqual(["1.0", "1.1"]);
  });

  test("空输入返回空数组", () => {
    expect(dedupeLogsWithinGroup(undefined)).toEqual([]);
    expect(dedupeLogsWithinGroup([])).toEqual([]);
  });
});

describe("foldUpdateLogsAcrossGroups", () => {
  test("首个分组内的重复项也标记为 duplicate", () => {
    const seen = new Set<string>();
    const folded = foldUpdateLogsAcrossGroups(
      [log("1.0", "a"), log("1.0", "a")],
      seen,
    );
    expect(folded.map((f) => f.duplicate)).toEqual([false, true]);
    expect(folded[1].firstIndex).toBe(0);
  });

  test("跨分组：第二次出现的相同日志标记为重复", () => {
    const seen = new Set<string>();
    const first = foldUpdateLogsAcrossGroups([log("1.0", "很长的日志内容")], seen);
    expect(first[0].duplicate).toBe(false);

    // 模拟另一个包体分组（一键填充写入的同一份配置）
    const second = foldUpdateLogsAcrossGroups([log("1.0", "很长的日志内容")], seen);
    expect(second[0].duplicate).toBe(true);
    expect(second[0].firstIndex).toBe(0);
  });

  test("seen 在调用后累积，供后续分组复用", () => {
    const seen = new Set<string>();
    foldUpdateLogsAcrossGroups([log("1.0", "a")], seen);
    expect(seen.has(updateLogSignature(log("1.0", "a")))).toBe(true);
  });

  test("内容不同的日志不受影响", () => {
    const seen = new Set<string>();
    foldUpdateLogsAcrossGroups([log("1.0", "a")], seen);
    const second = foldUpdateLogsAcrossGroups([log("1.0", "b")], seen);
    expect(second[0].duplicate).toBe(false);
  });
});