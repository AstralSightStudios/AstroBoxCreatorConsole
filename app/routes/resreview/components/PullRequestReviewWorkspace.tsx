import type { GithubIssueComment, GithubPullRequest } from "~/api/github/pr-review";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import type { PrResourcePreview, RepoFileChangeInfo } from "../types";
import type { ReplyTarget, EditingTarget } from "./CommentComposer";
import { PullRequestReviewView } from "./PullRequestReviewView";
import { PullRequestSwitcher } from "./PullRequestSwitcher";

interface PullRequestReviewWorkspaceProps {
  isDesktop: boolean;
  pulls: GithubPullRequest[];
  openNumber: number;
  openPull: GithubPullRequest | null;
  openComments: GithubIssueComment[];
  openStatus: ReturnType<typeof deriveReviewStatus>;
  files: import("~/api/github/pr-review").GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
  repoFileChanges: RepoFileChangeInfo[];
  loadingDetail: boolean;
  loadingPulls: boolean;
  commentsByPr: Record<number, GithubIssueComment[]>;
  generalComment: string;
  replyTarget?: ReplyTarget | null;
  editingTarget?: EditingTarget | null;
  isSwitcherCollapsed: boolean;
  submittingComment: boolean;
  approving: boolean;
  merging: boolean;
  closing: boolean;
  canMerge: boolean;
  onToggleSwitcher: () => void;
  onSelectPull: (pull: GithubPullRequest) => void;
  onRefreshList: () => void;
  onGeneralCommentChange: (value: string) => void;
  onSubmitComment: (body: string) => void;
  onReply: (comment: GithubIssueComment) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onDeleteComment: (comment: GithubIssueComment) => void;
  onEditComment: (comment: GithubIssueComment) => void;
  onApprove: () => void;
  onMerge: () => void;
  onClose: (reason: string) => void;
}

export function PullRequestReviewWorkspace(props: PullRequestReviewWorkspaceProps) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        {props.isDesktop && (
          <PullRequestSwitcher
            pulls={props.pulls}
            openNumber={props.openNumber}
            commentsByPr={props.commentsByPr}
            loadingPulls={props.loadingPulls}
            isCollapsed={props.isSwitcherCollapsed}
            onToggle={props.onToggleSwitcher}
            onSelect={props.onSelectPull}
            onRefresh={props.onRefreshList}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden no-scrollbar">
          <PullRequestReviewView
            openPull={props.openPull}
            openStatus={props.openStatus}
            openComments={props.openComments}
            files={props.files}
            resourcePreviews={props.resourcePreviews}
            repoFileChanges={props.repoFileChanges}
            loadingDetail={props.loadingDetail}
            generalComment={props.generalComment}
            replyTarget={props.replyTarget}
            editingTarget={props.editingTarget}
            submittingComment={props.submittingComment}
            approving={props.approving}
            merging={props.merging}
            closing={props.closing}
            canMerge={props.canMerge}
            onGeneralCommentChange={props.onGeneralCommentChange}
            onSubmitComment={props.onSubmitComment}
            onReply={props.onReply}
            onCancelReply={props.onCancelReply}
            onCancelEdit={props.onCancelEdit}
            onDeleteComment={props.onDeleteComment}
            onEditComment={props.onEditComment}
            onApprove={props.onApprove}
            onMerge={props.onMerge}
            onClose={props.onClose}
          />
        </div>
      </div>
    </div>
  );
}
