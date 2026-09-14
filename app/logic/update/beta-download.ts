import { invoke } from "@tauri-apps/api/core";
import { loadAccountState } from "~/logic/account/store";
import type { BetaArtifactInfo } from "./update-checker";

/**
 * GitHub Actions 的 artifact 下载接口即使对公开仓库也要求鉴权（未登录返回 401），
 * 因此这里带上当前账号的 GitHub token，经 Rust 侧 `download_file` 直接落盘，
 * 避免把动辄上百 MB 的构建包以 base64 形式穿过 IPC。
 */
export async function downloadBetaArtifact(
    info: BetaArtifactInfo,
    targetPath: string,
): Promise<number> {
    const token = loadAccountState().github?.token?.trim();
    if (!token) {
        throw new Error("未登录 GitHub，无法下载 Actions 构建产物。");
    }

    return invoke<number>("download_file", {
        request: {
            url: info.artifactUrl,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
            targetPath,
        },
    });
}