import { Button, Dialog, Spinner } from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  approvePullRequest,
  createPullRequestComment,
  getCurrentGithubPermission,
  listOpenPullRequests,
  listPullRequestComments,
  listPullRequestFiles,
  type GithubIssueComment,
  type GithubPullFile,
  type GithubPullRequest,
} from "~/api/github/pr-review";
import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { PUBLISH_CONFIG } from "~/config/publish";
import { useRepoEnv } from "~/config/repoEnv";
import {
  deriveReviewStatus,
  type ReviewState,
} from "~/logic/publish/review-status";
import { useAccountState } from "~/logic/account/store";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import {
  parseCatalogCsv,
  type CatalogEntry,
} from "~/logic/publish/catalog";
import {
  buildRawFileUrl,
  type ManifestV2,
} from "~/logic/publish/manifest-loader";
import { MAIN_RESOURCE_BRANCH } from "~/logic/publish/branch";
import { getRepoFile, type RepoInfo } from "~/logic/publish/github-actions";

const STATE_LABELS: Record<ReviewState, string> = {
  waiting_review: "等待审核",
  changes_requested: "需要修改",
  fixed_waiting: "已修复待复核",
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const CATALOG_CSV_HEADER =
  "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type";

interface ResourcePackagePreview {
  kind: "正式包" | "试用包";
  deviceId: string;
  version: string;
  fileName: string;
  url: string;
}

interface PrResourcePreview {
  entry: CatalogEntry;
  ref: string;
  manifest?: ManifestV2;
  manifestError?: string;
  iconUrl: string;
  coverUrl: string;
  previewUrls: string[];
  packages: ResourcePackagePreview[];
}

function isImagePath(path: string) {
  return IMAGE_EXT.test(path);
}

function isVideoPath(path: string) {
  return VIDEO_EXT.test(path);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function makeNeedFixId() {
  return Math.random().toString(36).slice(2, 8);
}

function formatTime(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function decodeBase64(content?: string) {
  if (!content) return "";
  return new TextDecoder().decode(
    Uint8Array.from(atob(content.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
}

function isCatalogFile(filename?: string) {
  if (!filename) return false;
  return (
    filename === PUBLISH_CONFIG.catalogFilePath ||
    filename.endsWith(`/${PUBLISH_CONFIG.catalogFilePath}`)
  );
}

function parseCatalogEntryRow(row: string) {
  return parseCatalogCsv(`${CATALOG_CSV_HEADER}\n${row}`)[0];
}

function extractCatalogEntriesFromPatch(patch?: string) {
  if (!patch) return [];

  const byId = new Map<string, CatalogEntry>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    const row = line.slice(1).trim();
    if (!row || row === CATALOG_CSV_HEADER) continue;

    const parsed = parseCatalogEntryRow(row);
    if (parsed) byId.set(parsed.id, parsed);
  }

  return Array.from(byId.values());
}

function extractCatalogEntriesFromFiles(files: GithubPullFile[]) {
  const byId = new Map<string, CatalogEntry>();
  for (const file of files) {
    if (!isCatalogFile(file.filename)) continue;
    for (const entry of extractCatalogEntriesFromPatch(file.patch)) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values());
}

async function fetchManifest(entry: CatalogEntry, token: string) {
  const ref = entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;
  const repo: RepoInfo = {
    owner: entry.repo_owner,
    name: entry.repo_name,
    branch: MAIN_RESOURCE_BRANCH,
  };
  const file = await getRepoFile({
    repo,
    path: PUBLISH_CONFIG.manifestFileName,
    tokenOverride: token,
    ref,
  });
  return JSON.parse(decodeBase64(file.content)) as ManifestV2;
}

function buildResourceRawUrl(entry: CatalogEntry, ref: string, path?: string) {
  const cleanPath = (path || "").trim();
  if (!cleanPath) return "";
  return buildRawFileUrl(entry.repo_owner, entry.repo_name, ref, cleanPath);
}

function collectPackages(
  entry: CatalogEntry,
  ref: string,
  manifest?: ManifestV2,
): ResourcePackagePreview[] {
  if (!manifest) return [];

  const packages: ResourcePackagePreview[] = [];
  Object.entries(manifest.downloads ?? {}).forEach(([deviceId, info]) => {
    const fileName = info.file_name || "";
    if (!fileName) return;
    packages.push({
      kind: "正式包",
      deviceId,
      version: info.version || "",
      fileName,
      url: buildResourceRawUrl(entry, ref, fileName),
    });
  });

  const trialDownloads = manifest.ext?.trialDownloads as
    | Record<string, { version?: string; file_name?: string }>
    | undefined;
  Object.entries(trialDownloads ?? {}).forEach(([deviceId, info]) => {
    const fileName = info.file_name || "";
    if (!fileName) return;
    packages.push({
      kind: "试用包",
      deviceId,
      version: info.version || "",
      fileName,
      url: buildResourceRawUrl(entry, ref, fileName),
    });
  });

  return packages;
}

async function loadPrResourcePreviews(
  files: GithubPullFile[],
  token: string,
): Promise<PrResourcePreview[]> {
  const entries = extractCatalogEntriesFromFiles(files);
  return Promise.all(
    entries.map(async (entry) => {
      const ref = entry.repo_commit_hash || MAIN_RESOURCE_BRANCH;
      try {
        const manifest = await fetchManifest(entry, token);
        const iconPath = manifest.item?.icon || entry.icon;
        const coverPath = manifest.item?.cover || entry.cover;
        return {
          entry,
          ref,
          manifest,
          iconUrl: buildResourceRawUrl(entry, ref, iconPath),
          coverUrl: buildResourceRawUrl(entry, ref, coverPath),
          previewUrls: (manifest.item?.preview ?? [])
            .map((path) => buildResourceRawUrl(entry, ref, path))
            .filter(Boolean),
          packages: collectPackages(entry, ref, manifest),
        } satisfies PrResourcePreview;
      } catch (err) {
        return {
          entry,
          ref,
          manifestError: getErrorMessage(err),
          iconUrl: buildResourceRawUrl(entry, ref, entry.icon),
          coverUrl: buildResourceRawUrl(entry, ref, entry.cover),
          previewUrls: [],
          packages: [],
        } satisfies PrResourcePreview;
      }
    }),
  );
}

async function openAllPackages(packages: ResourcePackagePreview[]) {
  for (const item of packages) {
    if (!item.url) continue;
    await openUrl(item.url);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

export default function ResourceReviewPage() {
  const accountState = useAccountState();
  const env = useRepoEnv();
  const [permission, setPermission] = useState("");
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [permissionError, setPermissionError] = useState("");
  const [pulls, setPulls] = useState<GithubPullRequest[]>([]);
  const [commentsByPr, setCommentsByPr] = useState<Record<number, GithubIssueComment[]>>({});
  const [openNumber, setOpenNumber] = useState<number | null>(null);
  const [files, setFiles] = useState<GithubPullFile[]>([]);
  const [resourcePreviews, setResourcePreviews] = useState<PrResourcePreview[]>([]);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [stateFilter, setStateFilter] = useState<ReviewState | "all">("all");
  const [needFixMessage, setNeedFixMessage] = useState("");
  const [generalComment, setGeneralComment] = useState("");

  const canReview = ["admin", "maintain", "write"].includes(permission);
  const openPull = pulls.find((pull) => pull.number === openNumber) || null;
  const openComments = openNumber ? commentsByPr[openNumber] ?? [] : [];
  const openStatus = deriveReviewStatus(openComments);

  const loadPermission = async () => {
    setCheckingPermission(true);
    setPermissionError("");
    try {
      const res = await getCurrentGithubPermission();
      setPermission(res.permission);
    } catch (err) {
      setPermission("");
      setPermissionError(getErrorMessage(err));
    } finally {
      setCheckingPermission(false);
    }
  };

  const loadPulls = async () => {
    setLoadingPulls(true);
    try {
      const list = await listOpenPullRequests();
      setPulls(list);
      const commentEntries = await Promise.all(
        list.map(async (pull) => {
          try {
            return [pull.number, await listPullRequestComments(pull.number)] as const;
          } catch {
            return [pull.number, []] as const;
          }
        }),
      );
      setCommentsByPr(Object.fromEntries(commentEntries));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoadingPulls(false);
    }
  };

  const loadDetail = async (number: number) => {
    setLoadingDetail(true);
    try {
      const [nextComments, nextFiles] = await Promise.all([
        listPullRequestComments(number),
        listPullRequestFiles(number),
      ]);
      setCommentsByPr((prev) => ({ ...prev, [number]: nextComments }));
      setFiles(nextFiles);
      setResourcePreviews(
        await loadPrResourcePreviews(nextFiles, accountState.github?.token || ""),
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    void loadPermission();
  }, []);

  useEffect(() => {
    if (canReview) void loadPulls();
  }, [canReview]);

  useEffect(() => {
    if (openNumber) {
      void loadDetail(openNumber);
    } else {
      setFiles([]);
      setResourcePreviews([]);
    }
  }, [openNumber, accountState.github?.token]);

  const visiblePulls = useMemo(() => {
    if (stateFilter === "all") return pulls;
    return pulls.filter((pull) => {
      const status = deriveReviewStatus(commentsByPr[pull.number] ?? []);
      return status.state === stateFilter;
    });
  }, [commentsByPr, pulls, stateFilter]);

  const addNeedFix = async () => {
    if (!openNumber || !needFixMessage.trim()) return;
    try {
      const id = makeNeedFixId();
      await createPullRequestComment(
        openNumber,
        `[ABCC_NEEDFIX_${id}] ${needFixMessage.trim()}`,
      );
      setNeedFixMessage("");
      await loadDetail(openNumber);
      toast.success("Needfix 已发送");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const markFixed = async (id: string) => {
    if (!openNumber) return;
    try {
      await createPullRequestComment(openNumber, `[ABCC_FIXED_${id}] 已确认修复`);
      await loadDetail(openNumber);
      toast.success("已写入 fixed 标记");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const addGeneralComment = async () => {
    if (!openNumber || !generalComment.trim()) return;
    try {
      await createPullRequestComment(openNumber, generalComment.trim());
      setGeneralComment("");
      await loadDetail(openNumber);
      toast.success("评论已发送");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const approve = async () => {
    if (!openNumber) return;
    try {
      await approvePullRequest(openNumber);
      toast.success("已提交 GitHub approve");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  if (!accountState.github?.token) {
    return <StatePage title="PR审核" text="请先在侧边栏登录 GitHub 账号。" />;
  }

  if (checkingPermission) {
    return (
      <StatePage title="PR审核" text="正在检查 GitHub 仓库权限..." spinner />
    );
  }

  if (!canReview) {
    return (
      <StatePage
        title="PR审核"
        text={`当前 GitHub 账号没有 ${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name} 的 PR 管理权限。${permissionError ? ` ${permissionError}` : ""}`}
      />
    );
  }

  return (
    <div className="h-full overflow-hidden px-4 py-5 md:px-6">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-semibold text-white">PR审核</h1>
            <p className="text-sm text-white/60">
              {env.owner}/{env.repoName} · {permission}
            </p>
          </div>
          <Button onClick={loadPulls} disabled={loadingPulls}>
            刷新
          </Button>
        </div>

        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-nav-item">
          <div className="flex items-center gap-2 border-b border-white/10 p-3">
            <select
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value as ReviewState | "all")}
              className="min-h-10 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none"
            >
              <option value="all">全部状态</option>
              <option value="waiting_review">等待审核</option>
              <option value="changes_requested">需要修改</option>
              <option value="fixed_waiting">已修复待复核</option>
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loadingPulls && visiblePulls.length === 0 ? (
              <div className="grid h-60 place-items-center"><Spinner /></div>
            ) : visiblePulls.length === 0 ? (
              <div className="py-16 text-center text-sm text-white/45">暂无 open PR</div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {visiblePulls.map((pull) => {
                  const status = deriveReviewStatus(commentsByPr[pull.number] ?? []);
                  return (
                    <button
                      key={pull.number}
                      type="button"
                      onClick={() => setOpenNumber(pull.number)}
                      className="flex w-full flex-col gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-3 text-left transition hover:border-white/25 hover:bg-white/[0.04]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/65">#{pull.number}</span>
                        <StatusBadge state={status.state} />
                      </div>
                      <h2 className="line-clamp-2 text-sm font-semibold text-white">{pull.title}</h2>
                      <p className="truncate text-xs text-white/45">
                        {pull.user?.login} · {pull.head.ref} · {formatTime(pull.updated_at)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <Dialog.Root
        open={openNumber !== null}
        onOpenChange={(open) => {
          if (!open) setOpenNumber(null);
        }}
      >
        <Dialog.Content
          maxWidth="100vw"
          className="!w-[min(96vw,1400px)] !max-w-none"
        >
          <Dialog.Title>
            {openPull
              ? `#${openPull.number} · ${openPull.title}`
              : "PR 详情"}
          </Dialog.Title>
          {openPull && (
            <Dialog.Description size="2" className="mb-2 text-white/55">
              {openPull.user?.login} ·{" "}
              {openPull.head.repo?.full_name ?? openPull.head.ref} ·{" "}
              {openPull.head.sha.slice(0, 7)}
            </Dialog.Description>
          )}

          {openPull && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge state={openStatus.state} />
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/65">
                  #{openPull.number}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button variant="soft" onClick={() => openUrl(openPull.html_url)}>
                    在 GitHub 打开
                  </Button>
                  <Button color="green" onClick={approve}>Approve</Button>
                </div>
              </div>

              <div className="grid max-h-[72vh] min-w-0 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex min-w-0 flex-col gap-4">
                  {(loadingDetail || resourcePreviews.length > 0) && (
                    <Panel title="资源预览">
                      {loadingDetail && resourcePreviews.length === 0 ? (
                        <div className="py-8 text-center text-sm text-white/45">
                          正在解析资源信息...
                        </div>
                      ) : (
                        <ResourcePreviewList resources={resourcePreviews} />
                      )}
                    </Panel>
                  )}
                  <Panel title="改动文件">
                    {loadingDetail ? (
                      <div className="py-10 text-center text-white/45">加载中...</div>
                    ) : (
                      <div className="flex min-w-0 flex-col gap-2">
                        {files.map((file) => (
                          <FileEntry key={file.filename} file={file} />
                        ))}
                        {files.length === 0 && (
                          <p className="text-sm text-white/45">暂无文件信息</p>
                        )}
                      </div>
                    )}
                  </Panel>
                  <Panel title="评论流">
                    <div className="flex flex-col gap-2">
                      {openComments.map((comment) => (
                        <div key={comment.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                          <div className="mb-1 flex items-center gap-2 text-xs text-white/45">
                            <span>{comment.user?.login}</span>
                            <span>{formatTime(comment.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-white/70">{comment.body}</p>
                        </div>
                      ))}
                      {openComments.length === 0 && <p className="text-sm text-white/45">暂无评论</p>}
                    </div>
                  </Panel>
                </div>

                <div className="flex min-w-0 flex-col gap-4">
                  <Panel title="ABCC 状态">
                    <div className="flex flex-col gap-2">
                      {openStatus.items.map((item) => (
                        <div key={item.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-mono-sarasa text-xs text-white/45">{item.id}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs ${item.fixed ? "bg-emerald-500/15 text-emerald-100" : "bg-amber-500/15 text-amber-100"}`}>
                              {item.fixed ? "fixed" : "needfix"}
                            </span>
                          </div>
                          <p className="text-sm text-white/75">{item.message}</p>
                          {!item.fixed && (
                            <Button className="mt-2" size="1" variant="soft" onClick={() => markFixed(item.id)}>
                              标记 fixed
                            </Button>
                          )}
                        </div>
                      ))}
                      {openStatus.items.length === 0 && (
                        <p className="text-sm text-white/45">还没有 ABCC needfix。</p>
                      )}
                    </div>
                  </Panel>
                  <Panel title="添加 Needfix">
                    <textarea
                      value={needFixMessage}
                      onChange={(event) => setNeedFixMessage(event.target.value)}
                      className="min-h-28 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                    />
                    <Button className="mt-2 w-full" onClick={addNeedFix}>
                      发送 [ABCC_NEEDFIX]
                    </Button>
                  </Panel>
                  <Panel title="普通评论">
                    <textarea
                      value={generalComment}
                      onChange={(event) => setGeneralComment(event.target.value)}
                      className="min-h-28 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                    />
                    <Button className="mt-2 w-full" variant="soft" onClick={addGeneralComment}>
                      发送评论
                    </Button>
                  </Panel>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Dialog.Close>
              <Button variant="soft">关闭</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}

function FileEntry({ file }: { file: GithubPullFile }) {
  const showImage = isImagePath(file.filename) && file.raw_url;
  const showVideo = isVideoPath(file.filename) && file.raw_url;

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 break-all font-mono-sarasa text-white">{file.filename}</span>
        <span className="text-emerald-300">+{file.additions}</span>
        <span className="text-red-300">-{file.deletions}</span>
        {file.blob_url && (
          <button
            className="ml-auto text-xs text-blue-200 underline"
            onClick={() => openUrl(file.blob_url!)}
          >
            查看文件
          </button>
        )}
      </div>
      {showImage && <ProxiedImage rawUrl={file.raw_url!} filename={file.filename} />}
      {showVideo && <ProxiedVideo rawUrl={file.raw_url!} />}
      {!showImage && !showVideo && file.patch && (
        <DiffBlock patch={file.patch} />
      )}
    </div>
  );
}

function DiffBlock({ patch }: { patch: string }) {
  return (
    <div className="mt-2 max-h-96 max-w-full overflow-auto rounded border border-white/10 bg-black/30">
      <pre className="w-max min-w-full whitespace-pre py-2 font-mono-sarasa text-xs leading-5 text-white/65">
        {patch.split(/\r?\n/).map((line, index) => {
          const tone =
            line.startsWith("+") && !line.startsWith("+++")
              ? "bg-emerald-500/12 text-emerald-100"
              : line.startsWith("-") && !line.startsWith("---")
                ? "bg-red-500/12 text-red-100"
                : line.startsWith("@@")
                  ? "bg-blue-500/15 text-blue-100"
                  : "text-white/55";
          return (
            <div key={`${index}-${line.slice(0, 12)}`} className={`px-3 ${tone}`}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function ResourcePreviewList({ resources }: { resources: PrResourcePreview[] }) {
  if (resources.length === 0) {
    return <p className="text-sm text-white/45">没有从目录 diff 中识别到资源条目。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {resources.map((resource) => (
        <ResourcePreviewCard key={`${resource.entry.id}-${resource.ref}`} resource={resource} />
      ))}
    </div>
  );
}

function ResourcePreviewCard({ resource }: { resource: PrResourcePreview }) {
  const manifestItem = resource.manifest?.item;
  const title = manifestItem?.name || resource.entry.name || resource.entry.id;
  const description = manifestItem?.description || "";
  const allPackages = resource.packages.filter((item) => item.url);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <div className="grid gap-3 p-3 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="min-w-0">
          {resource.coverUrl ? (
            <ProxiedImage
              rawUrl={resource.coverUrl}
              filename={`${title} cover`}
              className="mt-0 aspect-[4/3] w-full max-w-none object-cover"
            />
          ) : (
            <div className="grid aspect-[4/3] place-items-center rounded border border-white/10 bg-white/[0.04] text-xs text-white/35">
              无封面
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-3">
            {resource.iconUrl && (
              <ProxiedImage
                rawUrl={resource.iconUrl}
                filename={`${title} icon`}
                className="mt-0 h-14 w-14 shrink-0 rounded-xl object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-base font-semibold text-white">{title}</h4>
              <p className="mt-1 break-all font-mono-sarasa text-xs text-white/55">
                {manifestItem?.id || resource.entry.id}
              </p>
              <p className="mt-1 text-xs text-white/45">
                {resource.entry.restype} · {resource.entry.paid_type || "free"} ·{" "}
                {resource.entry.repo_owner}/{resource.entry.repo_name}@{resource.ref.slice(0, 7)}
              </p>
            </div>
            {allPackages.length > 0 && (
              <Button
                size="1"
                variant="soft"
                onClick={() => void openAllPackages(allPackages)}
              >
                下载全部包体
              </Button>
            )}
          </div>

          {description && (
            <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-white/70">
              {description}
            </p>
          )}

          {resource.manifestError && (
            <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              manifest 读取失败：{resource.manifestError}
            </p>
          )}

          {resource.previewUrls.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {resource.previewUrls.map((url, index) => (
                <ProxiedImage
                  key={url}
                  rawUrl={url}
                  filename={`${title} preview ${index + 1}`}
                  className="mt-0 h-24 w-36 shrink-0 object-cover"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {resource.packages.length > 0 && (
        <div className="border-t border-white/10 p-3">
          <div className="grid gap-2 md:grid-cols-2">
            {resource.packages.map((pkg) => (
              <div
                key={`${pkg.kind}-${pkg.deviceId}-${pkg.fileName}`}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs"
              >
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/65">
                  {pkg.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono-sarasa text-white/80">{pkg.deviceId}</p>
                  <p className="truncate font-mono-sarasa text-white/45">
                    {pkg.version || "--"} · {pkg.fileName}
                  </p>
                </div>
                <Button size="1" variant="soft" onClick={() => openUrl(pkg.url)}>
                  下载
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProxiedImage({
  rawUrl,
  filename,
  className = "mt-2 max-h-80 max-w-full object-contain",
}: {
  rawUrl: string;
  filename: string;
  className?: string;
}) {
  const url = useProxiedMediaUrl(rawUrl);
  return (
    <img
      src={url}
      alt={filename}
      className={`rounded border border-white/10 ${className}`}
    />
  );
}

function ProxiedVideo({ rawUrl }: { rawUrl: string }) {
  const url = useProxiedMediaUrl(rawUrl);
  return (
    <video
      controls
      src={url}
      className="mt-2 max-h-80 max-w-full rounded border border-white/10"
    />
  );
}

function StatePage({
  title,
  text,
  spinner,
}: {
  title: string;
  text: string;
  spinner?: boolean;
}) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-lg rounded-2xl border border-white/10 bg-nav-item p-6 text-center">
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-white/60">{text}</p>
        {spinner && <div className="mt-4"><Spinner /></div>}
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: ReviewState }) {
  const className =
    state === "changes_requested"
      ? "bg-amber-500/15 text-amber-100"
      : state === "fixed_waiting"
        ? "bg-blue-500/15 text-blue-100"
        : "bg-white/10 text-white/65";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${className}`}>
      {STATE_LABELS[state]}
    </span>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      {children}
    </section>
  );
}
