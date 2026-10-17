import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, Select, TextArea } from "~/components/ScaleAwareThemes";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { ArrowClockwiseIcon, CheckSquare, WarningCircle } from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router";
import { useSetHeaderActions } from "~/layout/header-actions";
import { useNavVisibility } from "~/layout/nav-visibility-context";
import { useAccountState, getAstroboxToken } from "~/logic/account/store";
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
} from "~/logic/publish/review-status";
import {
  getCurrentGithubPermission,
  hasCommunityRepoManagePermission,
  getPullRequest,
  listReviewPullRequests,
  listPullRequestTimeline,
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
} from "~/api/github/pr-review";
import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { PullRequestCard } from "./components/PullRequestCard";
import ReviewersDrawer from "./components/ReviewersDrawer";
import BatchNoticeFailuresDrawer from "./components/BatchNoticeFailuresDrawer";
import { PullRequestReviewWorkspace } from "./components/PullRequestReviewWorkspace";
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

  const [permission, setPermission] = useState("");
  const [orgMembers, setOrgMembers] = useState<Set<string>>(new Set());
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [permissionError, setPermissionError] = useState("");
  const [pulls, setPulls] = useState<GithubPullRequest[]>([]);
  const [commentsByPr, setCommentsByPr] = useState<Record<number, import("~/api/github/pr-review").GithubIssueComment[]>>({});
  const prParam = searchParams.get("pr");
  const openNumber = prParam && /^\d+$/.test(prParam) ? Number(prParam) : null;
  const [files, setFiles] = useState<import("~/api/github/pr-review").GithubPullFile[]>([]);
  const [resourcePreviews, setResourcePreviews] = useState<PrResourcePreview[]>([]);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [stateFilter, setStateFilter] = useState<import("./types").ReviewState | "all">("all");
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
  const [reviewersPrNumber, setReviewersPrNumber] = useState<number | null>(
    null,
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [approving, setApproving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [closing, setClosing] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNumbers, setSelectedNumbers] = useState<Set<number>>(new Set());
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

  const canReview = hasCommunityRepoManagePermission(permission);
  const isInitialLoading = checkingPermission || (loadingPulls && pulls.length === 0);
  const openPull = pulls.find((pull) => pull.number === openNumber) || null;
  const openComments = openNumber ? commentsByPr[openNumber] ?? [] : [];
  const openStatus = deriveReviewStatus(openComments);

  const reviewModeForOpenPr =
    publishMode === "staging" || hasSubmissionFiles(files)
      ? "staging"
      : "legacy";

  const repoFileChanges = useMemo(() => {
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
  }, [files, resourcePreviews, reviewModeForOpenPr]);

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

  useEffect(() => {
    void listOrganizationMembers(COMMUNITY_REPO_CONFIG.owner)
      .then(setOrgMembers)
      .catch(() => setOrgMembers(new Set()));
  }, []);

  const loadPulls = async () => {
    // 等待 orgMembers 加载完成，避免评论过滤失效
    if (orgMembers.size === 0) return;

    setLoadingPulls(true);
    try {
      const list = await listReviewPullRequests("open");
      const commentEntries = await runWithConcurrency(
        list,
        6,
        async (pull) => {
          try {
            return [
              pull.number,
              filterReviewTagComments(
                await listPullRequestTimeline(pull.number),
                orgMembers,
                pull.user?.login,
              ),
            ] as const;
          } catch {
            return [pull.number, []] as const;
          }
        },
      );
      const commentMap = Object.fromEntries(commentEntries);
      const commentsByNumber = commentMap as Record<
        number,
        import("~/api/github/pr-review").GithubIssueComment[]
      >;
      const refusedNumbers = new Set(
        list
          .filter((pull) =>
            (commentsByNumber[pull.number] ?? []).some((comment) =>
              /^\s*\[ABCC_REFUSE\]/i.test(comment.body || ""),
            ),
          )
          .map((pull) => pull.number),
      );
      setPulls(list.filter((pull) => !refusedNumbers.has(pull.number)));
      setCommentsByPr(commentsByNumber);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoadingPulls(false);
    }
  };

  const handleRefreshList = () => {
    setRotate((prev) => prev + 360);
    setRefreshTick((prev) => prev + 1);
  };

  const loadDetail = async (number: number) => {
    const callId = ++loadDetailRef.current;
    setLoadingDetail(true);
    setFiles([]);
    setResourcePreviews([]);
    try {
      const detailPull =
        openPull ??
        (await getPullRequest(number).catch(() => null));
      if (callId !== loadDetailRef.current) return;
      const [nextComments, nextFiles] = await Promise.all([
        listPullRequestTimeline(number).then((comments) =>
          filterReviewTagComments(comments, orgMembers, detailPull?.user?.login),
        ),
        listPullRequestFiles(number),
      ]);
      if (callId !== loadDetailRef.current) return;
      const nextResourcePreviews =
        detailPull &&
        (publishMode === "staging" || hasSubmissionFiles(nextFiles))
          ? await loadStagingPrResourcePreviews(
              nextFiles,
              accountState.github?.token || "",
              detailPull,
            )
          : await loadPrResourcePreviews(
              nextFiles,
              accountState.github?.token || "",
            );
      if (callId !== loadDetailRef.current) return;
      setCommentsByPr((prev) => ({ ...prev, [number]: nextComments }));
      setFiles(nextFiles);
      setResourcePreviews(nextResourcePreviews);
      const refuseComment = nextComments.find((comment) =>
        /^\s*\[ABCC_REFUSE\]/i.test(comment.body || ""),
      );
      if (refuseComment) {
        const fresh = await getPullRequest(number);
        if (fresh.state === "open") {
          await closePullRequest(number);
          toast.success("检测到 REFUSE 标签，PR 已关闭并拒绝。");
          await loadPulls();
          navigate("/resreview", { replace: true });
        }
      } else {
        // 同一 PR 可能同时存在 CLOSE 与 REOPEN 评论（例如关闭后又被创作者重开），
        // 只以最新一条标签为准，避免 CLOSE/REOPEN 互相触发形成循环。
        const latestAction = resolveLatestTagAction(nextComments);
        if (latestAction) {
          const fresh = await getPullRequest(number);
          if (latestAction === "reopen") {
            if (fresh.state === "closed" && !fresh.merged_at) {
              await reopenPullRequest(number);
              toast.success("检测到 REOPEN 标签，PR 已重新打开。");
              await loadPulls();
            }
          } else if (fresh.state === "open") {
            await closePullRequest(number);
            toast.success("检测到 CLOSE 标签，PR 已关闭。");
            await loadPulls();
          }
        }
      }
    } catch (err) {
      if (callId === loadDetailRef.current) {
        toast.error(getErrorMessage(err));
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
    if (!canReview) return;
    void loadPulls();
  }, [canReview, refreshTick, orgMembers]);

  useEffect(() => {
    setGeneralComment("");
    setReplyTarget(null);
    setEditingTarget(null);
    setNoticeDraft(null);
    if (openNumber) {
      // 等待 orgMembers 加载完成，避免评论过滤失效
      if (orgMembers.size === 0) {
        const waitForOrgMembers = setInterval(() => {
          if (orgMembers.size > 0) {
            clearInterval(waitForOrgMembers);
            void loadDetail(openNumber);
          }
        }, 100);
        setTimeout(() => clearInterval(waitForOrgMembers), 5000);
      } else {
        void loadDetail(openNumber);
      }
    } else {
      loadDetailRef.current += 1;
      setFiles([]);
      setResourcePreviews([]);
      setLoadingDetail(false);
    }
  }, [openNumber, openPull, accountState.github?.token, publishMode, orgMembers]);

  // 检测当前 PR 的审核通知（NEEDFIX / 关闭 / 拒绝）是否送达 AstroBox 信箱，
  // 结果按评论回填：送达状态与重发入口都挂在对应评论上，PR 概览不再单独展示。
  useEffect(() => {
    if (!openNumber) {
      setNoticeStatusByCommentId({});
      return;
    }
    const comments = commentsByPr[openNumber] ?? [];
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
    commentsByPr,
    resourcePreviews,
    accountState.astrobox?.token,
    noticeStatusTick,
  ]);

  const visiblePulls = useMemo(() => {
    let list = pulls;
    if (stateFilter === "all") return list;
    return list.filter((pull) => {
      const status = deriveReviewStatus(commentsByPr[pull.number] ?? []);
      return status.state === stateFilter;
    });
  }, [commentsByPr, pulls, stateFilter]);

  const refreshDetail = () => {
    if (!openNumber) return;
    setDetailRotate((prev) => prev + 360);
    void loadDetail(openNumber);
  };

  const deleteComment = async (comment: import("~/api/github/pr-review").GithubIssueComment) => {
    if (!openNumber || !comment.id) return;
    try {
      if (comment.pull_review_id) {
        await deletePullRequestReview(openNumber, comment.pull_review_id);
      } else {
        await deletePullRequestComment(comment.id);
      }
      await loadDetail(openNumber);
      toast.success("评论已删除");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const editComment = (comment: import("~/api/github/pr-review").GithubIssueComment) => {
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
    const isNewNeedFix =
      !editingTarget && /^\s*\[ABCC_NEEDFIX/i.test(body.trim());
    setSubmittingComment(true);
    try {
      if (editingTarget) {
        if (editingTarget.comment.pull_review_id) {
          await updatePullRequestReview(
            number,
            editingTarget.comment.pull_review_id,
            body,
          );
        } else {
          await updatePullRequestComment(editingTarget.comment.id, body);
        }
      } else if (isNewNeedFix) {
        await requestChangesPullRequest(number, body);
      } else {
        await createPullRequestComment(number, body);
      }
      setGeneralComment("");
      setReplyTarget(null);
      setEditingTarget(null);
      await loadDetail(number);
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
    setApproving(true);
    try {
      await approvePullRequest(number);
      toast.success("已提交 GitHub approve", { duration: 4000 });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setApproving(false);
    }
  };

  const merge = async () => {
    if (!openNumber || merging) return;
    const number = openNumber;
    setMerging(true);
    try {
      await mergePullRequest(number);
      // 产品只有 create / edit 两种模式（无 update）：
      // staging 提交协议 request.json 直接带 mode；legacy 退回用目录旧条目启发式。
      const protocolModes = resourcePreviews
        .map((preview) => preview.request?.mode)
        .filter(
          (mode): mode is "create" | "edit" =>
            mode === "create" || mode === "edit",
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

  // 批准与合入合并为单一步骤：先提交 GitHub Approve，成功后再执行合入。
  // GitHub 不允许批准自己的 PR（返回 422），此类情况跳过批准直接合入。
  const approveAndMerge = async () => {
    if (!openNumber || approving || merging) return;
    const number = openNumber;
    const myLogin = accountState.github?.username?.trim().toLowerCase() ?? "";
    const authorLogin = openPull?.user?.login?.trim().toLowerCase() ?? "";
    const isOwnPull = Boolean(myLogin && authorLogin && myLogin === authorLogin);
    let skippedApprove = isOwnPull;
    if (!isOwnPull) {
      setApproving(true);
      let approved = false;
      try {
        await approvePullRequest(number);
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
    }
    if (skippedApprove) {
      toast.message("当前合入本人 PR，已跳过 approve");
    }
    await merge();
  };

  const closePr = async (reason: string) => {
    if (!openNumber || closing) return;
    const number = openNumber;
    setClosing(true);
    try {
      await closePullRequest(number);
      const commentBody = reason
        ? `[ABCC_CLOSE] ${reason}`
        : "[ABCC_CLOSE] 该 PR 已由审核成员关闭。";
      await createPullRequestComment(number, commentBody);
      void notifyCc({
        subtype: "review-closed",
        prNumber: number,
        content: reason,
        senderNote: reason,
      });
      toast.success("PR 已关闭，并已记录 CLOSE 标签评论。");
      await loadPulls();
      await loadDetail(number);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setClosing(false);
    }
  };

  const refusePr = async (reason: string) => {
    if (!openNumber || refusing) return;
    const number = openNumber;
    setRefusing(true);
    try {
      await closePullRequest(number);
      const commentBody = reason
        ? `[ABCC_REFUSE] ${reason}`
        : "[ABCC_REFUSE] 该 PR 已被审核成员拒绝。";
      await createPullRequestComment(number, commentBody);
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
    setSelectedNumbers(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedNumbers(new Set());
    setBulkCloseReason("");
  };

  const toggleSelect = (number: number) => {
    setSelectedNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  // 批量为每个 PR 加载 files + 预览，用于解析 AstroBox 收件人（与详情页同一套逻辑）。
  const loadPreviewsForBatch = async (
    number: number,
    pull: GithubPullRequest,
  ): Promise<PrResourcePreview[]> => {
    const token = accountState.github?.token || "";
    const nextFiles = await listPullRequestFiles(number);
    return publishMode === "staging" || hasSubmissionFiles(nextFiles)
      ? loadStagingPrResourcePreviews(nextFiles, token, pull)
      : loadPrResourcePreviews(nextFiles, token);
  };

  const bulkClose = async (reason: string) => {
    if (bulkClosing) return;
    // 选中是显式动作，即便之后切换了状态筛选也要照常关闭，故基于 pulls 而非 visiblePulls。
    const targets = pulls.filter((pull) => selectedNumbers.has(pull.number));
    if (targets.length === 0) return;
    setBulkClosing(true);
    setBulkProgress({ done: 0, total: targets.length });

    const newFailures: CcNoticeFailure[] = [];
    const closeErrors: Array<{ number: number }> = [];
    let closedCount = 0;
    let skippedCount = 0;
    let noticeErrorCount = 0;

    try {
      await runWithConcurrency(targets, 3, async (pull) => {
        const number = pull.number;
        try {
          // 关闭前复查状态：跨设备/并发场景下已被关闭的 PR 直接跳过，避免重复评论。
          const fresh = await getPullRequest(number);
          if (fresh.state !== "open") {
            skippedCount += 1;
            return;
          }
          await closePullRequest(number);
          const commentBody = reason
            ? `[ABCC_CLOSE] ${reason}`
            : "[ABCC_CLOSE] 该 PR 已由审核成员关闭。";
          await createPullRequestComment(number, commentBody);
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
          closeErrors.push({ number });
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
            .map((item) => `#${item.number}`)
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
        text={`当前 GitHub 账号没有 ${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name} 的 PR 管理权限。${permissionError ? ` ${permissionError}` : ""}`}
      />
    );
  }

  const handleSelectPull = (pull: GithubPullRequest) => {
    navigate(`/resreview/detail?pr=${pull.number}`);
  };

  const handleSelectSidebar = (pull: GithubPullRequest) => {
    navigate(`/resreview/detail?pr=${pull.number}`);
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
            <LayoutGroup>
              <PullRequestReviewWorkspace
                isDesktop={isDesktop}
                pulls={visiblePulls}
                openNumber={openNumber!}
                openPull={openPull}
                openComments={openComments}
                openStatus={openStatus}
                files={files}
                resourcePreviews={resourcePreviews}
                repoFileChanges={repoFileChanges}
                loadingDetail={loadingDetail}
                loadingPulls={loadingPulls}
                commentsByPr={commentsByPr}
                generalComment={generalComment}
                replyTarget={replyTarget}
                editingTarget={editingTarget}
                isSwitcherCollapsed={isWorkbenchSidebarCollapsed}
                submittingComment={submittingComment}
                approving={approving}
                merging={merging}
                closing={closing}
                refusing={refusing}
                canMerge={reviewModeForOpenPr === "staging"}
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
                onClose={closePr}
                onRefuse={refusePr}
              />
            </LayoutGroup>
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
                <p className="text-sm text-white/60">
                  {env.owner}/{env.repoName}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                    <div className="min-w-0 flex-1">
                    <Select.Root
                      value={stateFilter}
                      onValueChange={(val) => setStateFilter(val as import("./types").ReviewState | "all")}
                    >
                      <Select.Trigger radius="large" className="w-full" />
                      <Select.Content position="popper">
                        <Select.Item value="all">全部状态</Select.Item>
                        <Select.Item value="waiting_review">等待审核</Select.Item>
                        <Select.Item value="changes_requested">需要修改</Select.Item>
                        <Select.Item value="fixed_waiting">已修复待复核</Select.Item>
                      </Select.Content>
                    </Select.Root>
                    </div>
                  </div>
                  {selectMode ? (
                    <>
                      <span className="shrink-0 text-sm text-white/70">
                        已选 {selectedNumbers.size} 项
                      </span>
                      <Button
                        color="red"
                        className="shrink-0"
                        disabled={selectedNumbers.size === 0 || bulkClosing}
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
                      <Button
                        variant="soft"
                        color="gray"
                        className="shrink-0"
                        disabled={visiblePulls.length === 0}
                        onClick={enterSelectMode}
                      >
                        <CheckSquare size={15} />
                        批量管理
                      </Button>
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
                        {visiblePulls.map((pull) => (
                          <PullRequestCard
                            key={pull.number}
                            pull={pull}
                            comments={commentsByPr[pull.number] ?? []}
                            reviewers={deriveNeedFixAuthors(
                              commentsByPr[pull.number] ?? [],
                            )}
                            selectable={selectMode}
                            selected={selectedNumbers.has(pull.number)}
                            onClick={() => handleSelectPull(pull)}
                            onToggleSelect={() => toggleSelect(pull.number)}
                            onOpenReviewers={() =>
                              setReviewersPrNumber(pull.number)
                            }
                          />
                        ))}
                      </div>
                    </LayoutGroup>
                  )}
                </div>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ReviewersDrawer
        open={reviewersPrNumber !== null}
        onClose={() => setReviewersPrNumber(null)}
        pull={
          reviewersPrNumber !== null
            ? pulls.find((pull) => pull.number === reviewersPrNumber) ?? null
            : null
        }
        comments={
          reviewersPrNumber !== null
            ? commentsByPr[reviewersPrNumber] ?? []
            : []
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
          <Dialog.Title>批量关闭 {selectedNumbers.size} 个 PR</Dialog.Title>
          <Dialog.Description size="2" className="text-white/60">
            将逐一关闭选中的 PR，并以 CLOSE 标签评论记录同一关闭原因；发送给创作者的
            AstroBox 信箱通知内容也保持一致。作者未绑定账号的 PR 不会收到通知。
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
    </div>
  );
}
