import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Select } from "@radix-ui/themes";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router";
import { useSetHeaderActions } from "~/layout/header-actions";
import { useNavVisibility } from "~/layout/nav-visibility-context";
import { useAccountState } from "~/logic/account/store";
import { useRepoEnv } from "~/config/repoEnv";
import { usePublishMode } from "~/config/publishMode";
import {
  deriveReviewStatus,
  filterReviewTagComments,
} from "~/logic/publish/review-status";
import {
  getCurrentGithubPermission,
  listReviewPullRequests,
  listPullRequestComments,
  listPullRequestFiles,
  approvePullRequest,
  mergePullRequest,
  closePullRequest,
  reopenPullRequest,
  createPullRequestComment,
  deletePullRequestComment,
  updatePullRequestComment,
  listOrganizationMembers,
  type GithubPullRequest,
} from "~/api/github/pr-review";
import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { PullRequestCard } from "./components/PullRequestCard";
import { PullRequestReviewWorkspace } from "./components/PullRequestReviewWorkspace";
import {
  loadPrResourcePreviews,
  loadStagingPrResourcePreviews,
  getErrorMessage,
  extractOldCatalogEntriesFromFiles,
} from "./utils";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import type { CatalogEntry } from "~/logic/publish/catalog";
import { parseReviewCommentBody } from "./utils/comment";
import type { PrResourcePreview } from "./types";
import { ReviewAccessMessage, PRReviewPageSkeleton } from "./components/ReviewAccessMessage";

