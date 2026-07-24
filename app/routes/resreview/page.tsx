import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Select } from "@radix-ui/themes";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import NavIconButton, { NavIconButtonGroup } from "~/components/nav-icon-button";
import { useHeaderActionsFit, useSetHeaderActions } from "~/layout/header-actions";
import { useNavVisibility } from "~/layout/nav-visibility-context";
import { useAccountState } from "~/logic/account/store";
import { useRepoEnv } from "~/config/repoEnv";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import {
  getCurrentGithubPermission,
  listOpenPullRequests,
  listPullRequestComments,
  listPullRequestFiles,
  approvePullRequest,
  createPullRequestComment,
  deletePullRequestComment,
  updatePullRequestComment,
  type GithubPullRequest,
} from "~/api/github/pr-review";
import { COMMUNITY_REPO_CONFIG } from "~/config/community";
import { PullRequestCard } from "./components/PullRequestCard";
import { PullRequestReviewWorkspace } from "./components/PullRequestReviewWorkspace";
import { loadPrResourcePreviews, getErrorMessage, extractOldCatalogEntriesFromFiles } from "./utils";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import type { CatalogEntry } from "~/logic/publish/catalog";
import { parseReviewCommentBody } from "./utils/comment";
import type { PrResourcePreview } from "./types";
import { ReviewAccessMessage, PRReviewPageSkeleton } from "./components/ReviewAccessMessage";

