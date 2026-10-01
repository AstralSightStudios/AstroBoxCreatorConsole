import { beforeEach, describe, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();

(globalThis as any).window = globalThis;
(globalThis as any).localStorage = {
  getItem(key: string) {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    storage.set(key, value);
  },
  removeItem(key: string) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  },
};

const inboxList = mock(async (_query: unknown) => ({ items: [] as unknown[] }));

mock.module("../../app/api/astrobox/admin", () => ({
  AdminApi: {
    inbox: {
      list: inboxList,
      send: mock(async () => ({ bulkId: "bulk-new", count: 1 })),
      bulkDelete: mock(async () => ({ deleted: 0 })),
    },
  },
}));

mock.module("sonner", () => ({ toast: { error: mock(() => {}) } }));

const {
  buildCcNoticeCheckTarget,
  inspectCcNotices,
} = await import("../../app/logic/inbox/send");

const PR = 1029;

function makeTarget(
  subtype: "review-changes-requested" | "review-approved" = "review-changes-requested",
  tagId?: string,
  content?: string,
) {
  return buildCcNoticeCheckTarget({ prNumber: PR, subtype, tagId, content });
}

function serverMessage(
  metadata: Record<string, unknown>,
  bulkId = "bulk-1",
) {
  return { bulkId, title: "t", body: "b", metadata };
}

function resetStorage() {
  for (const key of [
    "CC_NOTICE_SENT_KEYS_V1",
    "CC_NOTICE_PENDING_QUEUE_V1",
    "CC_NOTICE_BULK_RECORDS_V1",
  ]) {
    localStorage.removeItem(key);
  }
}