export default function ResourceReviewPage() {
  const accountState = useAccountState();
  const env = useRepoEnv();
  const publishMode = usePublishMode();
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
  const [prStateFilter, setPrStateFilter] = useState<"all" | "open" | "closed">("all");
  const [generalComment, setGeneralComment] = useState("");
  const [replyTarget, setReplyTarget] = useState<import("./components/CommentComposer").ReplyTarget | null>(null);
  const [editingTarget, setEditingTarget] = useState<import("./components/CommentComposer").EditingTarget | null>(null);
  const [rotate, setRotate] = useState(0);
  const [detailRotate, setDetailRotate] = useState(0);
  const [isWorkbenchSidebarCollapsed, setIsWorkbenchSidebarCollapsed] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [approving, setApproving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [closing, setClosing] = useState(false);
  const loadDetailRef = useRef<number>(0);

  const canReview = ["admin", "maintain", "write"].includes(permission);
  const isInitialLoading = checkingPermission || (loadingPulls && pulls.length === 0);
  const openPull = pulls.find((pull) => pull.number === openNumber) || null;
  const openComments = openNumber ? commentsByPr[openNumber] ?? [] : [];
  const openStatus = deriveReviewStatus(openComments);

  const repoFileChanges = useMemo(() => {
    if (files.length === 0 || resourcePreviews.length === 0) return [];
    if (publishMode === "staging") {
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
  }, [files, resourcePreviews, publishMode]);

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
    setLoadingPulls(true);
    try {
      const list = await listReviewPullRequests("all");
      setPulls(list);
      const commentEntries = await Promise.all(
        list.map(async (pull) => {
          try {
            return [
              pull.number,
              filterReviewTagComments(
                await listPullRequestComments(pull.number),
                orgMembers,
              ),
            ] as const;
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
    const callId = ++loadDetailRef.current;
    setLoadingDetail(true);
    setFiles([]);
    setResourcePreviews([]);
    try {
      const [nextComments, nextFiles] = await Promise.all([
        listPullRequestComments(number).then((comments) =>
          filterReviewTagComments(comments, orgMembers),
        ),
        listPullRequestFiles(number),
      ]);
      if (callId !== loadDetailRef.current) return;
      const nextResourcePreviews =
        publishMode === "staging" && openPull
          ? await loadStagingPrResourcePreviews(
              nextFiles,
              accountState.github?.token || "",
              openPull,
            )
          : await loadPrResourcePreviews(
              nextFiles,
              accountState.github?.token || "",
            );
      if (callId !== loadDetailRef.current) return;
      setCommentsByPr((prev) => ({ ...prev, [number]: nextComments }));
      setFiles(nextFiles);
      setResourcePreviews(nextResourcePreviews);
      if (
        orgMembers.size > 0 &&
        nextComments.some(
          (comment) =>
            /^\s*\[ABCC_CLOSE\]/i.test(comment.body || "") &&
            Boolean(
              comment.user?.login && orgMembers.has(comment.user.login),
            ),
        )
      ) {
        await closePullRequest(number);
        toast.success("检测到 CLOSE 标签，PR 已关闭。");
        await loadPulls();
      }
      const reopenComment = nextComments.find(
        (comment) =>
          /^\s*\[ABCC_REOPEN\]/i.test(comment.body || "") &&
          Boolean(
            comment.user?.login &&
              comment.user.login === openPull?.user?.login,
          ),
      );
      if (
        reopenComment &&
        openPull?.state === "closed" &&
        !openPull.merged_at
      ) {
        await reopenPullRequest(number);
        toast.success("检测到 REOPEN 标签，PR 已重新打开。");
        await loadPulls();
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
    if (canReview) void loadPulls();
  }, [canReview, refreshTick, orgMembers]);

  useEffect(() => {
    setGeneralComment("");
    setReplyTarget(null);
    setEditingTarget(null);
    if (openNumber) {
      void loadDetail(openNumber);
    } else {
      loadDetailRef.current += 1;
      setFiles([]);
      setResourcePreviews([]);
      setLoadingDetail(false);
    }
  }, [openNumber, openPull, accountState.github?.token, publishMode, orgMembers]);

  const visiblePulls = useMemo(() => {
    let list = pulls;
    if (prStateFilter === "open") {
      list = list.filter((pull) => pull.state !== "closed");
    } else if (prStateFilter === "closed") {
      list = list.filter((pull) => pull.state === "closed");
    }
    if (stateFilter === "all") return list;
    return list.filter((pull) => {
      const status = deriveReviewStatus(commentsByPr[pull.number] ?? []);
      return status.state === stateFilter;
    });
  }, [commentsByPr, pulls, stateFilter, prStateFilter]);

  const refreshDetail = () => {
    if (!openNumber) return;
    setDetailRotate((prev) => prev + 360);
    void loadDetail(openNumber);
  };

  const deleteComment = async (comment: import("~/api/github/pr-review").GithubIssueComment) => {
    if (!openNumber || !comment.id) return;
    try {
      await deletePullRequestComment(comment.id);
      await loadDetail(openNumber);
      toast.success("评论已删除");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const editComment = (comment: import("~/api/github/pr-review").GithubIssueComment) => {
    const parsed = parseReviewCommentBody(comment.body || "");
    setGeneralComment(parsed.content);
    setEditingTarget({ comment });
    setReplyTarget(null);
  };

  const submitComment = async (body: string) => {
    if (!openNumber || !body || submittingComment) return;
    const number = openNumber;
    setSubmittingComment(true);
    try {
      if (editingTarget) {
        await updatePullRequestComment(editingTarget.comment.id, body);
      } else {
        await createPullRequestComment(number, body);
      }
      setGeneralComment("");
      setReplyTarget(null);
      setEditingTarget(null);
      await loadDetail(number);
      toast.success(editingTarget ? "评论已更新" : "评论已发送");
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
      toast.success("已提交 GitHub approve");
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
      toast.success("PR 已合入，仓库 Action 将自动应用资源请求。");
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
      toast.success("PR 已关闭，并已记录 CLOSE 标签评论。");
      await loadPulls();
      await loadDetail(number);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setClosing(false);
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
    setIsWorkbenchSidebarCollapsed(false);
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
                canMerge={publishMode === "staging"}
                onToggleSwitcher={() => setIsWorkbenchSidebarCollapsed((prev) => !prev)}
                onSelectPull={handleSelectSidebar}
                onRefreshList={() => {
                  setRotate((prev) => prev + 360);
                  setRefreshTick((prev) => prev + 1);
                }}
                onGeneralCommentChange={setGeneralComment}
                onSubmitComment={submitComment}
                onReply={(comment) => { setReplyTarget({ comment }); setEditingTarget(null); }}
                onCancelReply={() => setReplyTarget(null)}
                onCancelEdit={() => setEditingTarget(null)}
                onDeleteComment={deleteComment}
                onEditComment={editComment}
                onApprove={approve}
                onMerge={merge}
                onClose={closePr}
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
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                    <div className="min-w-0 flex-1">
                      <Select.Root
                        value={prStateFilter}
                        onValueChange={(val) =>
                          setPrStateFilter(val as "all" | "open" | "closed")
                        }
                      >
                        <Select.Trigger radius="large" className="w-full" />
                        <Select.Content position="popper">
                          <Select.Item value="all">全部 PR</Select.Item>
                          <Select.Item value="open">进行中</Select.Item>
                          <Select.Item value="closed">已关闭</Select.Item>
                        </Select.Content>
                      </Select.Root>
                    </div>
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
                  <Button
                    variant="ghost"
                    color="gray"
                    className="shrink-0"
                    onClick={() => {
                      setRotate((prev) => prev + 360);
                      setRefreshTick((prev) => prev + 1);
                    }}
                  >
                    <ArrowClockwiseIcon size={15} />
                    刷新
                  </Button>
                </div>
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
                            onClick={() => handleSelectPull(pull)}
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
    </div>
  );
}
