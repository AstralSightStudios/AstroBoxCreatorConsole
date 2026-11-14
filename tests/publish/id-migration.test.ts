import { describe, expect, test } from "bun:test";
import type { IdMigrationRecord } from "../../app/api/astrobox/resource";
import {
  describeIdMigrationIntentError,
  describeIdMigrationRecord,
  summarizeIdMigrations,
} from "../../app/logic/publish/id-migration";

const record = (over: Partial<IdMigrationRecord>): IdMigrationRecord => ({
  fromId: "com.old.app",
  toId: "com.new.app",
  status: "pending",
  reason: null,
  registeredAt: "2026-11-10T08:00:00.000Z",
  appliedAt: null,
  expiresAt: null,
  ...over,
});

describe("换 ID 登记失败的原因", () => {
  test("服务端错误码译成中文并保留原码", () => {
    expect(describeIdMigrationIntentError("target_listed")).toBe(
      "新 ID 已被目录里的其他资源占用（不区分大小写）（target_listed）",
    );
    expect(describeIdMigrationIntentError(" forbidden ")).toContain("不是这个资源的主作者");
    expect(describeIdMigrationIntentError("target_used")).toContain("曾经被使用过");
  });

  test("不认识的错误原样返回", () => {
    expect(describeIdMigrationIntentError("请求失败（HTTP 502）")).toBe("请求失败（HTTP 502）");
  });
});

describe("换 ID 记录的说明", () => {
  test("登记中：说明合入后生效以及有效期", () => {
    const note = describeIdMigrationRecord(record({ expiresAt: "2027-02-08T08:00:00.000Z" }));
    expect(note.tone).toBe("pending");
    expect(note.text).toContain("「com.old.app」→「com.new.app」");
    expect(note.text).toContain("PR 合入后自动迁移");
    expect(note.text).toContain("2027-02-08");
  });

  test("已完成", () => {
    const note = describeIdMigrationRecord(
      record({ status: "applied", appliedAt: "2026-11-12T10:00:00.000Z" }),
    );
    expect(note.tone).toBe("applied");
    expect(note.text).toContain("2026-11-12");
    expect(note.text).toContain("迁移完成");
  });

  test("被拒绝：给出可读的原因", () => {
    const note = describeIdMigrationRecord(record({ status: "rejected", reason: "author_mismatch" }));
    expect(note.tone).toBe("rejected");
    expect(note.text).toContain("第一作者与登记时不一致");
    expect(describeIdMigrationRecord(record({ status: "rejected", reason: "source_still_listed" })).text).toContain(
      "同时在架",
    );
    // 以后服务端加了新原因也不至于显示成空白
    expect(describeIdMigrationRecord(record({ status: "rejected", reason: "new_reason" })).text).toContain("new_reason");
    expect(describeIdMigrationRecord(record({ status: "rejected" })).text).toContain("原因未知");
  });

  test("表单只展示未生效的、被拒的和最近一次完成的", () => {
    const notes = summarizeIdMigrations([
      record({ toId: "com.c.app", fromId: "com.b.app" }),
      record({ status: "applied", fromId: "com.a.app", toId: "com.b.app", appliedAt: "2026-11-01T00:00:00Z" }),
      record({ status: "rejected", reason: "target_exists", fromId: "com.a.app", toId: "com.x.app" }),
      record({ status: "applied", fromId: "com.0.app", toId: "com.a.app", appliedAt: "2026-10-01T00:00:00Z" }),
    ]);
    expect(notes.map((note) => note.tone)).toEqual(["pending", "applied", "rejected"]);
    expect(notes[1].text).toContain("「com.a.app」→「com.b.app」");
    expect(summarizeIdMigrations([])).toEqual([]);
  });
});
