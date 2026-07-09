import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { ReviewDetailContent } from "./ReviewDetailContent";
import type { PrResourcePreview } from "../types";
import type { ReplyTarget, EditingTarget } from "./CommentComposer";
import { useDetailHeader } from "./useDetailHeader";
import { DetailHeader } from "./DetailHeader";

interface MobileWorkbenchProps {
  openPull: GithubPullRequest | null;
  openComments: GithubIssueComment[];
  openStatus: ReturnType<typeof deriveReviewStatus>;
  files: import("~/api/github/pr-review").GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
  reviews: import("~/api/github/pr-review").GithubPullReview[];
  loadingDetail: boolean;
  generalComment: string;
  replyTarget?: ReplyTarget | null;
  editingTarget?: EditingTarget | null;
  onClose: () => void;
  onGeneralCommentChange: (value: string) => void;
  onSubmitComment: (body: string) => void;
  onReply: (comment: GithubIssueComment) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onDeleteComment: (comment: GithubIssueComment) => void;
  onEditComment: (comment: GithubIssueComment) => void;
  onMarkFixed: (id: string) => void;
  onApprove: () => void;
}

export function MobileWorkbench(props: MobileWorkbenchProps) {
  const {
    openPull,
    openComments,
    openStatus,
    files,
    resourcePreviews,
    reviews,
    loadingDetail,
    generalComment,
    replyTarget,
    editingTarget,
    onClose,
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

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden no-scrollbar"
      >
        <ReviewDetailContent
          openPull={openPull}
          openStatus={openStatus}
          openComments={openComments}
          files={files}
          resourcePreviews={resourcePreviews}
          reviews={reviews}
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
  );
}
