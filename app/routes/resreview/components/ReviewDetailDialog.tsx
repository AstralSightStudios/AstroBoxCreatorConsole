import { Button, Dialog } from "@radix-ui/themes";
import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { ReviewDetailContent } from "./ReviewDetailContent";
import type { PrResourcePreview } from "../types";

interface ReviewDetailDialogProps {
  open: boolean;
  onClose: () => void;
  openPull: GithubPullRequest | null;
  openStatus: ReturnType<typeof deriveReviewStatus>;
  openComments: GithubIssueComment[];
  files: import("~/api/github/pr-review").GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
  loadingDetail: boolean;
  needFixMessage: string;
  generalComment: string;
  onNeedFixChange: (value: string) => void;
  onGeneralCommentChange: (value: string) => void;
  onAddNeedFix: () => void;
  onAddGeneralComment: () => void;
  onApprove: () => void;
  onMarkFixed: (id: string) => void;
}

export function ReviewDetailDialog(props: ReviewDetailDialogProps) {
  const {
    open,
    onClose,
    openPull,
    openStatus,
    openComments,
    files,
    resourcePreviews,
    loadingDetail,
    needFixMessage,
    generalComment,
    onNeedFixChange,
    onGeneralCommentChange,
    onAddNeedFix,
    onAddGeneralComment,
    onApprove,
    onMarkFixed,
  } = props;

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Content
        maxWidth="100vw"
        className="!w-[min(96vw,1400px)] !max-w-none"
      >
        <Dialog.Title>
          {openPull ? `#${openPull.number} · ${openPull.title}` : "PR 详情"}
        </Dialog.Title>
        {openPull && (
          <Dialog.Description size="2" className="mb-2 text-white/55">
            {openPull.user?.login} · {" "}
            {openPull.head.repo?.full_name ?? openPull.head.ref} · {" "}
            {openPull.head.sha.slice(0, 7)}
          </Dialog.Description>
        )}

        <div className="grid max-h-[72vh] min-w-0 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)]">
          <ReviewDetailContent
            openPull={openPull}
            openStatus={openStatus}
            openComments={openComments}
            files={files}
            resourcePreviews={resourcePreviews}
            loadingDetail={loadingDetail}
            needFixMessage={needFixMessage}
            generalComment={generalComment}
            onNeedFixChange={onNeedFixChange}
            onGeneralCommentChange={onGeneralCommentChange}
            onAddNeedFix={onAddNeedFix}
            onAddGeneralComment={onAddGeneralComment}
            onMarkFixed={onMarkFixed}
            onApprove={onApprove}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Dialog.Close>
            <Button variant="soft">关闭</Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
