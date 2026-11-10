import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, DropdownMenu, TextArea } from "~/components/ScaleAwareThemes";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
  ArrowClockwiseIcon,
  ArrowLeft,
  CheckSquare,
  DotsThree,
  FunnelSimple,
  MagnifyingGlass,
  WarningCircle,
} from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router";
import { useSetHeaderActions } from "~/layout/header-actions";
import { useNavVisibility } from "~/layout/nav-visibility-context";
import { useAccountState, getAstroboxToken } from "~/logic/account/store";
import { getGithubReadToken } from "~/logic/account/github-tokens";
import {
  sendCcNotice,
  findSentCcNotice,
  revokeCcNotice,
  inspectCcNotices,
  getCcNoticeOutcome,
  type CcNoticeDeliveryStatus,
  type CcNoticePayload,
} from "~/logic/inbox/send";
import {
  addCcNoticeFailures,
  clearCcNoticeFailures,
  loadCcNoticeFailures,
  removeCcNoticeFailure,
  type CcNoticeFailure,
} from "~/logic/inbox/batch-failures";
import type { CcNoticeSubtype } from "~/logic/inbox/types";

/** notifyCc 的三态：发送成功 / 找不到收件人（根本没发）/ 发送失败。 */
type CcNoticeSendResult = "sent" | "skipped" | "failed";
import { resolveAuthorProStatuses } from "./owner-pro";
import { useRepoEnv } from "~/config/repoEnv";
import { useReviewMode } from "~/config/publishMode";
import {
  deriveReviewStatus,
  deriveNeedFixAuthors,
  filterReviewTagComments,
  resolveLatestTagAction,
  type ReviewState,
  type ReviewStatusResult,
} from "~/logic/publish/review-status";
import {
  derivePluginRequestAuthors,
  derivePluginReviewStatus,
} from "~/logic/publish/plugin-review-status";
import {
  getCurrentGithubPermission,
  hasCommunityRepoManagePermission,
  getPullRequest,
  listReviewPullRequests,
  listPullRequestTimeline,
  listPullRequestTimelineWithReviews,
  listPullRequestFiles,
  approvePullRequest,
  mergePullRequest,
  closePullRequest,
  reopenPullRequest,
  requestChangesPullRequest,
  createPullRequestComment,
  deletePullRequestComment,
  deletePullRequestReview,
  updatePullRequestComment,
  updatePullRequestReview,
  listOrganizationMembers,
  type GithubIssueComment,
  type GithubPullRequest,
  type GithubPullReview,
} from "~/api/github/pr-review";
import {
  mergePreparedPluginPullRequest,
  preparePluginPullRequestForMerge,
} from "~/api/github/plugin-pr-review";
import { NG_PLUGIN_REPO_CONFIG } from "~/config/pluginRepo";
import {
  parseReviewSource,
  reviewPullKey,
  reviewPullKeyOf,
  reviewRepoRef,
  type ReviewPullRequest,
  type ReviewSource,
} from "./source";
import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { PullRequestCard } from "./components/PullRequestCard";
import ReviewersDrawer from "./components/ReviewersDrawer";
import ReviewFilterDrawer from "./components/ReviewFilterDrawer";
import BatchNoticeFailuresDrawer from "./components/BatchNoticeFailuresDrawer";
import { AuditLookupDialog } from "./components/AuditLookupDialog";
import { PullRequestReviewWorkspace } from "./components/PullRequestReviewWorkspace";
import {
  loadCatalogRollbackBaseline,
  rollbackCatalogRowsForPr,
} from "~/logic/publish/catalog-rollback";
import {
  buildCcNoticeCheckPlan,
  loadPrResourcePreviews,
  loadStagingPrResourcePreviews,
  getErrorMessage,
  isSelfApproveError,
  extractOldCatalogEntriesFromFiles,
  runWithConcurrency,
} from "./utils";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import type { CatalogEntry } from "~/logic/publish/catalog";
import { hasSubmissionFiles } from "~/logic/publish/submission-protocol";
import { parseReviewCommentBody } from "./utils/comment";
import type { PrResourcePreview } from "./types";
import { ReviewAccessMessage, PRReviewPageSkeleton } from "./components/ReviewAccessMessage";

function buildPrUrl(number: number): string {
  return `https://github.com/${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name}/pull/${number}`;
}

const CC_NOTICE_TITLES: Record<CcNoticeSubtype, (name: string) => string> = {
  "review-changes-requested": (name) => `《${name}》提交需要修改`,
  "review-approved": (name) => `《${name}》资源提交已通过审核`,
  "review-refused": (name) => `《${name}》资源提交被拒绝`,
  "review-closed": (name) => `《${name}》资源提交PR已被关闭`,
};

// 服务端 /admin/inbox 要求 title/body 均非空（minLength: 1），
// 审核人未填写具体意见时用默认正文兜底；已通过（合入）的正文单独拼接。
const CC_NOTICE_BODIES: Record<
  Exclude<CcNoticeSubtype, "review-approved">,
  string
> = {
  "review-changes-requested":
    "审核人要求对本次提交进行修改，请查看 PR 中的修改意见。",
  "review-refused": "你的资源提交未通过审核。",
  "review-closed": "你的资源提交已被关闭。",
};

/**
 * 解析当前 PR 中「声明已绑定 AstroBox 账号」的作者（manifest.item.author 里
 * bindABAccount 为 true 的 name，约定为 AstroBox 用户名），按用户名精确反查真实 userId。
 */
async function resolveRecipientUserIds(
  previews: PrResourcePreview[],
  astroboxToken: string | undefined,
): Promise<{ userIds: string[]; resourceName: string; resourceId: string }> {
  const boundNames = new Set<string>();
  let resourceName = "";
  let resourceId = "";
  for (const preview of previews) {
    if (!resourceName) {
      resourceName = preview.entry.name || "";
      resourceId = preview.entry.id || "";
    }
    const authors = preview.manifest?.item.author ?? [];
    for (const author of authors) {
      if (author.bindABAccount && author.name?.trim()) {
        boundNames.add(author.name.trim());
      }
    }
  }
  if (boundNames.size === 0) {
    return { userIds: [], resourceName, resourceId };
  }
  const statuses = await resolveAuthorProStatuses(
    Array.from(boundNames),
    astroboxToken,
  );
  const userIds = new Set<string>();
  for (const name of boundNames) {
    const status = statuses[name];
    if (status?.state === "found") userIds.add(status.user.userId);
  }
  return { userIds: Array.from(userIds), resourceName, resourceId };
}

