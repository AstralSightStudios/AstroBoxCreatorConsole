import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { ReviewDetailContent } from "./ReviewDetailContent";
import type { PrResourcePreview } from "../types";
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
  needFixMessage: string;
  generalComment: string;
  onClose: () => void;
  onNeedFixChange: (value: string) => void;
  onGeneralCommentChange: (value: string) => void;
  onAddNeedFix: () => void;
  onAddGeneralComment: () => void;
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
    needFixMessage,
    generalComment,
    onClose,
    onNeedFixChange,
    onGeneralCommentChange,
    onAddNeedFix,
    onAddGeneralComment,
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
          needFixMessage={needFixMessage}
          generalComment={generalComment}
          onNeedFixChange={onNeedFixChange}
          onGeneralCommentChange={onGeneralCommentChange}
          onAddNeedFix={onAddNeedFix}
          onAddGeneralComment={onAddGeneralComment}
          onMarkFixed={onMarkFixed}
          onApprove={onApprove}
          onClose={onClose}
          overviewPanelRef={panelRef}
        />
      </div>
    </div>
  );
}
