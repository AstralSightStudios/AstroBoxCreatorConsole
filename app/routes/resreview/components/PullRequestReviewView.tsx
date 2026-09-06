import { Tabs } from "@radix-ui/themes";
import { useState, useCallback } from "react";
import { Chats, GitDiff, Info, SealCheck } from "@phosphor-icons/react";
import type { GithubIssueComment, GithubPullRequest, GithubPullFile } from "~/api/github/pr-review";
import { useAccountState } from "~/logic/account/store";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { FileEntry } from "./FileEntry";
import { PullRequestSummaryCard } from "./PullRequestSummaryCard";
import { ResourceDetailTab } from "./ResourceDetailTab";
import { RuleCheckPanel } from "./RuleCheckPanel";
import { CommentTimeline } from "./CommentTimeline";
import { CommentComposer, type ReplyTarget, type EditingTarget, type NoticeDraft } from "./CommentComposer";
import { RepoFileChanges } from "./RepoFileChanges";
import { CatalogRowChanges } from "./CatalogRowChanges";
import { LoadingIndicator } from "./LoadingIndicator";
import type { PrResourcePreview, RepoFileChangeInfo } from "../types";

export interface PullRequestReviewViewProps {
  openPull: GithubPullRequest | null;
  openStatus: ReturnType<typeof deriveReviewStatus>;
  openComments: GithubIssueComment[];
  files: GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
  repoFileChanges: RepoFileChangeInfo[];
  loadingDetail: boolean;
  generalComment: string;
  replyTarget?: ReplyTarget | null;
  editingTarget?: EditingTarget | null;
  noticeDraft?: NoticeDraft | null;
  onNoticeDraftChange?: (draft: NoticeDraft) => void;
  onGeneralCommentChange: (value: string) => void;
  onSubmitComment: (body: string) => void;
  onReply: (comment: GithubIssueComment) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onDeleteComment: (comment: GithubIssueComment) => void;
  onEditComment: (comment: GithubIssueComment) => void;
  submittingComment: boolean;
  approving: boolean;
  merging: boolean;
  closing: boolean;
  refusing: boolean;
  canMerge: boolean;
  onApprove: () => void;
  onMerge: () => void;
  onClose: (reason: string) => void;
  onRefuse: (reason: string) => void;
  summaryCardRef?: React.RefObject<HTMLDivElement | null>;
}

