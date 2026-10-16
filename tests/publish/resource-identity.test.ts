import { describe, expect, test } from "bun:test";
import { canEditResourceIdentity } from "../../app/logic/publish/resources";
import type { ResourceEditContext } from "../../app/logic/publish/resources";

function buildContext(id: string): ResourceEditContext {
    return {
        catalog: {
            entry: { id } as ResourceEditContext["catalog"]["entry"],
            owner: "owner",
            repo: "repo",
            ref: "main",
        },
    } as ResourceEditContext;
}

describe("canEditResourceIdentity", () => {
    test("无编辑上下文（全新发布）可修改资源 ID 与类型", () => {
        expect(
            canEditResourceIdentity({ editContext: null, catalogIds: null }),
        ).toBe(true);
        const ids = new Map([["someone-else", "别人"]]);
        expect(
            canEditResourceIdentity({ editContext: null, catalogIds: ids }),
        ).toBe(true);
    });

    test("目录列表未加载时保守锁定（有编辑上下文即不可改）", () => {
        expect(
            canEditResourceIdentity({
                editContext: buildContext("resource-a"),
                catalogIds: null,
            }),
        ).toBe(false);
        expect(
            canEditResourceIdentity({
                editContext: buildContext("resource-a"),
                catalogIds: undefined,
            }),
        ).toBe(false);
    });

    test("编辑会话原 ID 已进入已合入 index_v2.csv 则锁定（含进行中的更新 PR）", () => {
        const ids = new Map([
            ["Resource-A", "自己的资源"],
            ["someone-else", "别人"],
        ]);
        expect(
            canEditResourceIdentity({
                editContext: buildContext("resource-a"),
                catalogIds: ids,
            }),
        ).toBe(false);
    });

    test("编辑会话原 ID 不在 index_v2.csv（首次提交进行中 PR）可修改，比较大小写不敏感", () => {
        const ids = new Map([["someone-else", "别人"]]);
        expect(
            canEditResourceIdentity({
                editContext: buildContext("resource-a"),
                catalogIds: ids,
            }),
        ).toBe(true);
        // 原 ID 大小写漂移不算命中目录
        const ids2 = new Map([["RESOURCE-A", "自己的资源"]]);
        expect(
            canEditResourceIdentity({
                editContext: buildContext("resource-a"),
                catalogIds: ids2,
            }),
        ).toBe(false);
    });

    test("判定基于编辑会话开始时的原 ID，与后续改成的 ID 无关", () => {
        const ids = new Map([["someone-else", "别人"]]);
        // 目录里只有旧 ID 的资源会进这里，重新抓取后仍按原 ID 判定
        expect(
            canEditResourceIdentity({
                editContext: buildContext("resource-a"),
                catalogIds: ids,
            }),
        ).toBe(true);
        const renamed = new Map([["resource-b", "改成的新 ID 对应资源"]]);
        expect(
            canEditResourceIdentity({
                editContext: buildContext("resource-a"),
                catalogIds: renamed,
            }),
        ).toBe(true);
    });
});
