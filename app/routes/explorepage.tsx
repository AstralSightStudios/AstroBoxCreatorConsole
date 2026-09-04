import { Button, Dialog } from "~/components/ScaleAwareThemes";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildExploreBranchName,
  fetchExploreJson,
  submitExplorePr,
} from "~/api/github/explore-pr";
import { getBlogsRawBase } from "~/api/github/blogs-tree";
import BlogsManagerDialog, {
  type BlogsManagerState,
} from "~/components/blogs/BlogsManagerDialog";
import JsonMonacoEditor from "~/components/admin/JsonMonacoEditor";
import ExploreExtendedFeedPreview, {
  type FeaturedAuthorConfig,
} from "~/components/explore-preview/ExploreExtendedFeedPreview";
import ExploreMasonry from "~/components/explore-preview/copied/ExploreMasonry";
import type { MasonryCard } from "~/components/explore-preview/copied/explore-types";
import { useAccountState } from "~/logic/account/store";
import { useProxiedPayload } from "~/logic/media-proxy-walk";
import { useRepoEnv } from "~/config/repoEnv";

const DRAFT_KEY = "ABCC_EXPLORE_PAGE_DRAFT_V1";

interface ExplorePayload {
  masonryCards?: MasonryCard[];
  featuredResourceIds?: string[];
  featuredAuthors?: FeaturedAuthorConfig[];
}