export default function ResourceReviewPage() {
  const accountState = useAccountState();
  const env = useRepoEnv();
  const publishMode = useReviewMode();
  const setHeaderActions = useSetHeaderActions();
  const { isDesktop } = useNavVisibility();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [resourcePermission, setResourcePermission] = useState("");
  const [pluginPermission, setPluginPermission] = useState("");
  const [orgMembers, setOrgMembers] = useState<Set<string>>(new Set());
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [permissionError, setPermissionError] = useState("");
  const [pulls, setPulls] = useState<ReviewPullRequest[]>([]);
  const [commentsByPr, setCommentsByPr] = useState<Record<string, GithubIssueComment[]>>({});
  const [pluginReviewsByKey, setPluginReviewsByKey] = useState<
    Record<string, GithubPullReview[]>
  >({});
  const prParam = searchParams.get("pr");
  const openNumber = prParam && /^\d+$/.test(prParam) ? Number(prParam) : null;
  const openSource = parseReviewSource(searchParams.get("source"));
  const auditMode =
    openSource === "resource" &&
    searchParams.get("audit") === "1" &&
    openNumber !== null;
  const auditResourceId = auditMode
    ? searchParams.get("resource")?.trim() || null
    : null;
  const [detailPull, setDetailPull] = useState<ReviewPullRequest | null>(null);
  const [detailError, setDetailError] = useState("");
  const [auditBaselineError, setAuditBaselineError] = useState("");
  const [auditDialogOpen, setAuditDialogOpen] = useState(false);
  const [files, setFiles] = useState<import("~/api/github/pr-review").GithubPullFile[]>([]);
  const [resourcePreviews, setResourcePreviews] = useState<PrResourcePreview[]>([]);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [stateFilter, setStateFilter] = useState<ReviewState | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<ReviewSource | "all">("all");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [generalComment, setGeneralComment] = useState("");
  const [replyTarget, setReplyTarget] = useState<import("./components/CommentComposer").ReplyTarget | null>(null);
  const [editingTarget, setEditingTarget] = useState<import("./components/CommentComposer").EditingTarget | null>(null);
  const [noticeDraft, setNoticeDraft] = useState<import("./components/CommentComposer").NoticeDraft | null>(null);
  const [noticeStatusByCommentId, setNoticeStatusByCommentId] = useState<
    Record<number, CcNoticeDeliveryStatus>
  >({});
  const [checkingNoticeStatus, setCheckingNoticeStatus] = useState(false);
  const [noticeStatusTick, setNoticeStatusTick] = useState(0);
  const [rotate, setRotate] = useState(0);
  const [detailRotate, setDetailRotate] = useState(0);
  const [isWorkbenchSidebarCollapsed, setIsWorkbenchSidebarCollapsed] =
    useState(true);
  const [reviewersKey, setReviewersKey] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [approving, setApproving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [closing, setClosing] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkClosing, setBulkClosing] = useState(false);
  const [bulkCloseDialogOpen, setBulkCloseDialogOpen] = useState(false);
  const [bulkCloseReason, setBulkCloseReason] = useState("");
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [batchFailures, setBatchFailures] = useState<CcNoticeFailure[]>(() =>
    loadCcNoticeFailures(),
  );
  const [failuresDrawerOpen, setFailuresDrawerOpen] = useState(false);
  const [retryingNumbers, setRetryingNumbers] = useState<Set<number>>(new Set());
  const loadDetailRef = useRef<number>(0);
  /**
   * 按 PR 的 updated_at 缓存最近一次完整时间线。列表刷新和详情加载共用，
   * PR 没有变化时不再重复请求 comments + reviews。
   */
  const timelineCacheRef = useRef(
    new Map<
      string,
      {
        updatedAt: string;
        comments: GithubIssueComment[];
        reviews: GithubPullReview[];
        fetchedAt: number;
      }
    >(),
  );

  const canReviewResource = hasCommunityRepoManagePermission(resourcePermission);
  const canReviewPlugin = hasCommunityRepoManagePermission(pluginPermission);
  const canReview = canReviewResource || canReviewPlugin;
  const isInitialLoading =
    checkingPermission ||
    (!auditMode && loadingPulls && pulls.length === 0);
  const openKey =
    openNumber !== null ? reviewPullKeyOf(openSource, openNumber) : "";
  const listedPull =
    pulls.find(
      (pull) => pull.number === openNumber && pull.source === openSource,
    ) || null;
  const openPull =
    listedPull ??
    (detailPull?.number === openNumber && detailPull.source === openSource
      ? detailPull
      : null);
  const openComments = openKey ? commentsByPr[openKey] ?? [] : [];
  const openStatus: ReviewStatusResult =
    openSource === "plugin"
      ? {
          state: derivePluginReviewStatus(
            pluginReviewsByKey[openKey] ?? [],
            orgMembers,
          ),
          items: [],
        }
      : deriveReviewStatus(openComments);
  const statusByKey = useMemo(() => {
    const map: Record<string, ReviewState> = {};
    for (const pull of pulls) {
      const key = reviewPullKey(pull);
      map[key] =
        pull.source === "plugin"
          ? derivePluginReviewStatus(pluginReviewsByKey[key] ?? [], orgMembers)
          : deriveReviewStatus(commentsByPr[key] ?? []).state;
    }
    return map;
  }, [pulls, commentsByPr, pluginReviewsByKey, orgMembers]);
  const rollbackPreviews = useMemo(() => {
    if (!auditResourceId) return resourcePreviews;
    const needle = auditResourceId.trim().toLowerCase();
    return resourcePreviews.filter((preview) =>
      [preview.entry.id, preview.originalId, preview.request?.originalId].some(
        (value) => value?.trim().toLowerCase() === needle,
      ),
    );
  }, [auditResourceId, resourcePreviews]);

  const reviewModeForOpenPr =
    openSource === "plugin"
      ? "legacy"
      : publishMode === "staging" || hasSubmissionFiles(files)
        ? "staging"
        : "legacy";

  const repoFileChanges = useMemo(() => {
    if (openSource === "plugin") return [];
    if (files.length === 0 || resourcePreviews.length === 0) return [];
    if (reviewModeForOpenPr === "staging") {
      return resourcePreviews.map((preview) => {
        const oldEntry = preview.baseEntry;
        const isNew = !oldEntry || !oldEntry.repo_commit_hash;
        return {
          entryId: preview.entry.id,
          resourceName: preview.entry.name,
          isNew,
          owner: preview.entry.repo_owner,
          repo: preview.entry.repo_name,
          commitHash: preview.entry.repo_commit_hash || preview.ref,
          baseCommitHash: isNew ? undefined : oldEntry!.repo_commit_hash,
          manifest: preview.manifest,
        };
      });
    }
    const oldEntries = extractOldCatalogEntriesFromFiles(files);
    const oldById = new Map<string, CatalogEntry>();
    for (const entry of oldEntries) oldById.set(entry.id, entry);

    return resourcePreviews.map((preview) => {
      const oldEntry = oldById.get(preview.entry.id);
      const isNew = !oldEntry || !oldEntry.repo_commit_hash;
      return {
        entryId: preview.entry.id,
        resourceName: preview.entry.name,
        isNew,
        owner: preview.entry.repo_owner,
        repo: preview.entry.repo_name,
        commitHash: preview.entry.repo_commit_hash || preview.ref,
        baseCommitHash: isNew ? undefined : oldEntry!.repo_commit_hash,
        manifest: preview.manifest,
      };
    });
  }, [files, resourcePreviews, reviewModeForOpenPr, openSource]);

  const loadPermission = async () => {
    setCheckingPermission(true);
    setPermissionError("");
    const resourceRepo = reviewRepoRef("resource");
    const pluginRepo = reviewRepoRef("plugin");
    const [resourceResult, pluginResult] = await Promise.allSettled([
      getCurrentGithubPermission(resourceRepo),
      getCurrentGithubPermission(pluginRepo),
    ]);
    if (resourceResult.status === "fulfilled") {
      setResourcePermission(resourceResult.value.permission);
    } else {
      setResourcePermission("");
    }
    if (pluginResult.status === "fulfilled") {
      setPluginPermission(pluginResult.value.permission);
    } else {
      setPluginPermission("");
    }
    const errors = [resourceResult, pluginResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => getErrorMessage(result.reason));
    setPermissionError(errors.join("；"));
    setCheckingPermission(false);
  };

  useEffect(() => {
    void listOrganizationMembers(COMMUNITY_REPO_CONFIG.owner)
      .then(setOrgMembers)
      .catch(() => setOrgMembers(new Set()));
  }, []);

  const loadPulls = async () => {
    // 等待 orgMembers 加载完成，避免资源 PR 的审核标签过滤失效。
    // 插件 PR 不使用 ABCC 标签，但一起等待可以保证首次加载只跑一次。
    if (canReviewResource && orgMembers.size === 0) return;

    setLoadingPulls(true);
    try {
      const [resourcePulls, pluginPulls] = await Promise.all([
        canReviewResource
          ? listReviewPullRequests("open", reviewRepoRef("resource"))
          : Promise.resolve([]),
        canReviewPlugin
          ? listReviewPullRequests("open", reviewRepoRef("plugin"))
          : Promise.resolve([]),
      ]);
      const combined: ReviewPullRequest[] = [
        ...resourcePulls.map((pull) => ({ ...pull, source: "resource" as const })),
        ...pluginPulls.map((pull) => ({ ...pull, source: "plugin" as const })),
      ];

      const entries = await runWithConcurrency(
        combined,
        6,
        async (pull) => {
          const key = reviewPullKey(pull);
          const repo = reviewRepoRef(pull.source);
          const updatedAt = pull.updated_at || "";
          const cached = timelineCacheRef.current.get(key);
          try {
            if (pull.source === "plugin") {
              const result = await listPullRequestTimelineWithReviews(
                pull.number,
                repo,
              );
              timelineCacheRef.current.set(key, {
                updatedAt,
                comments: result.timeline,
                reviews: result.reviews,
                fetchedAt: Date.now(),
              });
              return {
                key,
                pull,
                comments: result.timeline,
                reviews: result.reviews,
              };
            }
            let comments: GithubIssueComment[];
            if (cached && cached.updatedAt === updatedAt) {
              comments = cached.comments;
            } else {
              comments = await listPullRequestTimeline(pull.number, repo);
              timelineCacheRef.current.set(key, {
                updatedAt,
                comments,
                reviews: [],
                fetchedAt: Date.now(),
              });
            }
            return {
              key,
              pull,
              comments: filterReviewTagComments(
                comments,
                orgMembers,
                pull.user?.login,
              ),
              reviews: [] as GithubPullReview[],
            };
          } catch {
            // 限流等情况保留上一次缓存，避免把已知的审核状态清空。
            return {
              key,
              pull,
              comments: cached?.comments ?? [],
              reviews: cached?.reviews ?? [],
            };
          }
        },
      );

      const commentMap: Record<string, GithubIssueComment[]> = {};
      const reviewMap: Record<string, GithubPullReview[]> = {};
      const refusedKeys = new Set<string>();
      for (const entry of entries) {
        commentMap[entry.key] = entry.comments;
        reviewMap[entry.key] = entry.reviews;
        if (
          entry.pull.source === "resource" &&
          entry.comments.some((comment) =>
            /^\s*\[ABCC_REFUSE\]/i.test(comment.body || ""),
          )
        ) {
          refusedKeys.add(entry.key);
        }
      }
      setPulls(combined.filter((pull) => !refusedKeys.has(reviewPullKey(pull))));
      setCommentsByPr(commentMap);
      setPluginReviewsByKey(reviewMap);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoadingPulls(false);
    }
  };

  const handleRefreshList = () => {
    // 手动刷新强制重新拉取时间线，不受 updated_at 缓存影响。
    timelineCacheRef.current.clear();
    setRotate((prev) => prev + 360);
    setRefreshTick((prev) => prev + 1);
  };

  /**
   * 处理评论里携带的 REFUSE / CLOSE / REOPEN 标签副作用。
   * 回查模式只读取历史提交，不能因为历史标签再次改变 PR 状态。
   */
  const applyCommentTagActions = async (
    source: ReviewSource,
    number: number,
    comments: GithubIssueComment[],
  ) => {
    if (source !== "resource" || auditMode) return;
    const repo = reviewRepoRef(source);
    const refuseComment = comments.find((comment) =>
      /^\s*\[ABCC_REFUSE\]/i.test(comment.body || ""),
    );
    if (refuseComment) {
      const fresh = await getPullRequest(number, repo);
      if (fresh.state === "open") {
        await closePullRequest(number, repo);
        toast.success("检测到 REFUSE 标签，PR 已关闭并拒绝。");
        await loadPulls();
        navigate("/resreview", { replace: true });
      }
      return;
    }
    // 同一 PR 可能同时存在 CLOSE 与 REOPEN 评论（例如关闭后又被创作者重开），
    // 只以最新一条标签为准，避免 CLOSE/REOPEN 互相触发形成循环。
    const latestAction = resolveLatestTagAction(comments);
    if (!latestAction) return;
    const fresh = await getPullRequest(number, repo);
    if (latestAction === "reopen") {
      if (fresh.state === "closed" && !fresh.merged_at) {
        await reopenPullRequest(number, repo);
        toast.success("检测到 REOPEN 标签，PR 已重新打开。");
        await loadPulls();
      }
    } else if (fresh.state === "open") {
      await closePullRequest(number, repo);
      toast.success("检测到 CLOSE 标签，PR 已关闭。");
      await loadPulls();
    }
  };

  /**
   * 只刷新评论时间线，不重新解析 PR 详情。
   *
   * 评论的增删改不会改变 PR 的文件列表与资源预览；若复用 loadDetail，它会先清空
   * files / resourcePreviews 再重新拉取，导致「资源信息」Tab 重置、自动检查
   * 因输入引用变化而整块重跑。这里沿用 loadDetail 的时间线缓存结构，只更新评论。
   */
  const refreshTimeline = async (source: ReviewSource, number: number) => {
    const key = reviewPullKeyOf(source, number);
    const repo = reviewRepoRef(source);
    const pull =
      pulls.find(
        (item) => item.number === number && item.source === source,
      ) ??
      (detailPull?.number === number && detailPull.source === source
        ? detailPull
        : null);
    timelineCacheRef.current.delete(key);

    if (source === "plugin") {
      const { timeline, reviews } = await listPullRequestTimelineWithReviews(
        number,
        repo,
      );
      timelineCacheRef.current.set(key, {
        updatedAt: pull?.updated_at || "",
        comments: timeline,
        reviews,
        fetchedAt: Date.now(),
      });
      setCommentsByPr((prev) => ({ ...prev, [key]: timeline }));
      setPluginReviewsByKey((prev) => ({ ...prev, [key]: reviews }));
      return;
    }

    const timeline = await listPullRequestTimeline(number, repo);
    const nextComments = filterReviewTagComments(
      timeline,
      orgMembers,
      pull?.user?.login,
    );
    timelineCacheRef.current.set(key, {
      updatedAt: pull?.updated_at || "",
      comments: timeline,
      reviews: [],
      fetchedAt: Date.now(),
    });
    setCommentsByPr((prev) => ({ ...prev, [key]: nextComments }));
    await applyCommentTagActions(source, number, nextComments);
  };

  const loadDetail = async (source: ReviewSource, number: number) => {
    const callId = ++loadDetailRef.current;
    setLoadingDetail(true);
    setDetailError("");
    setAuditBaselineError("");
    setFiles([]);
    setResourcePreviews([]);
    const key = reviewPullKeyOf(source, number);
    const repo = reviewRepoRef(source);
    try {
      let pull: ReviewPullRequest | null =
        pulls.find(
          (item) => item.number === number && item.source === source,
        ) ??
        (detailPull?.number === number && detailPull.source === source
          ? detailPull
          : null);
      if (!pull) {
        const fetched = await getPullRequest(number, repo);
        if (callId !== loadDetailRef.current) return;
        pull = { ...fetched, source };
        setDetailPull(pull);
      }

      // 回查模式要还原 PR 合入前的目录状态；普通模式仍然看当前默认分支。
      const baselinePromise =
        auditMode && source === "resource" && pull
          ? loadCatalogRollbackBaseline(pull).catch((err) => {
              if (callId === loadDetailRef.current) {
                setAuditBaselineError(getErrorMessage(err));
              }
              return null;
            })
          : Promise.resolve(null);
      const updatedAt = pull?.updated_at || "";
      const cachedTimeline = timelineCacheRef.current.get(key);
      // 列表里的 updated_at 可能已经过时；详情打开时超过 30 秒就重新拉取。
      const timelineFresh =
        cachedTimeline &&
        cachedTimeline.updatedAt === updatedAt &&
        Date.now() - cachedTimeline.fetchedAt < 30_000;
      const timelinePromise: Promise<{
        timeline: GithubIssueComment[];
        reviews: GithubPullReview[];
      }> = timelineFresh
        ? Promise.resolve({
            timeline: cachedTimeline.comments,
            reviews: cachedTimeline.reviews,
          })
        : source === "plugin"
          ? listPullRequestTimelineWithReviews(number, repo).then((result) => {
              timelineCacheRef.current.set(key, {
                updatedAt,
                comments: result.timeline,
                reviews: result.reviews,
                fetchedAt: Date.now(),
              });
              return result;
            })
          : listPullRequestTimeline(number, repo).then((timeline) => {
              timelineCacheRef.current.set(key, {
                updatedAt,
                comments: timeline,
                reviews: [],
                fetchedAt: Date.now(),
              });
              return { timeline, reviews: [] as GithubPullReview[] };
            });
      const [timelineResult, nextFiles, baseline] = await Promise.all([
        timelinePromise,
        listPullRequestFiles(number, repo),
        baselinePromise,
      ]);
      if (callId !== loadDetailRef.current) return;
      const nextComments =
        source === "plugin"
          ? timelineResult.timeline
          : filterReviewTagComments(
              timelineResult.timeline,
              orgMembers,
              pull?.user?.login,
            );
      // 文件列表与评论不依赖资源 manifest，先落状态：资源信息还在解析时，
      // 「改动文件」「评论」等标签页已经可以展示内容。
      setCommentsByPr((prev) => ({ ...prev, [key]: nextComments }));
      if (source === "plugin") {
        setPluginReviewsByKey((prev) => ({
          ...prev,
          [key]: timelineResult.reviews,
        }));
      }
      setFiles(nextFiles);

      // 资源行解析完成一个就先展示一个，不必等全部 manifest 都返回。
      const previewSlots: Array<PrResourcePreview | undefined> = [];
      const publishPreview = (preview: PrResourcePreview, index: number) => {
        if (callId !== loadDetailRef.current) return;
        previewSlots[index] = preview;
        setResourcePreviews(
          previewSlots.filter(
            (item): item is PrResourcePreview => Boolean(item),
          ),
        );
      };
      const readToken = getGithubReadToken() || "";
      const nextResourcePreviews =
        source === "resource" && pull &&
        (publishMode === "staging" || hasSubmissionFiles(nextFiles))
          ? await loadStagingPrResourcePreviews(
              nextFiles,
              readToken,
              pull,
              auditMode
                ? {
                    baseEntries: baseline?.entries ?? [],
                    allowDefaultBase: false,
                    onPreview: publishPreview,
                  }
                : { onPreview: publishPreview },
            )
          : source === "resource"
            ? await loadPrResourcePreviews(
                nextFiles,
                readToken,
                publishPreview,
              )
            : [];
      if (callId !== loadDetailRef.current) return;
      setResourcePreviews(nextResourcePreviews);

      // 资源行已经就绪，先结束 loading 再执行标签副作用；图片等展示资源
      // 由 loadingDetail 关闭后再开始请求，避免和收尾请求抢带宽。
      setLoadingDetail(false);

      // 回查只读取历史提交，不能因为历史评论里的 REFUSE/CLOSE/REOPEN 标签
      // 再次改变 PR 状态；这些副作用只在普通资源审核模式执行。
      await applyCommentTagActions(source, number, nextComments);
    } catch (err) {
      if (callId === loadDetailRef.current) {
        const message = getErrorMessage(err);
        setDetailError(message);
        toast.error(message);
      }
    } finally {
      if (callId === loadDetailRef.current) {
        setLoadingDetail(false);
      }
    }
  };

  useEffect(() => {
    void loadPermission();
  }, []);

  useEffect(() => {
    // 回查只需要目标 PR，不加载开放 PR 列表，避免无谓请求与列表状态干扰。
    if (!canReview || auditMode) return;
    void loadPulls();
  }, [canReview, canReviewResource, canReviewPlugin, refreshTick, orgMembers, auditMode]);

  useEffect(() => {
    setGeneralComment("");
    setReplyTarget(null);
    setEditingTarget(null);
    setNoticeDraft(null);
    setDetailError("");
    if (openNumber) {
      // 资源 PR 的评论过滤依赖 orgMembers；插件 PR 不使用标签，无需等待。
      const needsOrgMembers = openSource === "resource";
      if (needsOrgMembers && orgMembers.size === 0) {
        const waitForOrgMembers = setInterval(() => {
          if (orgMembers.size > 0) {
            clearInterval(waitForOrgMembers);
            void loadDetail(openSource, openNumber);
          }
        }, 100);
        setTimeout(() => clearInterval(waitForOrgMembers), 5000);
      } else {
        void loadDetail(openSource, openNumber);
      }
    } else {
      loadDetailRef.current += 1;
      setDetailPull(null);
      setAuditBaselineError("");
      setFiles([]);
      setResourcePreviews([]);
      setLoadingDetail(false);
    }
    // detailPull 由 loadDetail 自己维护；依赖它会让详情加载再次触发自身。
  }, [openNumber, openSource, accountState.github?.token, publishMode, orgMembers, auditMode]);

  // 检测当前 PR 的审核通知（NEEDFIX / 关闭 / 拒绝）是否送达 AstroBox 信箱，
  // 结果按评论回填：送达状态与重发入口都挂在对应评论上，PR 概览不再单独展示。
  useEffect(() => {
    if (!openNumber || openSource !== "resource") {
      setNoticeStatusByCommentId({});
      return;
    }
    const comments = commentsByPr[openKey] ?? [];
    const plan = buildCcNoticeCheckPlan(openNumber, comments);
    if (plan.targets.length === 0) {
      setNoticeStatusByCommentId({});
      return;
    }

    let cancelled = false;
    setCheckingNoticeStatus(true);
    void (async () => {
      try {
        const { userIds } = await resolveRecipientUserIds(
          resourcePreviews,
          getAstroboxToken(),
        );
        const statuses = await inspectCcNotices({
          prNumber: openNumber,
          userIds,
          targets: plan.targets,
        });
        if (cancelled) return;
        const byComment: Record<number, CcNoticeDeliveryStatus> = {};
        for (const [key, commentId] of Object.entries(
          plan.commentIdByKey,
        ) as [string, number][]) {
          const status = statuses.get(key);
          if (status) byComment[commentId] = status;
        }
        setNoticeStatusByCommentId(byComment);
      } catch {
        if (!cancelled) {
          setNoticeStatusByCommentId({});
        }
      } finally {
        if (!cancelled) setCheckingNoticeStatus(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    openNumber,
    openSource,
    openKey,
    commentsByPr,
    resourcePreviews,
    accountState.astrobox?.token,
    noticeStatusTick,
  ]);

  const visiblePulls = useMemo(() => {
    // 两个来源的 PR 混排，统一按最近更新时间倒序，避免插件永远排在资源后面。
    const list = [...pulls].sort((a, b) =>
      (b.updated_at || "").localeCompare(a.updated_at || ""),
    );
    const sourceFiltered =
      sourceFilter === "all"
        ? list
        : list.filter((pull) => pull.source === sourceFilter);
    if (stateFilter === "all") return sourceFiltered;
    return sourceFiltered.filter((pull) => {
      const status = statusByKey[reviewPullKey(pull)] ?? "waiting_review";
      return status === stateFilter;
    });
  }, [commentsByPr, pulls, stateFilter, sourceFilter, statusByKey]);

  const refreshDetail = () => {
    if (!openNumber) return;
    timelineCacheRef.current.delete(reviewPullKeyOf(openSource, openNumber));
    setDetailRotate((prev) => prev + 360);
    void loadDetail(openSource, openNumber);
  };

  const deleteComment = async (comment: GithubIssueComment) => {
    if (!openNumber || !comment.id) return;
    const repo = reviewRepoRef(openSource);
    try {
      if (comment.pull_review_id) {
        await deletePullRequestReview(openNumber, comment.pull_review_id, repo);
      } else {
        await deletePullRequestComment(comment.id, repo);
      }
      await refreshTimeline(openSource, openNumber);
      toast.success("评论已删除");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const editComment = (comment: GithubIssueComment) => {
    if (openSource === "plugin") {
      setGeneralComment(comment.body || "");
      setEditingTarget({ comment });
      setNoticeDraft(null);
      setReplyTarget(null);
      return;
    }
    const parsed = parseReviewCommentBody(comment.body || "");
    setGeneralComment(parsed.content);
    const sentRecord =
      parsed.tagType === "NEEDFIX" && parsed.tagId && openNumber
        ? findSentCcNotice({
            subtype: "review-changes-requested",
            prNumber: openNumber,
            tagId: parsed.tagId,
          })
        : null;
    setEditingTarget({
      comment,
      ...(sentRecord
        ? {
            ccNotice: {
              bulkId: sentRecord.bulkId,
              title: sentRecord.payload.title,
              body: sentRecord.payload.body,
              tagId: parsed.tagId,
            },
          }
        : {}),
    });
    setNoticeDraft(
      sentRecord
        ? { enabled: true, title: sentRecord.payload.title, body: sentRecord.payload.body }
        : null,
    );
    setReplyTarget(null);
  };

  const submitComment = async (body: string) => {
    if (!openNumber || !body || submittingComment) return;
    const number = openNumber;
    const repo = reviewRepoRef(openSource);
    setSubmittingComment(true);
    try {
      if (openSource === "plugin") {
        if (editingTarget) {
          if (editingTarget.comment.pull_review_id) {
            await updatePullRequestReview(
              number,
              editingTarget.comment.pull_review_id,
              body,
              repo,
            );
          } else {
            await updatePullRequestComment(editingTarget.comment.id, body, repo);
          }
        } else {
          await createPullRequestComment(number, body, repo);
        }
        setGeneralComment("");
        setReplyTarget(null);
        setEditingTarget(null);
        await refreshTimeline("plugin", number);
        toast.success(editingTarget ? "评论已更新" : "评论已发送");
        return;
      }

      const isNewNeedFix =
        !editingTarget && /^\s*\[ABCC_NEEDFIX/i.test(body.trim());
      if (editingTarget) {
        if (editingTarget.comment.pull_review_id) {
          await updatePullRequestReview(
            number,
            editingTarget.comment.pull_review_id,
            body,
            repo,
          );
        } else {
          await updatePullRequestComment(editingTarget.comment.id, body, repo);
        }
      } else if (isNewNeedFix) {
        await requestChangesPullRequest(number, body, repo);
      } else {
        await createPullRequestComment(number, body, repo);
      }
      setGeneralComment("");
      setReplyTarget(null);
      setEditingTarget(null);
      await refreshTimeline(openSource, number);
      let resentNotice = false;
      if (editingTarget?.ccNotice && noticeDraft?.enabled) {
        // 编辑的是 NEEDFIX 评论且此前已发送过审核通知：撤回旧通知后按草稿重发。
        const updated = parseReviewCommentBody(body);
        if (updated.tagType === "NEEDFIX" && updated.tagId) {
          // 传 userIds：本机没有发送记录时（换设备/清过缓存）也能从服务端
          // 恢复撤回句柄。撤回失败会抛出，外层 catch 提示并中止下面的重发，
          // 避免出现"旧的还在、新的又来一份"。
          const { userIds } = await resolveRecipientUserIds(
            resourcePreviews,
            getAstroboxToken(),
          );
          await revokeCcNotice({
            subtype: "review-changes-requested",
            prNumber: number,
            tagId: editingTarget.ccNotice.tagId,
            userIds,
          });
          void notifyCc({
            subtype: "review-changes-requested",
            prNumber: number,
            tagId: updated.tagId,
            content: updated.content,
            titleOverride: noticeDraft.title,
            bodyOverride: noticeDraft.body,
          });
          resentNotice = true;
        }
        setNoticeDraft(null);
      }
      if (isNewNeedFix) {
        const parsed = parseReviewCommentBody(body);
        void notifyCc({
          subtype: "review-changes-requested",
          prNumber: number,
          tagId: parsed.tagId || undefined,
          content: parsed.content,
        });
      }
      toast.success(
        editingTarget
          ? resentNotice
            ? "评论已更新，审核通知已撤回重发"
            : "评论已更新"
          : isNewNeedFix
            ? "评论已发送，PR 已标记为需要修改"
            : "评论已发送",
      );
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmittingComment(false);
    }
  };

  const approve = async () => {
    if (!openNumber || approving) return;
    const number = openNumber;
    const repo = reviewRepoRef(openSource);
    setApproving(true);
    try {
      await approvePullRequest(number, undefined, repo);
      toast.success("已提交 GitHub approve", { duration: 4000 });
      timelineCacheRef.current.delete(reviewPullKeyOf(openSource, number));
      void loadDetail(openSource, number).catch(() => {
        // 刷新时间线失败不影响 approve 已成功的提示。
      });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setApproving(false);
    }
  };

  const merge = async () => {
    if (!openNumber || merging) return;
    const number = openNumber;
    const repo = reviewRepoRef(openSource);
    setMerging(true);
    try {
      await mergePullRequest(number, repo);
      // staging 提交协议 request.json 直接带 mode；legacy 退回用目录旧条目启发式。
      // delete 也走同一列表，但不能按 create 通知服务端。
      const protocolModes = resourcePreviews
        .map((preview) => preview.request?.mode)
        .filter(
          (mode): mode is "create" | "edit" | "delete" =>
            mode === "create" || mode === "edit" || mode === "delete",
        );
      const isCreateMode =
        protocolModes.length > 0
          ? protocolModes.every((mode) => mode === "create")
          : repoFileChanges.length === 0 ||
            repoFileChanges.every((change) => change.isNew);
      void notifyCc({
        subtype: "review-approved",
        prNumber: number,
        createMode: isCreateMode,
      });
      toast.success("PR 已合入，仓库 Action 将自动应用资源请求。", { duration: 4000 });
      await loadPulls();
      if (openNumber === number) {
        navigate("/resreview", { replace: true });
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setMerging(false);
    }
  };

  const rollback = async () => {
    if (!openPull || rollingBack) return;
    if (rollbackPreviews.length === 0) {
      toast.error(
        auditResourceId
          ? `当前 PR 未包含资源 ID「${auditResourceId}」，无法回退。`
          : "没有解析到可回退的资源行。",
      );
      return;
    }
    setRollingBack(true);
    try {
      const result = await rollbackCatalogRowsForPr({
        pull: openPull,
        previews: rollbackPreviews,
        resourceId: auditResourceId ?? undefined,
      });
      if (result.plan.changes.length === 0) {
        toast.message("目录已处于回退后的状态，无需写入。");
      } else {
        toast.success(
          `已回退 ${result.plan.changes.length} 个资源行`,
          {
            description: result.commitUrl || undefined,
            duration: 6000,
          },
        );
      }
      if (openNumber) {
        timelineCacheRef.current.delete(
          reviewPullKeyOf("resource", openNumber),
        );
        await loadDetail("resource", openNumber);
      }
    } catch (err) {
      toast.error(getErrorMessage(err), { duration: 8000 });
    } finally {
      setRollingBack(false);
    }
  };

  const openAuditPull = (number: number, resourceId?: string) => {
    const nextResourceId = resourceId?.trim() || null;
    const sameAuditTarget =
      auditMode &&
      number === openNumber &&
      nextResourceId === auditResourceId;
    const params = new URLSearchParams({
      pr: String(number),
      audit: "1",
    });
    if (nextResourceId) params.set("resource", nextResourceId);
    setAuditDialogOpen(false);

    // 同一个 PR 再查一次时 URL 不变，路由 effect 不会重跑；显式重新加载。
    if (sameAuditTarget) {
      setDetailError("");
      setResourcePreviews([]);
      timelineCacheRef.current.delete(reviewPullKeyOf("resource", number));
      void loadDetail("resource", number);
      return;
    }
    navigate(`/resreview/detail?${params.toString()}`);
  };

  // 批准与合入合并为单一步骤：先提交 GitHub Approve，成功后再执行合入。
  // GitHub 不允许批准自己的 PR（返回 422），此类情况跳过批准直接合入。
  const approveAndMerge = async () => {
    if (!openNumber || approving || merging) return;
    const number = openNumber;
    const repo = reviewRepoRef(openSource);
    const token = accountState.github?.token || "";
    const myLogin = accountState.github?.username?.trim().toLowerCase() ?? "";
    const authorLogin = openPull?.user?.login?.trim().toLowerCase() ?? "";
    const isOwnPull = Boolean(myLogin && authorLogin && myLogin === authorLogin);

    // 插件 PR：先解决 index.txt 冲突，再 approve，最后合入。这样自动解决
    // 产生的提交不会在 approve 之后触发 “Dismiss stale approvals”。
    if (openSource === "plugin") {
      setMerging(true);
      try {
        const prepared = await preparePluginPullRequestForMerge({
          number,
          repo,
          token,
        });
        let skippedApprove = isOwnPull;
        if (!isOwnPull) {
          setApproving(true);
          let approved = false;
          try {
            await approvePullRequest(number, undefined, repo);
            approved = true;
          } catch (err) {
            if (isSelfApproveError(err)) {
              approved = true;
              skippedApprove = true;
            } else {
              toast.error(getErrorMessage(err));
            }
          } finally {
            setApproving(false);
          }
          if (!approved) return;
        }
        if (skippedApprove) {
          toast.message("当前合入本人 PR，已跳过 approve");
        }
        const result = await mergePreparedPluginPullRequest({
          number,
          repo,
          token,
          prepared,
        });
        toast.success(
          result.resolved
            ? `PR 已合入，已自动解决 index.txt 冲突（追加 ${result.appendedLines.length} 行）`
            : "PR 已合入",
          { duration: 4000 },
        );
        await loadPulls();
        navigate("/resreview", { replace: true });
      } catch (err) {
        toast.error(getErrorMessage(err));
      } finally {
        setMerging(false);
        setApproving(false);
      }
      return;
    }

    let skippedApprove = isOwnPull;
    if (!isOwnPull) {
      setApproving(true);
      let approved = false;
      try {
        await approvePullRequest(number, undefined, repo);
        approved = true;
      } catch (err) {
        // 兜底：即便未能预先识别作者身份，只要 GitHub 明确因「不能批准自己的 PR」
        // 而拒绝，也跳过批准继续合入，而不是中断整个流程。
        if (isSelfApproveError(err)) {
          approved = true;
          skippedApprove = true;
        } else {
          toast.error(getErrorMessage(err));
        }
      } finally {
        setApproving(false);
      }
      if (!approved) return;
      timelineCacheRef.current.delete(reviewPullKeyOf(openSource, number));
    }
    if (skippedApprove) {
      toast.message("当前合入本人 PR，已跳过 approve");
    }
    await merge();
  };

  const closePr = async (reason: string) => {
    if (!openNumber || closing) return;
    const number = openNumber;
    const repo = reviewRepoRef(openSource);
    setClosing(true);
    let closed = false;
    try {
      if (openSource === "plugin") {
        await createPullRequestComment(
          number,
          reason || "该插件提交已被审核成员关闭。",
          repo,
        );
      }

      await closePullRequest(number, repo);
      closed = true;
      timelineCacheRef.current.delete(reviewPullKeyOf(openSource, number));

      if (openSource === "plugin") {
        toast.success("PR 已关闭，并已记录普通评论。");
      } else {
        const commentBody = reason
          ? `[ABCC_CLOSE] ${reason}`
          : "[ABCC_CLOSE] 该 PR 已由审核成员关闭。";
        try {
          await createPullRequestComment(number, commentBody, repo);
          toast.success("PR 已关闭，并已记录 CLOSE 标签评论。");
        } catch (commentErr) {
          // PR 已经关闭，评论失败只提示；不能停留在仍可重复关闭的详情页。
          toast.error(
            `PR 已关闭，但关闭原因评论写入失败：${getErrorMessage(commentErr)}`,
          );
        }
        void notifyCc({
          subtype: "review-closed",
          prNumber: number,
          content: reason,
          senderNote: reason,
        });
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      if (closed) {
        // 关闭成功后 PR 已不在开放列表里，刷新列表并回到列表页；
        // 刷新期间保持 closing 状态，避免按钮短暂恢复可点造成重复关闭。
        await loadPulls();
        if (openNumber === number) {
          navigate("/resreview", { replace: true });
        }
      }
      setClosing(false);
    }
  };

  /** 插件 PR：提交 GitHub REQUEST_CHANGES review，不使用 ABCC 标签。 */
  const requestPluginChanges = async (body: string) => {
    if (!openNumber || openSource !== "plugin" || requestingChanges) return;
    const number = openNumber;
    const repo = reviewRepoRef("plugin");
    setRequestingChanges(true);
    try {
      await requestChangesPullRequest(number, body, repo);
      toast.success("已提交 GitHub 要求修改");
      // REQUEST_CHANGES 只新增 review 评论，不影响 PR 文件列表；只刷新时间线，
      // 避免「插件信息」与「自动检查」两个 Tab 被重置重跑。
      await refreshTimeline("plugin", number);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setRequestingChanges(false);
    }
  };

  const refusePr = async (reason: string) => {
    if (!openNumber || refusing) return;
    const number = openNumber;
    const repo = reviewRepoRef(openSource);
    setRefusing(true);
    try {
      await closePullRequest(number, repo);
      const commentBody = reason
        ? `[ABCC_REFUSE] ${reason}`
        : "[ABCC_REFUSE] 该 PR 已被审核成员拒绝。";
      await createPullRequestComment(number, commentBody, repo);
      void notifyCc({
        subtype: "review-refused",
        prNumber: number,
        content: reason,
        senderNote: reason,
      });
      toast.success("PR 已拒绝，不再显示在审核列表中。");
      await loadPulls();
      navigate("/resreview", { replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setRefusing(false);
    }
  };

  const sendNoticeForPreviews = async (
    params: {
      subtype: CcNoticeSubtype;
      prNumber: number;
      tagId?: string;
      content?: string;
      senderNote?: string;
      createMode?: boolean;
      titleOverride?: string;
      bodyOverride?: string;
      force?: boolean;
    },
    previews: PrResourcePreview[],
  ): Promise<{
    status: "sent" | "skipped" | "queued";
    payload?: CcNoticePayload;
  }> => {
    const { userIds, resourceName, resourceId } = await resolveRecipientUserIds(
      previews,
      getAstroboxToken(),
    );
    // 作者没有在 manifest 里声明绑定 AstroBox 账号，或按名称匹配不到账号，
    // 通知压根发不出去，单独返回 skipped 供调用方提示，不要和发送失败混淆。
    if (userIds.length === 0) return { status: "skipped" };
    const payload: CcNoticePayload = {
      subtype: params.subtype,
      tagId: params.tagId,
      content: params.content,
      senderNote: params.senderNote,
      prNumber: params.prNumber,
      prUrl: buildPrUrl(params.prNumber),
      resourceId: resourceId || undefined,
      resourceName: resourceName || undefined,
      deepLink: `/resreview?pr=${params.prNumber}`,
      userIds,
      title:
        params.titleOverride?.trim() ||
        (params.subtype === "review-approved"
          ? params.createMode === false
            ? `《${resourceName}》资源更新已通过审核`
            : CC_NOTICE_TITLES["review-approved"](resourceName)
          : CC_NOTICE_TITLES[params.subtype](resourceName)),
      body:
        params.bodyOverride?.trim() ||
        (params.subtype === "review-approved"
          ? `您的《${resourceName}》资源提交已通过审核并加入官方源索引，随后可于 AstroBox 刷新查看。`
          : params.content?.trim() ||
            params.senderNote?.trim() ||
            CC_NOTICE_BODIES[params.subtype]),
    };
    await sendCcNotice(payload, { force: params.force });
    // 不看 sendCcNotice 的布尔值：它把「幂等命中（已发过）」和「发送失败」都返回 false，
    // 必须读落盘记录才能区分「已送达」与「已入待补发队列」。
    const outcome = getCcNoticeOutcome({
      subtype: params.subtype,
      prNumber: params.prNumber,
      tagId: params.tagId,
    });
    return { status: outcome === "sent" ? "sent" : "queued", payload };
  };

  const notifyCc = async (params: {
    subtype: CcNoticeSubtype;
    prNumber: number;
    tagId?: string;
    content?: string;
    senderNote?: string;
    createMode?: boolean;
    titleOverride?: string;
    bodyOverride?: string;
    force?: boolean;
  }): Promise<CcNoticeSendResult> => {
    // 插件 PR 没有 ABCC 账号绑定字段，不发送 AstroBox 信箱通知。
    if (openSource === "plugin") return "skipped";
    const { status } = await sendNoticeForPreviews(params, resourcePreviews);
    if (status === "skipped") return "skipped";
    return status === "sent" ? "sent" : "failed";
  };

  const retryCcNoticeFor = async (params: {
    subtype: CcNoticeSubtype;
    tagId?: string;
    content?: string;
    senderNote?: string;
  }) => {
    if (!openNumber) return;
    const result = await notifyCc({
      subtype: params.subtype,
      prNumber: openNumber,
      tagId: params.tagId,
      content: params.content,
      senderNote: params.senderNote,
      force: true,
    });
    if (result === "sent") {
      toast.success("AstroBox 信箱通知已重新发送");
      setNoticeStatusTick((prev) => prev + 1);
      return;
    }
    if (result === "skipped") {
      toast.error("未找到收件人，请确认作者已在 manifest 中绑定 AstroBox 账号");
      return;
    }
    toast.error("重新发送失败，请稍后重试");
  };

  const retryCcNotice = async (comment: GithubIssueComment) => {
    if (openSource !== "resource") {
      toast.error("插件 PR 没有关联的 AstroBox 信箱通知");
      return;
    }
    const parsed = parseReviewCommentBody(comment.body || "");
    if (parsed.tagType === "NEEDFIX" && parsed.tagId) {
      await retryCcNoticeFor({
        subtype: "review-changes-requested",
        tagId: parsed.tagId,
        content: parsed.content,
      });
      return;
    }
    if (parsed.tagType === "CLOSE" || parsed.tagType === "REFUSE") {
      await retryCcNoticeFor({
        subtype: parsed.tagType === "CLOSE" ? "review-closed" : "review-refused",
        content: parsed.content,
        senderNote: parsed.content,
      });
      return;
    }
    toast.error("该评论没有对应的 AstroBox 信箱通知");
  };

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedKeys(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedKeys(new Set());
    setBulkCloseReason("");
  };

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 批量为每个资源 PR 加载 files + 预览，用于解析 AstroBox 收件人（与详情页同一套逻辑）。
  const loadPreviewsForBatch = async (
    number: number,
    pull: GithubPullRequest,
  ): Promise<PrResourcePreview[]> => {
    const token = getGithubReadToken() || "";
    const nextFiles = await listPullRequestFiles(
      number,
      reviewRepoRef("resource"),
    );
    return publishMode === "staging" || hasSubmissionFiles(nextFiles)
      ? loadStagingPrResourcePreviews(nextFiles, token, pull)
      : loadPrResourcePreviews(nextFiles, token);
  };

  const bulkClose = async (reason: string) => {
    if (bulkClosing) return;
    // 选中是显式动作，即便之后切换了状态筛选也要照常关闭，故基于 pulls 而非 visiblePulls。
    const targets = pulls.filter((pull) =>
      selectedKeys.has(reviewPullKey(pull)),
    );
    if (targets.length === 0) return;
    setBulkClosing(true);
    setBulkProgress({ done: 0, total: targets.length });

    const newFailures: CcNoticeFailure[] = [];
    const closeErrors: Array<{ source: ReviewSource; number: number }> = [];
    let closedCount = 0;
    let skippedCount = 0;
    let noticeErrorCount = 0;

    try {
      await runWithConcurrency(targets, 3, async (pull) => {
        const number = pull.number;
        const repo = reviewRepoRef(pull.source);
        try {
          // 关闭前复查状态：跨设备/并发场景下已被关闭的 PR 直接跳过，避免重复评论。
          const fresh = await getPullRequest(number, repo);
          if (fresh.state !== "open") {
            skippedCount += 1;
            return;
          }
          await closePullRequest(number, repo);
          if (pull.source === "plugin") {
            await createPullRequestComment(
              number,
              reason || "该插件提交已被审核成员关闭。",
              repo,
            );
            closedCount += 1;
            return;
          }
          const commentBody = reason
            ? `[ABCC_CLOSE] ${reason}`
            : "[ABCC_CLOSE] 该 PR 已由审核成员关闭。";
          await createPullRequestComment(number, commentBody, repo);
          closedCount += 1;

          // PR 已关闭成功后，通知失败不应算作「关闭失败」，单独捕获。
          try {
            const previews = await loadPreviewsForBatch(number, fresh);
            const { status, payload } = await sendNoticeForPreviews(
              {
                subtype: "review-closed",
                prNumber: number,
                content: reason,
                senderNote: reason,
              },
              previews,
            );
            // 作者未绑定账号（skipped）按通过处理；只有入待补发队列才算失败。
            if (status === "queued" && payload) {
              newFailures.push({
                subtype: "review-closed",
                prNumber: number,
                title: pull.title,
                error: "AstroBox 信箱通知发送失败，可重试补发。",
                payload,
                failedAt: new Date().toISOString(),
              });
            }
          } catch (noticeErr) {
            noticeErrorCount += 1;
            console.error("批量关闭通知发送异常", number, noticeErr);
          }
        } catch (err) {
          closeErrors.push({ source: pull.source, number });
          console.error("批量关闭 PR 失败", number, err);
        } finally {
          setBulkProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      });

      if (newFailures.length > 0) {
        addCcNoticeFailures(newFailures);
        setBatchFailures(loadCcNoticeFailures());
      }
      await loadPulls();
      exitSelectMode();

      if (closedCount > 0) {
        toast.success(
          newFailures.length > 0
            ? `已关闭 ${closedCount} 个 PR，${newFailures.length} 条通知发送失败`
            : `已关闭 ${closedCount} 个 PR`,
          { duration: 4000 },
        );
      }
      if (skippedCount > 0) {
        toast.message(`${skippedCount} 个 PR 已是关闭状态，已跳过`);
      }
      if (noticeErrorCount > 0) {
        toast.error(`${noticeErrorCount} 条通知发送异常，请检查网络或稍后重试`);
      }
      if (closeErrors.length > 0) {
        toast.error(
          `有 ${closeErrors.length} 个 PR 关闭失败：${closeErrors
            .map((item) => `${item.source === "plugin" ? "插件 " : ""}#${item.number}`)
            .join("、")}`,
        );
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBulkClosing(false);
      setBulkCloseDialogOpen(false);
      setBulkProgress({ done: 0, total: 0 });
    }
  };

  const ignoreBatchFailure = (item: CcNoticeFailure) => {
    removeCcNoticeFailure(item);
    setBatchFailures(loadCcNoticeFailures());
  };

  const ignoreAllBatchFailures = () => {
    clearCcNoticeFailures();
    setBatchFailures([]);
    setFailuresDrawerOpen(false);
  };

  const retryBatchFailure = async (item: CcNoticeFailure) => {
    const key = { subtype: item.subtype, prNumber: item.prNumber };
    setRetryingNumbers((prev) => new Set(prev).add(item.prNumber));
    try {
      // 先复查一手记录：之前是假阳性（其实已发/已被队列补发成功）的直接移出，不重发。
      const before = getCcNoticeOutcome({ ...key, tagId: item.payload.tagId });
      if (before !== "sent") {
        await sendCcNotice(item.payload, { force: true });
      }
      const after = getCcNoticeOutcome({ ...key, tagId: item.payload.tagId });
      if (after === "sent") {
        removeCcNoticeFailure(item);
        setBatchFailures(loadCcNoticeFailures());
        toast.success(`#${item.prNumber} 关闭通知已发送`);
      } else {
        toast.error(`#${item.prNumber} 通知发送失败，请稍后重试`);
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setRetryingNumbers((prev) => {
        const next = new Set(prev);
        next.delete(item.prNumber);
        return next;
      });
    }
  };

  const topbarActions = null;
  const rollbackDisabledReason = !openPull
    ? "PR 尚未加载完成。"
    : !openPull.merged_at
      ? "仅已合入的 PR 支持回退。"
      : loadingDetail
        ? "正在解析资源行。"
        : rollbackPreviews.length === 0
          ? auditResourceId
            ? `当前 PR 未包含资源 ID「${auditResourceId}」。`
            : "没有解析到可回退的资源行。"
          : "";
  const rollbackTargetLabel = auditResourceId
    ? "回退该资源"
    : rollbackPreviews.length > 1
      ? "回退全部"
      : "回退";
  const rollbackScopeLabel = auditResourceId
    ? `资源 ID ${auditResourceId}`
    : `${rollbackPreviews.length} 个资源行`;
  const showDetailError = Boolean(
    openNumber && !openPull && !loadingDetail && detailError,
  );

  useLayoutEffect(() => {
    setHeaderActions(topbarActions);
    return () => setHeaderActions(null);
  }, [setHeaderActions, stateFilter, loadingPulls, rotate, openNumber, loadingDetail, detailRotate]);

  if (!accountState.github?.token) {
    return <ReviewAccessMessage title="PR审核" text="请先在侧边栏登录 GitHub 账号。" />;
  }

  if (isInitialLoading) {
    return <PRReviewPageSkeleton />;
  }

  if (!canReview) {
    return (
      <ReviewAccessMessage
        title="PR审核"
        text={`当前 GitHub 账号没有 ${env.owner}/${env.repoName} 或 ${NG_PLUGIN_REPO_CONFIG.owner}/${NG_PLUGIN_REPO_CONFIG.name} 的 PR 管理权限。${permissionError ? ` ${permissionError}` : ""}`}
      />
    );
  }

  const handleSelectPull = (pull: ReviewPullRequest) => {
    const params = new URLSearchParams({ pr: String(pull.number) });
    if (pull.source === "plugin") params.set("source", "plugin");
    navigate(`/resreview/detail?${params.toString()}`);
  };

  const handleSelectSidebar = (pull: ReviewPullRequest) => {
    handleSelectPull(pull);
  };

  const showWorkbench = openNumber !== null;
  const showList = !showWorkbench;

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence mode="popLayout">
        {showWorkbench ? (
          <motion.div
            key="workbench"
            className="absolute inset-0 px-2 pb-3"
          >
            {showDetailError ? (
              <div className="grid h-full place-items-center px-4">
                <div className="w-full max-w-lg rounded-[14px] border border-red-400/20 bg-nav-item p-5 text-center">
                  <WarningCircle
                    size={28}
                    weight="duotone"
                    className="mx-auto text-red-300"
                  />
                  <h2 className="mt-2 text-lg font-semibold text-white">
                    无法打开 PR #{openNumber}
                  </h2>
                  <p className="mt-2 break-words text-sm text-white/60">
                    {detailError}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button variant="soft" color="gray" onClick={refreshDetail}>
                      重试
                    </Button>
                    <Button
                      variant="soft"
                      color="gray"
                      onClick={() => navigate("/resreview")}
                    >
                      <ArrowLeft size={15} />
                      返回审核列表
                    </Button>
                    {auditMode && (
                      <Button onClick={() => setAuditDialogOpen(true)}>
                        重新回查
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <LayoutGroup>
                <PullRequestReviewWorkspace
                  isDesktop={isDesktop}
                  auditMode={auditMode}
                  auditBaselineError={auditBaselineError}
                  showSwitcher={!auditMode}
                  focusResourceId={auditResourceId}
                  pulls={visiblePulls}
                  openKey={openKey}
                  openNumber={openNumber!}
                  openPull={openPull}
                  openComments={openComments}
                  openStatus={openStatus}
                  statusByKey={statusByKey}
                  files={files}
                  resourcePreviews={resourcePreviews}
                  repoFileChanges={repoFileChanges}
                  loadingDetail={loadingDetail}
                  loadingPulls={loadingPulls}
                  generalComment={generalComment}
                  replyTarget={replyTarget}
                  editingTarget={editingTarget}
                  isSwitcherCollapsed={isWorkbenchSidebarCollapsed}
                  submittingComment={submittingComment}
                  approving={approving}
                  merging={merging}
                  closing={closing}
                  refusing={refusing}
                  requestingChanges={requestingChanges}
                  rollingBack={rollingBack}
                  canRollback={!rollbackDisabledReason}
                  rollbackDisabledReason={rollbackDisabledReason}
                  rollbackTargetLabel={rollbackTargetLabel}
                  rollbackScopeLabel={rollbackScopeLabel}
                  canMerge={
                    openSource === "plugin" ||
                    reviewModeForOpenPr === "staging"
                  }
                  onToggleSwitcher={() => setIsWorkbenchSidebarCollapsed((prev) => !prev)}
                  onSelectPull={handleSelectSidebar}
                  onRefreshList={handleRefreshList}
                  onGeneralCommentChange={setGeneralComment}
                  onSubmitComment={submitComment}
                  onReply={(comment) => { setReplyTarget({ comment }); setEditingTarget(null); }}
                  onCancelReply={() => setReplyTarget(null)}
                  onCancelEdit={() => { setEditingTarget(null); setNoticeDraft(null); }}
                  onDeleteComment={deleteComment}
                  onEditComment={editComment}
                  onRetryNotice={retryCcNotice}
                  noticeStatusByCommentId={noticeStatusByCommentId}
                  checkingNoticeStatus={checkingNoticeStatus}
                  noticeDraft={noticeDraft}
                  onNoticeDraftChange={setNoticeDraft}
                  onApprove={approve}
                  onApproveAndMerge={approveAndMerge}
                  onRequestChanges={requestPluginChanges}
                  onClose={closePr}
                  onRefuse={refusePr}
                  onRollback={rollback}
                />
              </LayoutGroup>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="absolute inset-0 px-2 pb-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="flex h-full flex-col gap-2">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5 text-sm text-white/60">
                  <span>目标仓库：{env.owner}/{env.repoName}</span>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {selectMode ? (
                    <>
                      <span className="shrink-0 text-sm text-white/70">
                        已选 {selectedKeys.size} 项
                      </span>
                      <Button
                        color="red"
                        className="shrink-0"
                        disabled={selectedKeys.size === 0 || bulkClosing}
                        onClick={() => setBulkCloseDialogOpen(true)}
                      >
                        {bulkClosing ? "关闭中..." : "批量关闭"}
                      </Button>
                      <Button
                        variant="ghost"
                        color="gray"
                        className="shrink-0"
                        disabled={bulkClosing}
                        onClick={exitSelectMode}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        color="gray"
                        className="shrink-0"
                        disabled={loadingPulls}
                        onClick={handleRefreshList}
                      >
                        <motion.div
                          animate={{ rotate: loadingPulls ? 360 : 0 }}
                          transition={{
                            duration: 0.7,
                            ease: "easeInOut",
                            repeat: loadingPulls ? Infinity : 0,
                          }}
                          style={{ display: "flex" }}
                        >
                          <ArrowClockwiseIcon size={15} />
                        </motion.div>
                        刷新
                      </Button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                          <Button
                            variant="soft"
                            color="gray"
                            className="shrink-0 px-2!"
                            aria-label="更多操作"
                            title="更多操作"
                          >
                            <DotsThree size={18} weight="bold" />
                          </Button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align="end">
                          <DropdownMenu.Item
                            className="gap-2"
                            onSelect={() => setFilterDrawerOpen(true)}
                          >
                            <FunnelSimple size={15} />
                            筛选
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            className="gap-2"
                            onSelect={() => setAuditDialogOpen(true)}
                          >
                            <MagnifyingGlass size={15} />
                            提交回查
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            className="gap-2"
                            disabled={visiblePulls.length === 0}
                            onSelect={enterSelectMode}
                          >
                            <CheckSquare size={15} />
                            批量管理
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Root>
                    </>
                  )}
                </div>
                {batchFailures.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFailuresDrawerOpen(true)}
                    className="flex w-full items-center gap-2 rounded-[12px] border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-left text-sm text-amber-100 transition-colors hover:bg-amber-300/15"
                  >
                    <WarningCircle
                      size={16}
                      weight="duotone"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {batchFailures.length} 条关闭通知未成功发送 · 查看
                    </span>
                  </button>
                )}
              </div>

              <section className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3 no-scrollbar">
                  {visiblePulls.length === 0 ? (
                    <div className="py-16 text-center text-sm text-white/45">暂无 PR</div>
                  ) : (
                    <LayoutGroup>
                      <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {visiblePulls.map((pull) => {
                          const key = reviewPullKey(pull);
                          const comments = commentsByPr[key] ?? [];
                          const reviewers =
                            pull.source === "plugin"
                              ? derivePluginRequestAuthors(
                                  pluginReviewsByKey[key] ?? [],
                                  orgMembers,
                                )
                              : deriveNeedFixAuthors(comments);
                          return (
                            <PullRequestCard
                              key={key}
                              pull={pull}
                              source={pull.source}
                              status={statusByKey[key] ?? "waiting_review"}
                              comments={comments}
                              reviewers={reviewers}
                              selectable={selectMode}
                              selected={selectedKeys.has(key)}
                              onClick={() => handleSelectPull(pull)}
                              onToggleSelect={() => toggleSelect(key)}
                              onOpenReviewers={() => setReviewersKey(key)}
                            />
                          );
                        })}
                      </div>
                    </LayoutGroup>
                  )}
                </div>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ReviewFilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        stateFilter={stateFilter}
        sourceFilter={sourceFilter}
        canReviewResource={canReviewResource}
        canReviewPlugin={canReviewPlugin}
        onStateFilterChange={setStateFilter}
        onSourceFilterChange={setSourceFilter}
      />
      <ReviewersDrawer
        open={reviewersKey !== null}
        onClose={() => setReviewersKey(null)}        pull={
          reviewersKey !== null
            ? pulls.find((pull) => reviewPullKey(pull) === reviewersKey) ?? null
            : null
        }
        comments={
          reviewersKey !== null ? commentsByPr[reviewersKey] ?? [] : []
        }
        reviewers={
          reviewersKey !== null
            ? (() => {
                const pull = pulls.find(
                  (item) => reviewPullKey(item) === reviewersKey,
                );
                return pull?.source === "plugin"
                  ? derivePluginRequestAuthors(
                      pluginReviewsByKey[reviewersKey] ?? [],
                      orgMembers,
                    )
                  : undefined;
              })()
            : undefined
        }
        statLabel={
          pulls.find((pull) => reviewPullKey(pull) === reviewersKey)
            ?.source === "plugin"
            ? "changes request"
            : "needfix"
        }
      />
      <BatchNoticeFailuresDrawer
        open={failuresDrawerOpen}
        onClose={() => setFailuresDrawerOpen(false)}
        failures={batchFailures}
        retryingNumbers={retryingNumbers}
        onRetry={(item) => void retryBatchFailure(item)}
        onIgnore={ignoreBatchFailure}
        onIgnoreAll={ignoreAllBatchFailures}
      />
      <Dialog.Root
        open={bulkCloseDialogOpen}
        onOpenChange={(open) => {
          if (!bulkClosing) setBulkCloseDialogOpen(open);
        }}
      >
        <Dialog.Content className="max-w-[420px]">
          <Dialog.Title>批量关闭 {selectedKeys.size} 个 PR</Dialog.Title>
          <Dialog.Description size="2" className="text-white/60">
            将逐一关闭选中的 PR。资源 PR 以 CLOSE 标签评论记录原因并发送 AstroBox
            信箱通知；插件 PR 只记录普通评论，不发送通知。
          </Dialog.Description>
          <label className="mt-3 block text-sm text-white/70">
            关闭原因（可选）
          </label>
          <TextArea
            className="mt-1.5 min-h-[100px] resize-y border border-white/10 bg-black/20 text-sm text-white/80 outline-none placeholder:text-white/30"
            placeholder="例如：该批提交不符合资源规范，请按审核意见修改后重新打开。"
            value={bulkCloseReason}
            onChange={(e) => setBulkCloseReason(e.target.value)}
            disabled={bulkClosing}
            radius="large"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="soft"
              color="gray"
              disabled={bulkClosing}
              onClick={() => setBulkCloseDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              color="red"
              disabled={bulkClosing}
              onClick={() => void bulkClose(bulkCloseReason.trim())}
            >
              {bulkClosing
                ? `关闭中 ${bulkProgress.done}/${bulkProgress.total}`
                : "确认关闭"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <AuditLookupDialog
        open={auditDialogOpen}
        onOpenChange={setAuditDialogOpen}
        onOpenPull={openAuditPull}
      />
    </div>
  );
}