export function PullRequestReviewView(props: PullRequestReviewViewProps) {
  const {
    openPull,
    openStatus,
    openComments,
    files,
    resourcePreviews,
    repoFileChanges,
    loadingDetail,
    generalComment,
    replyTarget,
    editingTarget,
    noticeDraft,
    onNoticeDraftChange,
    onGeneralCommentChange,
    onSubmitComment,
    onReply,
    onCancelReply,
    onCancelEdit,
    onDeleteComment,
    onEditComment,
    submittingComment,
    approving,
    merging,
    closing,
    refusing,
    canMerge,
    onApprove,
    onMerge,
    onClose,
    onRefuse,
    summaryCardRef,
  } = props;

  const accountState = useAccountState();
  const [tabValue, setTabValue] = useState("resources");

  const handleFileComment = useCallback((filePath: string) => {
    onGeneralCommentChange(`> 文件: \`${filePath}\`\n\n`);
    setTabValue("comments");
  }, [onGeneralCommentChange]);

  const setRef = (el: HTMLDivElement | null) => {
    if (summaryCardRef) {
      summaryCardRef.current = el;
    }
  };

  return (
    <>
      <div ref={setRef}>
        <PullRequestSummaryCard
          openPull={openPull}
          openStatus={openStatus}
          onApprove={onApprove}
          approving={approving}
          merging={merging}
          closing={closing}
          refusing={refusing}
          canMerge={canMerge}
          onMerge={onMerge}
          onClose={onClose}
          onRefuse={onRefuse}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs.Root value={tabValue} onValueChange={setTabValue} className="min-w-0">
            <Tabs.List className="flex min-w-0 gap-0 overflow-x-auto border-b border-white/10 no-scrollbar">
              <Tabs.Trigger
                value="resources"
                className="shrink-0 px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
              >
                <Info size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: 'text-bottom' }} />
                资源信息
              </Tabs.Trigger>
              <Tabs.Trigger
                value="checks"
                className="shrink-0 px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
              >
                <SealCheck size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: 'text-bottom' }} />
                自动检查
              </Tabs.Trigger>
              <Tabs.Trigger
                value="files"
                className="shrink-0 px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
              >
                <GitDiff size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: 'text-bottom' }} />
                改动文件
              </Tabs.Trigger>
              <Tabs.Trigger
                value="comments"
                className="shrink-0 px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
              >
                <Chats size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: 'text-bottom' }} />
                评论
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="resources" className="pt-3! outline-none!">
              {loadingDetail && resourcePreviews.length === 0 ? (
                <LoadingIndicator text="正在解析资源信息" />
              ) : (
                <ResourceDetailTab resources={resourcePreviews} />
              )}
            </Tabs.Content>

            <Tabs.Content value="checks" className="pt-3! outline-none!">
              {loadingDetail && resourcePreviews.length === 0 ? (
                <LoadingIndicator text="正在解析资源信息" />
              ) : (
                <RuleCheckPanel resources={resourcePreviews} prFiles={files} />
              )}
            </Tabs.Content>

            <Tabs.Content value="files" className="pt-3! outline-none!">
              {loadingDetail ? (
                <LoadingIndicator />
              ) : (
                <div className="flex min-w-0 flex-col gap-2">
                  {files.map((file) => (
                    <FileEntry key={file.filename} file={file} onComment={handleFileComment} />
                  ))}
                  {files.length === 0 && (
                    <p className="text-sm text-white/45">暂无文件信息</p>
                  )}
                </div>
              )}
              {resourcePreviews.some((r) => r.request) && (
                <div className="mt-6 flex flex-col gap-3">
                  <CatalogRowChanges resources={resourcePreviews} onFileComment={handleFileComment} />
                </div>
              )}
              {repoFileChanges.length > 0 && (
                <div className="mt-6 flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-white">创作者资源发布仓库文件修改</h3>
                  <RepoFileChangesTab repoFileChanges={repoFileChanges} onFileComment={handleFileComment} />
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="comments" className="pt-3! outline-none!">
              <div className="flex flex-col gap-4">
                <CommentComposer
                  avatarUrl={accountState.github?.avatar}
                  username={accountState.github?.username}
                  value={generalComment}
                  onChange={onGeneralCommentChange}
                  onSubmit={onSubmitComment}
                  submitting={submittingComment}
                  replyTarget={replyTarget}
                  onCancelReply={onCancelReply}
                  editingTarget={editingTarget}
                  onCancelEdit={onCancelEdit}
                  noticeDraft={noticeDraft}
                  onNoticeDraftChange={onNoticeDraftChange}
                />
                {loadingDetail ? (
                  <LoadingIndicator className="py-6" />
                ) : (
                  <CommentTimeline
                    comments={openComments}
                    currentUsername={accountState.github?.username}
                    onReply={onReply}
                    onEdit={onEditComment}
                    onDelete={onDeleteComment}
                  />
                )}
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>

      </div>
    </>
  );
}

function RepoFileChangesTab({ repoFileChanges, onFileComment }: { repoFileChanges: RepoFileChangeInfo[]; onFileComment?: (path: string) => void }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const safeActiveIdx = Math.min(activeIdx, Math.max(0, repoFileChanges.length - 1));
  const change = repoFileChanges[safeActiveIdx];

  if (!change) return null;

  if (repoFileChanges.length === 1) {
    return (
      <RepoFileChanges
        owner={change.owner}
        repo={change.repo}
        commitHash={change.commitHash}
        baseCommitHash={change.baseCommitHash}
        manifest={change.manifest}
        isNew={change.isNew}
        onFileComment={onFileComment}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {repoFileChanges.map((r, i) => (
          <button
            key={r.entryId}
            onClick={() => setActiveIdx(i)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              i === safeActiveIdx
                ? "bg-white/15 text-white"
                : "bg-white/[0.04] text-white/55 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            {r.resourceName}
            <span className={`ml-1.5 text-xs ${r.isNew ? "text-emerald-300" : "text-amber-300"}`}>
              {r.isNew ? "（初次提交）" : "（更新）"}
            </span>
          </button>
        ))}
      </div>
      <RepoFileChanges
        key={change.entryId}
        owner={change.owner}
        repo={change.repo}
        commitHash={change.commitHash}
        baseCommitHash={change.baseCommitHash}
        manifest={change.manifest}
        isNew={change.isNew}
        onFileComment={onFileComment}
      />
    </div>
  );
}
