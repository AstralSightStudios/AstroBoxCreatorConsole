import { useCallback, useEffect, useMemo, useState } from "react";
import type { GithubPullFile, GithubPullRequest } from "~/api/github/pr-review";
import { getFileContent } from "~/logic/publish/catalog";
import { extractPluginIndexPatch, parsePluginIndexText } from "~/logic/publish/plugin-index";
import {
  loadPluginIndexEntries,
  type PluginIndexEntryGroup,
} from "~/logic/publish/plugin-review";
import {
  fetchNgPluginIndex,
  type NgPluginIndexEntry,
} from "~/logic/publish/plugin-repo";
import { reviewRepoRef } from "../../source";

function decodeBase64Text(content?: string): string {
  if (!content) return "";
  return new TextDecoder().decode(
    Uint8Array.from(atob(content.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
}

export interface PluginPullPreviewState {
  groups: PluginIndexEntryGroup[];
  loading: boolean;
  reloading: boolean;
  error?: string;
  publishedError?: string;
  reload: () => void;
}

/**
 * 读取插件 PR 的 index.txt diff，并加载作者仓库 index.txt / manifest。
 * 页面级只负责 files，具体插件信息与检查结果都在这里按需解析。
 */
export function usePluginPullPreview(params: {
  openPull: GithubPullRequest | null;
  files: GithubPullFile[];
  token: string;
}): PluginPullPreviewState {
  const { openPull, files, token } = params;
  const [groups, setGroups] = useState<PluginIndexEntryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [publishedError, setPublishedError] = useState<string | undefined>();
  const [reloadTick, setReloadTick] = useState(0);

  const addedLines = useMemo(() => {
    const indexFile = files.find((file) => file.filename === "index.txt");
    return extractPluginIndexPatch(indexFile?.patch).addedLines;
  }, [files]);
  const addedLinesKey = useMemo(() => addedLines.join("\n"), [addedLines]);

  const reload = useCallback(() => {
    setReloadTick((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!openPull) {
      setGroups([]);
      setError(undefined);
      setLoading(false);
      return;
    }
    if (!token) {
      setGroups([]);
      setError("未登录 GitHub，无法读取插件仓库。");
      setLoading(false);
      return;
    }
    if (files.length === 0) {
      return;
    }
    if (addedLines.length === 0) {
      setGroups([]);
      setError("当前 PR 没有在 index.txt 中新增任何行。");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const pluginRepo = reviewRepoRef("plugin");
    setLoading(true);
    setReloading(reloadTick > 0);
    setError(undefined);
    setPublishedError(undefined);

    void (async () => {
      try {
        const indexData = await getFileContent(
          token,
          pluginRepo.owner,
          pluginRepo.name,
          "index.txt",
          pluginRepo.defaultBranch,
        );
        const existingLines = parsePluginIndexText(
          decodeBase64Text(indexData?.content),
        );
        let publishedPlugins: NgPluginIndexEntry[] = [];
        let publishedFailure: string | undefined;
        try {
          publishedPlugins = await fetchNgPluginIndex();
        } catch (err) {
          publishedFailure = err instanceof Error ? err.message : String(err);
        }
        const result = await loadPluginIndexEntries({
          addedLines,
          token,
          existingLines,
          publishedPlugins,
        });
        if (cancelled) return;
        setGroups(result.groups);
        setPublishedError(publishedFailure);
      } catch (err) {
        if (cancelled) return;
        setGroups([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setReloading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openPull, files.length, token, addedLinesKey, reloadTick]);

  return {
    groups,
    loading,
    reloading,
    error,
    publishedError,
    reload,
  };
}
