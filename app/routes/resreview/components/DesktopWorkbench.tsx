import { motion } from "framer-motion";
import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { ReviewDetailContent } from "./ReviewDetailContent";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import type { PrResourcePreview } from "../types";
import type { ReplyTarget, EditingTarget } from "./CommentComposer";
import { useDetailHeader } from "./useDetailHeader";
import { DetailHeader } from "./DetailHeader";

interface RepoFileChangeInfo {
  entryId: string;
  resourceName: string;
  isNew: boolean;
  owner: string;
  repo: string;
  commitHash: string;
  baseCommitHash?: string;
  manifest?: import("~/logic/publish/manifest-loader").ManifestV2;
}

interface DesktopWorkbenchProps {
  pulls: GithubPullRequest[];
  openNumber: number;
  openPull: GithubPullRequest | null;
  openComments: GithubIssueComment[];
  openStatus: ReturnType<typeof deriveReviewStatus>;
  files: import("~/api/github/pr-review").GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
  reviews: import("~/api/github/pr-review").GithubPullReview[];
  repoFileChanges: RepoFileChangeInfo[];
  loadingDetail: boolean;
  loadingPulls: boolean;
  commentsByPr: Record<number, GithubIssueComment[]>;
  generalComment: string;
  replyTarget?: ReplyTarget | null;
  editingTarget?: EditingTarget | null;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onSelectSidebar: (pull: GithubPullRequest) => void;
  onClose: () => void;
  onRefreshList: () => void;
  onGeneralCommentChange: (value: string) => void;
  onSubmitComment: (body: string) => void;
  onReply: (comment: import("~/api/github/pr-review").GithubIssueComment) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onDeleteComment: (comment: import("~/api/github/pr-review").GithubIssueComment) => void;
  onEditComment: (comment: import("~/api/github/pr-review").GithubIssueComment) => void;
  onMarkFixed: (id: string) => void;
  onApprove: () => void;
}

export function DesktopWorkbench(props: DesktopWorkbenchProps) {
  const {
    pulls,
    openNumber,
    openPull,
    openComments,
    openStatus,
    files,
    resourcePreviews,
    reviews,
    repoFileChanges,
    loadingDetail,
    loadingPulls,
    commentsByPr,
    generalComment,
    replyTarget,
    editingTarget,
    isSidebarCollapsed,
    onToggleSidebar,
    onSelectSidebar,
    onClose,
    onRefreshList,
    onGeneralCommentChange,
    onSubmitComment,
    onReply,
    onCancelReply,
    onCancelEdit,
    onDeleteComment,
    onEditComment,
    onMarkFixed,
    onApprove,
  } = props;

  const { scrollProgress, scrollRef, panelRef, onScroll } = useDetailHeader();

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-4">
      <DetailHeader scrollProgress={scrollProgress} openPull={openPull} onClose={onClose} />

      <div className="flex min-h-0 flex-1 gap-4">
        <WorkbenchSidebar
          pulls={pulls}
          openNumber={openNumber}
          commentsByPr={commentsByPr}
          loadingPulls={loadingPulls}
          isCollapsed={isSidebarCollapsed}
          onToggle={onToggleSidebar}
          onSelect={onSelectSidebar}
          onRefresh={onRefreshList}
        />

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden no-scrollbar"
        >
          <ReviewDetailContent
            openPull={openPull}
            openStatus={openStatus}
            openComments={openComments}
            files={files}
            resourcePreviews={resourcePreviews}
            reviews={reviews}
            repoFileChanges={repoFileChanges}
            loadingDetail={loadingDetail}
            generalComment={generalComment}
            replyTarget={replyTarget}
            onGeneralCommentChange={onGeneralCommentChange}
            onSubmitComment={onSubmitComment}
            onReply={onReply}
            onCancelReply={onCancelReply}
            editingTarget={editingTarget}
            onCancelEdit={onCancelEdit}
            onDeleteComment={onDeleteComment}
            onEditComment={onEditComment}
            onMarkFixed={onMarkFixed}
            onApprove={onApprove}
            onClose={onClose}
            overviewPanelRef={panelRef}
          />
        </div>
      </div>
    </div>
  );
}
