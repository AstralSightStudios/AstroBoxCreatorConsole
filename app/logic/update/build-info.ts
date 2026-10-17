/**
 * 当前运行的应用是哪一个构建。
 *
 * CI 构建由 `vite.config.ts` 在打包时把 run number / attempt / commit 注入为
 * 全局常量 `__ABCC_BUILD_INFO__`；本地构建则回退到 Vite 配置读取到的 git 状态。
 * 这些信息用于判断 GitHub Actions 上的最新 Beta 产物是否比当前安装的构建更新，
 * 避免出现「每次启动都提示发现新 Beta」的问题。
 */
export interface InstalledBuildInfo {
    /** GitHub Actions 的 run number；非 CI 构建为 0。 */
    ciRunNumber: number;
    /** GitHub Actions 的 run attempt；非 CI 构建为 0。 */
    ciRunAttempt: number;
    /** 构建时的完整 commit SHA；未知时为空字符串。 */
    commitSha: string;
    /** 构建时工作区是否包含未提交改动。 */
    sourceDirty: boolean;
}

interface InjectedBuildInfo {
    ciRunNumber?: unknown;
    ciRunAttempt?: unknown;
    commitSha?: unknown;
    sourceDirty?: unknown;
}

declare const __ABCC_BUILD_INFO__: InjectedBuildInfo | undefined;

function readPositiveInteger(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function readCommitSha(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** 读取构建期注入的元数据；未注入时返回全空值（视为无法比较的本地构建）。 */
export function getInstalledBuildInfo(): InstalledBuildInfo {
    const injected =
        typeof __ABCC_BUILD_INFO__ === "undefined"
            ? null
            : __ABCC_BUILD_INFO__;
    if (!injected) {
        return {
            ciRunNumber: 0,
            ciRunAttempt: 0,
            commitSha: "",
            sourceDirty: false,
        };
    }

    return {
        ciRunNumber: readPositiveInteger(injected.ciRunNumber),
        ciRunAttempt: readPositiveInteger(injected.ciRunAttempt),
        commitSha: readCommitSha(injected.commitSha),
        sourceDirty: injected.sourceDirty === true,
    };
}