describe("审核通知送达状态检测", () => {
  beforeEach(() => {
    resetStorage();
    inboxList.mockReset();
    inboxList.mockImplementation(async () => ({ items: [] }));
  });

  /**
   * 回归：本地发送记录是「这台设备确实发过」的直接证据，必须无条件参与判定。
   * 之前只有服务端查询失败时才读本地记录，导致服务端查到 200 但没匹配上时
   * 把已送达的通知判成「没有发送」。
   */
  test("服务端没查到时，本地发送记录仍判定为已送达", async () => {
    const target = makeTarget("review-changes-requested", "tag001", "改封面");
    localStorage.setItem(
      "CC_NOTICE_BULK_RECORDS_V1",
      JSON.stringify({
        [`${PR}:review-changes-requested:tag001`]: {
          bulkId: "bulk-local",
          payload: {
            subtype: "review-changes-requested",
            tagId: "tag001",
            content: "改封面",
            prNumber: PR,
            prUrl: "",
            userIds: ["u1"],
            title: "t",
            body: "b",
          },
        },
      }),
    );

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });

    expect(statuses.get(target.key)).toEqual({
      state: "sent",
      bulkId: "bulk-local",
    });
  });

  test("无任何记录且服务端也没有时判定为未送达", async () => {
    const target = makeTarget("review-changes-requested", "tag002", "正文");
    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("unsent");
  });

  /** 正文被编辑过时，旧通知正文与新评论不一致；服务端若没存正文应降级只比 tagId。 */
  test("服务端正文缺失时降级为只比 tagId", async () => {
    const target = makeTarget("review-changes-requested", "tag003", "改后的正文");
    inboxList.mockImplementation(async () => ({
      items: [
        serverMessage({
          subtype: "review-changes-requested",
          tagId: "tag003",
          content: null,
          prNumber: PR,
        }),
      ],
    }));

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("sent");
  });

  test("服务端正文存在且不一致时不判定为已送达", async () => {
    const target = makeTarget("review-changes-requested", "tag004", "新正文");
    inboxList.mockImplementation(async () => ({
      items: [
        serverMessage({
          subtype: "review-changes-requested",
          tagId: "tag004",
          content: "旧正文",
          prNumber: PR,
        }),
      ],
    }));

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("unsent");
  });

  /**
   * 回归：撤回/重发依赖本机 bulkId 记录，而「已送达」判定来自服务端，
   * 两者必须落到同一份数据，否则会出现「显示已送达但无法撤回」。
   */
  test("服务端命中后把 bulkId 回填到本地记录", async () => {
    const target = makeTarget("review-changes-requested", "tag005", "正文");
    inboxList.mockImplementation(async () => ({
      items: [
        serverMessage(
          {
            subtype: "review-changes-requested",
            tagId: "tag005",
            content: "正文",
            prNumber: PR,
            prUrl: "https://example.com/pr",
          },
          "bulk-server",
        ),
      ],
    }));

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)).toEqual({
      state: "sent",
      bulkId: "bulk-server",
    });

    const records = JSON.parse(
      localStorage.getItem("CC_NOTICE_BULK_RECORDS_V1") || "{}",
    );
    expect(records[target.key].bulkId).toBe("bulk-server");
    const sentKeys = JSON.parse(
      localStorage.getItem("CC_NOTICE_SENT_KEYS_V1") || "[]",
    );
    expect(sentKeys).toContain(target.key);
  });

  test("收件人解析不出来时标记为未匹配作者，与未送达区分开", async () => {
    const target = makeTarget("review-approved");
    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: [],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("unmatched");
    expect(inboxList).not.toHaveBeenCalled();
  });

  test("本地待补发队列中的条目标记为待发送", async () => {
    const target = makeTarget("review-changes-requested", "tag006", "正文");
    localStorage.setItem(
      "CC_NOTICE_PENDING_QUEUE_V1",
      JSON.stringify([
        {
          subtype: "review-changes-requested",
          tagId: "tag006",
          content: "正文",
          prNumber: PR,
          prUrl: "",
          userIds: ["u1"],
          title: "t",
          body: "b",
        },
      ]),
    );

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("pending");
  });

  test("服务端不可用时标记为未能校验，不断言为没有发送", async () => {
    const target = makeTarget("review-changes-requested", "tag007", "正文");
    inboxList.mockImplementation(async () => {
      throw new Error("权限不足");
    });

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("unverified");
  });

  /** pr-reviewer 账号查 /admin/inbox 会 403，本机有记录时仍要显示已送达。 */
  test("服务端 403 时保留本机的已送达判定", async () => {
    const target = makeTarget("review-changes-requested", "tag008", "正文");
    localStorage.setItem(
      "CC_NOTICE_BULK_RECORDS_V1",
      JSON.stringify({
        [`${PR}:review-changes-requested:tag008`]: {
          bulkId: "bulk-local",
          payload: {
            subtype: "review-changes-requested",
            tagId: "tag008",
            content: "正文",
            prNumber: PR,
            prUrl: "",
            userIds: ["u1"],
            title: "t",
            body: "b",
          },
        },
      }),
    );
    inboxList.mockImplementation(async () => {
      throw new Error("forbidden");
    });

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("sent");
  });

  /**
   * 回归：服务端 adminList 不过滤 deletedByUserAt（用户侧 listForUser 会过滤），
   * 创作者自己删掉的通知不能算送达，否则审核端会一直显示「已送达」。
   */
  test("创作者已删除的通知不算送达", async () => {
    const target = makeTarget("review-changes-requested", "tag009", "正文");
    inboxList.mockImplementation(async () => ({
      items: [
        {
          ...serverMessage({
            subtype: "review-changes-requested",
            tagId: "tag009",
            content: "正文",
            prNumber: PR,
          }),
          deletedByUserAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    }));

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("unsent");
  });

  /** 收件人历史通知多时必须翻页，否则 limit=100 之后的旧通知查不到。 */
  test("历史通知超过一页时靠翻页找到目标", async () => {
    const target = makeTarget("review-changes-requested", "tag010", "正文");
    let page = 0;
    inboxList.mockImplementation(async (query: { cursor?: string }) => {
      page += 1;
      if (page === 1) {
        expect(query.cursor).toBeUndefined();
        return {
          items: [
            serverMessage({
              subtype: "review-changes-requested",
              tagId: "old",
              content: "别的",
              prNumber: PR,
            }),
          ],
          hasMore: true,
          nextCursor: "2026-01-01T00:00:00.000Z",
        };
      }
      expect(query.cursor).toBe("2026-01-01T00:00:00.000Z");
      return {
        items: [
          serverMessage({
            subtype: "review-changes-requested",
            tagId: "tag010",
            content: "正文",
            prNumber: PR,
          }),
        ],
        hasMore: false,
        nextCursor: null,
      };
    });

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("sent");
    expect(page).toBe(2);
  });

  test("无 tagId 的 PR 级通知按 subtype+prNumber 唯一匹配", async () => {
    const target = buildCcNoticeCheckTarget({
      prNumber: PR,
      subtype: "review-approved",
    });
    expect(target.key).toBe(`${PR}:review-approved:`);
    inboxList.mockImplementation(async () => ({
      items: [
        serverMessage({
          subtype: "review-approved",
          tagId: null,
          content: null,
          prNumber: PR,
        }),
      ],
    }));

    const statuses = await inspectCcNotices({
      prNumber: PR,
      userIds: ["u1"],
      targets: [target],
    });
    expect(statuses.get(target.key)?.state).toBe("sent");
  });
});