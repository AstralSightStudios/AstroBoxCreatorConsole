import { describe, expect, test } from "bun:test";
import {
    canEditResourceIdentity,
    listedResourceIdOf,
    resolveIdMigration,
    resolveIdentityLocks,
} from "../../app/logic/publish/resources";
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

function catalogContext(id: string): ResourceEditContext {
    return { ...buildContext(id), mode: "catalog" } as ResourceEditContext;
}

function inProgressContext(rowId: string, request: { mode: "create" | "edit"; original_id: string | null }): ResourceEditContext {
    return {
        ...buildContext(rowId),
        mode: "in_progress",
        submission: {
            path: "tmp/someone/repo",
            request: {
                schema_version: 1,
                mode: request.mode,
                original_id: request.original_id,
                base_entry_digest: null,
                base_catalog_commit: null,
                client: null,
            },
        },
    } as ResourceEditContext;
}

describe("listedResourceIdOf", () => {
    test("目录模式取目录行的 ID", () => {
        expect(listedResourceIdOf(catalogContext("979805910591"))).toBe("979805910591");
    });

    test("继续编辑「更新」PR 时取 original_id，而不是 PR 里已经改掉的目录行", () => {
        expect(
            listedResourceIdOf(inProgressContext("my_module", { mode: "edit", original_id: "979805910591" })),
        ).toBe("979805910591");
    });

    test("全新发布和首次提交的 PR 不算已上架", () => {
        expect(listedResourceIdOf(null)).toBeNull();
        expect(
            listedResourceIdOf(inProgressContext("new-one", { mode: "create", original_id: null })),
        ).toBeNull();
    });
});

describe("resolveIdMigration", () => {
    test("已上架资源换了 ID 才需要迁移", () => {
        expect(
            resolveIdMigration({ editContext: catalogContext("979805910591"), itemId: " my_module " }),
        ).toEqual({ fromId: "979805910591", toId: "my_module" });
        expect(
            resolveIdMigration({ editContext: catalogContext("979805910591"), itemId: "979805910591" }),
        ).toBeNull();
        expect(resolveIdMigration({ editContext: catalogContext("979805910591"), itemId: "  " })).toBeNull();
        expect(resolveIdMigration({ editContext: null, itemId: "my_module" })).toBeNull();
    });
});

describe("resolveIdentityLocks", () => {
    const listed = { isEditing: true, canEditIdentity: false, listedType: "watchface" };

    test("未合入目录时类型和 ID 都能改", () => {
        expect(
            resolveIdentityLocks({ ...listed, canEditIdentity: true, resourceType: "watchface" }),
        ).toEqual({ typeLocked: false, idLocked: false });
        expect(
            resolveIdentityLocks({ ...listed, isEditing: false, resourceType: "watchface" }),
        ).toEqual({ typeLocked: false, idLocked: false });
    });

    test("已上架资源：类型能改，ID 只有改了类型才放开", () => {
        expect(resolveIdentityLocks({ ...listed, resourceType: "watchface" })).toEqual({
            typeLocked: false,
            idLocked: true,
        });
        expect(resolveIdentityLocks({ ...listed, resourceType: "canopus" })).toEqual({
            typeLocked: false,
            idLocked: false,
        });
    });

    test("目录行没有类型时保守锁定 ID", () => {
        expect(resolveIdentityLocks({ ...listed, listedType: "", resourceType: "canopus" }).idLocked).toBe(true);
    });

    test("已上架资源：创作者确认「修改资源 ID」后，不改类型也能改 ID", () => {
        expect(
            resolveIdentityLocks({ ...listed, resourceType: "watchface", idChangeRequested: true }),
        ).toEqual({ typeLocked: false, idLocked: false });
        // 没确认就一直锁着
        expect(
            resolveIdentityLocks({ ...listed, resourceType: "watchface", idChangeRequested: false }).idLocked,
        ).toBe(true);
    });

    test("目录行读不出类型时，即使点了「修改资源 ID」也不放开", () => {
        expect(
            resolveIdentityLocks({ ...listed, listedType: null, resourceType: "watchface", idChangeRequested: true })
                .idLocked,
        ).toBe(true);
    });
});
