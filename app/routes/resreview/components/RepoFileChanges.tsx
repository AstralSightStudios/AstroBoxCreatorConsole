import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GithubPullFile } from "~/api/github/pr-review";
import { compareCommits, listRepoFilesAtCommit } from "~/api/github/pr-review";
import { getRepoFile } from "~/logic/publish/github-actions";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import { getManifestReferencedFiles, decodeBase64, isImagePath } from "../utils";
import { FileEntry, DiffBlock } from "./FileEntry";
import { ProxiedImage } from "./ProxiedMedia";

interface RepoFileChangesProps {
  owner: string;
  repo: string;
  commitHash: string;
  baseCommitHash?: string;
  manifest?: ManifestV2;
  isNew: boolean;
  onFileComment?: (path: string) => void;
}

interface RepoFileItem {
  path: string;
  expanded: boolean;
  referenced: boolean;
}

const TEXT_EXT = /\.(json|txt|md|yml|yaml|xml|html|css|js|ts|jsx|tsx|sh|env|cfg|ini|conf|log|csv|gitignore|editorconfig)$/i;

export function RepoFileChanges({ owner, repo, commitHash, baseCommitHash, manifest, isNew, onFileComment }: RepoFileChangesProps) {
  const [diffFiles, setDiffFiles] = useState<GithubPullFile[] | null>(null);
  const [fileItems, setFileItems] = useState<RepoFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const referencedFiles = getManifestReferencedFiles(manifest);
    let cancelled = false;
    setLoading(true);
    setError("");

    if (isNew) {
      listRepoFilesAtCommit(owner, repo, commitHash)
        .then((files) => {
          if (cancelled) return;
          setFileItems(
            files.map((path) => ({
              path,
              expanded: referencedFiles.includes(path),
              referenced: referencedFiles.includes(path),
            })),
          );
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (baseCommitHash) {
      compareCommits(owner, repo, baseCommitHash, commitHash)
        .then((data) => {
          if (cancelled) return;
          setDiffFiles(data.files);
          setFileItems(
            data.files.map((f) => ({
              path: f.filename,
              expanded: true,
              referenced: referencedFiles.includes(f.filename),
            })),
          );
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => { cancelled = true; };
  }, [owner, repo, commitHash, baseCommitHash, isNew]);

  const toggleFile = useCallback((path: string) => {
    setFileItems((prev) =>
      prev.map((item) =>
        item.path === path ? { ...item, expanded: !item.expanded } : item,
      ),
    );
  }, []);

  if (loading) {
    return <div className="py-4 text-center text-sm text-white/45">加载仓库文件列表...</div>;
  }

  if (error) {
    return <div className="py-4 text-sm text-red-400">加载失败: {error}</div>;
  }

  if (fileItems.length === 0) {
    return <p className="text-sm text-white/45">无文件变更</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {fileItems.map((item) => {
        const diffFile = diffFiles?.find((f) => f.filename === item.path);
        return (
          <RepoFileRow
            key={item.path}
            item={item}
            diffFile={diffFile}
            isNew={isNew}
            owner={owner}
            repo={repo}
            commitHash={commitHash}
            onToggle={toggleFile}
            onFileComment={onFileComment}
          />
        );
      })}
    </div>
  );
}

function RepoFileRow({
  item,
  diffFile,
  isNew,
  owner,
  repo,
  commitHash,
  onToggle,
  onFileComment,
}: {
  item: RepoFileItem;
  diffFile?: GithubPullFile;
  isNew: boolean;
  owner: string;
  repo: string;
  commitHash: string;
  onToggle: (path: string) => void;
  onFileComment?: (path: string) => void;
}) {
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");

  const showImage = isImagePath(item.path);
  const isText = TEXT_EXT.test(item.path);

  useEffect(() => {
    if (!item.expanded) return;
    if (!isNew) return;
    if (!showImage && !isText) return;

    let cancelled = false;
    setContentLoading(true);
    setContentError("");

    getRepoFile({
      repo: { owner, name: repo, branch: "" },
      path: item.path,
      ref: commitHash,
    })
      .then((data) => {
        if (cancelled) return;
        const raw = decodeBase64(data.content);
        setFileContent(raw);
      })
      .catch((err) => {
        if (!cancelled) setContentError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });

    return () => { cancelled = true; };
  }, [item.expanded, item.path, isNew, showImage, isText, owner, repo, commitHash]);

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black/20">
      <div className="flex min-w-0 flex-wrap items-center gap-2 p-3 text-sm">
        <button
          className="shrink-0 text-left"
          onClick={() => onToggle(item.path)}
        >
          <svg
            width="16"
            height="16"
            fill="currentColor"
            viewBox="0 0 256 256"
            className={`text-white/40 transition-transform ${item.expanded ? "" : "-rotate-90"}`}
          >
            <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
          </svg>
        </button>
        <span className="min-w-0 flex-1 break-all font-mono-sarasa text-white">
          {item.path}
        </span>
        {!item.referenced && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-200/70">
            未引用
          </span>
        )}
        <div className="ml-auto flex items-center">
          <button
            className="shrink-0 rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-blue-300 transition"
            onClick={(e) => {
              e.stopPropagation();
              const url = `https://github.com/${owner}/${repo}/blob/${commitHash}/${item.path}`;
              openUrl(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
            }}
            title="View this file"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: 'text-bottom' }}>
              <path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.824-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.824.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"></path>
            </svg>
          </button>
          {onFileComment && (
            <button
              className="shrink-0 rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-blue-300 transition"
              onClick={(e) => { e.stopPropagation(); onFileComment(item.path); }}
              title="Comment on this file"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: 'text-bottom' }}>
                <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {item.expanded && (
        <div className="border-t border-white/10">
          {isNew ? (
            contentLoading ? (
              <div className="p-3 text-xs text-white/45">加载中...</div>
            ) : contentError ? (
              <div className="p-3 text-xs text-red-400">{contentError}</div>
            ) : showImage ? (
              <ProxiedImage rawUrl={`https://raw.githubusercontent.com/${owner}/${repo}/${commitHash}/${item.path}`} filename={item.path} />
            ) : isText ? (
              <DiffBlock patch={fileContent || ""} />
            ) : (
              <div className="p-3 text-xs text-white/45">不支持显示非文本及图片内容</div>
            )
          ) : diffFile ? (
            <FileEntry file={diffFile} />
          ) : (
            <div className="p-3 text-xs text-white/45">文件未变更</div>
          )}
        </div>
      )}
    </div>
  );
}