const EMPTY_MANAGER_STATE: BlogsManagerState = {
  uploads: [],
  deletes: [],
  newFolders: [],
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function prettyJson(input: string) {
  return JSON.stringify(JSON.parse(input), null, 2);
}

function parsePayload(jsonText: string): ExplorePayload | null {
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export default function ExplorePageManager() {
  const accountState = useAccountState();
  const env = useRepoEnv();
  const [jsonText, setJsonText] = useState("");
  const [branch, setBranch] = useState("");
  const [managerState, setManagerState] = useState<BlogsManagerState>(EMPTY_MANAGER_STATE);
  const [previewWidth, setPreviewWidth] = useState(1280);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const blogsBase = useMemo(() => getBlogsRawBase(), [env.owner, env.repoName, env.defaultBranch]);

  const payload = useMemo(() => parsePayload(jsonText), [jsonText]);
  const jsonValid = Boolean(payload);

  const pendingChanges =
    managerState.uploads.length +
    managerState.deletes.length +
    managerState.newFolders.length;

  const loadRemote = async () => {
    setLoading(true);
    try {
      const text = await fetchExploreJson();
      const formatted = prettyJson(text);
      setJsonText(formatted);
      localStorage.setItem(DRAFT_KEY, formatted);
      toast.success(`已加载 ${env.repoName} 的 explore_v2.json`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      setJsonText(draft);
    } else {
      void loadRemote();
    }
    try {
      setBranch(buildExploreBranchName());
    } catch {
      setBranch(`explore/${Date.now()}-local`);
    }
  }, []);

  useEffect(() => {
    if (jsonText) localStorage.setItem(DRAFT_KEY, jsonText);
  }, [jsonText]);

  const formatCurrentJson = () => {
    try {
      setJsonText(prettyJson(jsonText));
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const resetDraft = async () => {
    localStorage.removeItem(DRAFT_KEY);
    await loadRemote();
  };

  const submit = async () => {
    if (!accountState.github?.token) {
      toast.error("请先登录 GitHub 账号");
      return;
    }
    if (!jsonValid) {
      toast.error("JSON 格式不正确");
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitExplorePr({
        jsonText: prettyJson(jsonText),
        mediaUploads: managerState.uploads,
        deletes: managerState.deletes,
        newFolders: managerState.newFolders,
        branch,
      });
      toast.success("探索页 PR 已创建");
      setManagerState(EMPTY_MANAGER_STATE);
      openUrl(result.htmlUrl);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden px-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
        <span>
          目标仓库{" "}
          <span className="font-mono-sarasa text-white/80">
            {env.owner}/{env.repoName}
          </span>
          @<span className="font-mono-sarasa">{env.exploreFilePath}</span>
        </span>
        <span className="text-white/30">·</span>
        <span>
          素材路径相对于{" "}
          <span className="font-mono-sarasa text-white/75">blogs/</span>
          ，预览时自动补全前缀并经 Tauri 后端代理避免 CORS
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-xs text-white/60">
          <span>PR 分支</span>
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className="min-h-9 rounded-lg border border-white/10 bg-black/25 px-2.5 font-mono-sarasa text-sm text-white outline-none focus:border-white/30"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="2" variant="soft" onClick={loadRemote} disabled={loading}>
            从 main 载入
          </Button>
          <Button size="2" variant="soft" onClick={resetDraft}>重置草稿</Button>
          <Button size="2" variant="soft" onClick={formatCurrentJson}>格式化</Button>
          <Button size="2" variant="soft" onClick={() => setManagerOpen(true)}>
            素材管理
            {pendingChanges > 0 && (
              <span className="ml-1 rounded-full bg-emerald-500/25 px-1.5 text-[10px] text-emerald-100">
                {pendingChanges}
              </span>
            )}
          </Button>
          <Button size="2" variant="soft" onClick={() => setPreviewOpen(true)} disabled={!jsonValid}>
            预览
          </Button>
          <Button size="2" onClick={submit} disabled={submitting || !jsonValid}>
            {submitting ? "提交中" : "提交 PR"}
          </Button>
        </div>
      </div>

      <div
        className={`min-h-0 flex-1 overflow-hidden rounded-xl border bg-black/35 ${
          jsonValid ? "border-white/10" : "border-red-400/40"
        }`}
      >
        <JsonMonacoEditor
          value={jsonText}
          onChange={setJsonText}
          height="100%"
          theme="vs-dark"
        />
      </div>
      {!jsonValid && (
        <p className="text-xs text-red-200">JSON 解析失败，预览和提交都不会生效。</p>
      )}

      <BlogsManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        state={managerState}
        onChange={setManagerState}
      />

      <Dialog.Root open={previewOpen} onOpenChange={setPreviewOpen}>
        <Dialog.Content
          maxWidth="var(--ui-viewport-width)"
          className="!w-[min(calc(var(--ui-viewport-width)-2rem),1600px)] !max-w-none !p-3"
        >
          <Dialog.Title>探索页预览</Dialog.Title>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="flex gap-2">
              {[1440, 1280, 1024, 768].map((width) => (
                <Button
                  key={width}
                  size="1"
                  variant={previewWidth === width ? "solid" : "soft"}
                  onClick={() => setPreviewWidth(width)}
                >
                  {width}
                </Button>
              ))}
            </div>
            <Dialog.Close>
              <Button size="1" variant="soft">关闭</Button>
            </Dialog.Close>
          </div>
          <div className="max-h-[var(--ui-viewport-height-80pct)] min-h-[420px] overflow-auto rounded-xl bg-[#101012] p-3">
            {payload ? (
              <ExplorePreviewContent
                payload={payload}
                width={previewWidth}
                baseUrl={blogsBase}
                pendingFiles={managerState.uploads}
              />
            ) : (
              <div className="grid min-h-[300px] place-items-center text-sm text-red-100">
                JSON 无法解析
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}

function ExplorePreviewContent({
  payload,
  width,
  baseUrl,
  pendingFiles,
}: {
  payload: ExplorePayload;
  width: number;
  baseUrl: string;
  pendingFiles: BlogsManagerState["uploads"];
}) {
  const pendingMap = useMemo(() => {
    const map = new Map<string, File>();
    for (const item of pendingFiles) {
      map.set(item.path, item.file);
    }
    return map;
  }, [pendingFiles]);

  const proxied = useProxiedPayload(payload, { baseUrl, pendingFiles: pendingMap });

  return (
    <div
      className="dark mx-auto min-h-full overflow-hidden rounded-2xl bg-[#191919] text-white"
      style={{ width, maxWidth: "100%" }}
    >
      <ExploreMasonry
        content={Array.isArray(proxied.masonryCards) ? proxied.masonryCards : []}
        appearance="dark"
      />
      <ExploreExtendedFeedPreview
        featuredResourceIds={
          Array.isArray(proxied.featuredResourceIds)
            ? proxied.featuredResourceIds
            : []
        }
        featuredAuthors={
          Array.isArray(proxied.featuredAuthors) ? proxied.featuredAuthors : []
        }
      />
    </div>
  );
}
