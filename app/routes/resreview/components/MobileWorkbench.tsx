import { CaretLeft } from "@phosphor-icons/react";
import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import NavIconButton from "~/components/nav-icon-button";
import { useRepoEnv } from "~/config/repoEnv";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { ReviewDetailContent } from "./ReviewDetailContent";
import type { PrResourcePreview } from "../types";

interface MobileWorkbenchProps {
  openPull: GithubPullRequest | null;
  openComments: GithubIssueComment[];
  openStatus: ReturnType<typeof deriveReviewStatus>;
  files: import("~/api/github/pr-review").GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
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

  const env = useRepoEnv();

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-4">
      <div className="flex items-center gap-3">
        <NavIconButton onClick={onClose} className="size-10! bg-white/10 hover:bg-white/20 shrink-0">
          <CaretLeft weight="bold" size={20} />
        </NavIconButton>
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold text-white">PR审核</h1>
          <p className="text-sm text-white/60">
            {env.owner}/{env.repoName}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 no-scrollbar">
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
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