export default function ResourceReviewPage() {
  const accountState = useAccountState();
  const env = useRepoEnv();
  const setHeaderActions = useSetHeaderActions();
  const headerActionsFit = useHeaderActionsFit();
  const { isDesktop } = useNavVisibility();

  const [permission, setPermission] = useState("");
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [permissionError, setPermissionError] = useState("");
  const [pulls, setPulls] = useState<GithubPullRequest[]>([]);
  const [commentsByPr, setCommentsByPr] = useState<Record<number, import("~/api/github/pr-review").GithubIssueComment[]>>({});
  const [openNumber, setOpenNumber] = useState<number | null>(null);
  const [files, setFiles] = useState<import("~/api/github/pr-review").GithubPullFile[]>([]);
  const [resourcePreviews, setResourcePreviews] = useState<PrResourcePreview[]>([]);
  const [loadingPulls, setLoadingPulls] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [stateFilter, setStateFilter] = useState<import("./types").ReviewState | "all">("all");
  const [generalComment, setGeneralComment] = useState("");
  const [replyTarget, setReplyTarget] = useState<import("./components/CommentComposer").ReplyTarget | null>(null);
  const [editingTarget, setEditingTarget] = useState<import("./components/CommentComposer").EditingTarget | null>(null);
  const [rotate, setRotate] = useState(0);
  const [detailRotate, setDetailRotate] = useState(0);
  const [isWorkbenchSidebarCollapsed, setIsWorkbenchSidebarCollapsed] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [approving, setApproving] = useState(false);
  const loadDetailRef = useRef<number>(0);

  const canReview = ["admin", "maintain", "write"].includes(permission);
  const isInitialLoading = checkingPermission || (loadingPulls && pulls.length === 0);
  const openPull = pulls.find((pull) => pull.number === openNumber) || null;
  const openComments = openNumber ? commentsByPr[openNumber] ?? [] : [];
  const openStatus = deriveReviewStatus(openComments);

  const repoFileChanges = useMemo(() => {
    if (files.length === 0 || resourcePreviews.length === 0) return [];
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
  }, [files, resourcePreviews]);

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
    const callId = ++loadDetailRef.current;
    setLoadingDetail(true);
    setFiles([]);
    setResourcePreviews([]);
    try {
      const [nextComments, nextFiles] = await Promise.all([
        listPullRequestComments(number),
        listPullRequestFiles(number),
      ]);
      if (callId !== loadDetailRef.current) return;
      const nextResourcePreviews = await loadPrResourcePreviews(
        nextFiles,
        accountState.github?.token || "",
      );
      if (callId !== loadDetailRef.current) return;
      setCommentsByPr((prev) => ({ ...prev, [number]: nextComments }));
      setFiles(nextFiles);
      setResourcePreviews(nextResourcePreviews);
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
  }, [canReview, refreshTick]);

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
  }, [openNumber, accountState.github?.token]);

  const visiblePulls = useMemo(() => {
    if (stateFilter === "all") return pulls;
    return pulls.filter((pull) => {
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

  const topbarActions = (
    <>
      {openNumber ? (
        <NavIconButton
          aria-label="刷新 PR 详情"
          onClick={() => {
            setDetailRotate((prev) => prev + 360);
            void loadDetail(openNumber);
          }}
          disabled={loadingDetail}
        >
          <motion.div
            animate={{ rotate: detailRotate }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            style={{ display: "flex" }}
          >
            <ArrowClockwiseIcon />
          </motion.div>
        </NavIconButton>
      ) : (
        <>
          <NavIconButtonGroup>
            <Select.Root
              value={stateFilter}
              onValueChange={(val) => setStateFilter(val as import("./types").ReviewState | "all")}
            >
              <Select.Trigger className="flex h-full! min-w-[135px] flex-row items-center gap-2 rounded-full border-none! bg-transparent! px-3 py-1 shadow-none!" />
              <Select.Content position="popper" className="rounded-2xl">
                <Select.Item value="all" className="rounded-lg">全部状态</Select.Item>
                <Select.Item value="waiting_review" className="rounded-lg">等待审核</Select.Item>
                <Select.Item value="changes_requested" className="rounded-lg">需要修改</Select.Item>
                <Select.Item value="fixed_waiting" className="rounded-lg">已修复待复核</Select.Item>
              </Select.Content>
            </Select.Root>
          </NavIconButtonGroup>
          <NavIconButton
            aria-label="刷新 PR 列表"
            onClick={() => {
              setRotate((prev) => prev + 360);
              setRefreshTick((prev) => prev + 1);
            }}
            disabled={loadingPulls}
          >
            <motion.div
              animate={{ rotate }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
              style={{ display: "flex" }}
            >
              <ArrowClockwiseIcon />
            </motion.div>
          </NavIconButton>
        </>
      )}
    </>
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
        text={`当前 GitHub 账号没有 ${COMMUNITY_REPO_CONFIG.owner}/${COMMUNITY_REPO_CONFIG.name} 的 PR 管理权限。${permissionError ? ` ${permissionError}` : ""}`}
      />
    );
  }

  const handleSelectPull = (pull: GithubPullRequest) => {
    setOpenNumber(pull.number);
    setIsWorkbenchSidebarCollapsed(false);
  };

  const handleSelectSidebar = (pull: GithubPullRequest) => {
    setOpenNumber(pull.number);
  };

  const handleCloseWorkbench = () => {
    setOpenNumber(null);
    setIsWorkbenchSidebarCollapsed(false);
  };

  const showWorkbench = openNumber !== null;
  const showList = !showWorkbench;

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence mode="popLayout">
        {showWorkbench ? (
          <motion.div
            key="workbench"
            className="absolute inset-0 px-2 pt-5 pb-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
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
                onToggleSwitcher={() => setIsWorkbenchSidebarCollapsed((prev) => !prev)}
                onSelectPull={handleSelectSidebar}
                onClose={handleCloseWorkbench}
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
              />
            </LayoutGroup>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="absolute inset-0 px-2 pt-5 pb-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="mx-auto flex h-full max-w-6xl flex-col gap-4">
              <div className="flex flex-col gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white/60">
                    {env.owner}/{env.repoName}
                  </p>
                </div>
                {!headerActionsFit && (
                  <div className="flex flex-row items-center justify-end gap-2">
                    {topbarActions}
                  </div>
                )}
              </div>

              <section className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3 no-scrollbar">
                  {visiblePulls.length === 0 ? (
                    <div className="py-16 text-center text-sm text-white/45">暂无 open PR</div>
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
