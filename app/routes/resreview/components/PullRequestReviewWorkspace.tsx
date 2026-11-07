import type { GithubIssueComment, GithubPullFile } from "~/api/github/pr-review";
import type { CcNoticeDeliveryStatus } from "~/logic/inbox/send";
import {
  deriveReviewStatus,
  type ReviewState,
} from "~/logic/publish/review-status";
import type { PrResourcePreview, RepoFileChangeInfo } from "../types";
import type { ReviewPullRequest } from "../source";
import type { ReplyTarget, EditingTarget, NoticeDraft } from "./CommentComposer";
import { PullRequestReviewView } from "./PullRequestReviewView";
import { PullRequestSwitcher } from "./PullRequestSwitcher";
import { PluginPullRequestReviewView } from "./plugin/PluginPullRequestReviewView";

interface PullRequestReviewWorkspaceProps {
  isDesktop: boolean;
  auditMode?: boolean;
  auditBaselineError?: string;
  showSwitcher?: boolean;
  focusResourceId?: string | null;
  pulls: ReviewPullRequest[];
  openKey: string;
  openNumber: number;
  openPull: ReviewPullRequest | null;
  openComments: GithubIssueComment[];
  openStatus: ReturnType<typeof deriveReviewStatus>;
  statusByKey: Record<string, ReviewState>;
  files: GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
  repoFileChanges: RepoFileChangeInfo[];
  loadingDetail: boolean;
  loadingPulls: boolean;
  generalComment: string;
  replyTarget?: ReplyTarget | null;
  editingTarget?: EditingTarget | null;
  noticeDraft?: NoticeDraft | null;
  onNoticeDraftChange?: (draft: NoticeDraft) => void;
  isSwitcherCollapsed: boolean;
  submittingComment: boolean;
  approving: boolean;
  merging: boolean;
  closing: boolean;
  refusing: boolean;
  requestingChanges: boolean;
  rollingBack: boolean;
  canRollback: boolean;
  rollbackDisabledReason?: string;
  rollbackTargetLabel: string;
  canMerge: boolean;
  onToggleSwitcher: () => void;
  onSelectPull: (pull: ReviewPullRequest) => void;
  onRefreshList: () => void;
  onGeneralCommentChange: (value: string) => void;
  onSubmitComment: (body: string) => void;
  onReply: (comment: GithubIssueComment) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onDeleteComment: (comment: GithubIssueComment) => void;
  onEditComment: (comment: GithubIssueComment) => void;
  onRetryNotice?: (comment: GithubIssueComment) => void;
  noticeStatusByCommentId?: Record<number, CcNoticeDeliveryStatus>;
  checkingNoticeStatus?: boolean;
  onApprove: () => void;
  onApproveAndMerge: () => void;
  onRequestChanges: (body: string) => void;
  onClose: (reason: string) => void;
  onRefuse: (reason: string) => void;
  onRollback: () => void;
}

export function PullRequestReviewWorkspace(props: PullRequestReviewWorkspaceProps) {
  const isPlugin = props.openPull?.source === "plugin";
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        {props.isDesktop && props.showSwitcher !== false && (
          <PullRequestSwitcher
            pulls={props.pulls}
            openKey={props.openKey}
            statusByKey={props.statusByKey}
            loadingPulls={props.loadingPulls}
            isCollapsed={props.isSwitcherCollapsed}
            onToggle={props.onToggleSwitcher}
            onSelect={props.onSelectPull}
            onRefresh={props.onRefreshList}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden no-scrollbar">
          {isPlugin ? (
            <PluginPullRequestReviewView
              key={props.openKey}
              openPull={props.openPull}
              openStatus={props.openStatus}
              openComments={props.openComments}
              files={props.files}
              loadingDetail={props.loadingDetail}
              generalComment={props.generalComment}
              replyTarget={props.replyTarget}
              editingTarget={props.editingTarget}
              submittingComment={props.submittingComment}
              approving={props.approving}
              merging={props.merging}
              closing={props.closing}
              requestingChanges={props.requestingChanges}
              onGeneralCommentChange={props.onGeneralCommentChange}
              onSubmitComment={props.onSubmitComment}
              onReply={props.onReply}
              onCancelReply={props.onCancelReply}
              onCancelEdit={props.onCancelEdit}
              onDeleteComment={props.onDeleteComment}
              onEditComment={props.onEditComment}
              onApprove={props.onApprove}
              onApproveAndMerge={props.onApproveAndMerge}
              onRequestChanges={props.onRequestChanges}
              onClose={props.onClose}
            />
          ) : (
            <PullRequestReviewView
              key={props.openKey}
              auditMode={props.auditMode}
              auditBaselineError={props.auditBaselineError}
              focusResourceId={props.focusResourceId}
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
              noticeDraft={props.noticeDraft}
              onNoticeDraftChange={props.onNoticeDraftChange}
              submittingComment={props.submittingComment}
              approving={props.approving}
              merging={props.merging}
              closing={props.closing}
              refusing={props.refusing}
              canMerge={props.canMerge}
              rollingBack={props.rollingBack}
              canRollback={props.canRollback}
              rollbackDisabledReason={props.rollbackDisabledReason}
              rollbackTargetLabel={props.rollbackTargetLabel}
              onRollback={props.onRollback}
              onGeneralCommentChange={props.onGeneralCommentChange}
              onSubmitComment={props.onSubmitComment}
              onReply={props.onReply}
              onCancelReply={props.onCancelReply}
              onCancelEdit={props.onCancelEdit}
              onDeleteComment={props.onDeleteComment}
              onEditComment={props.onEditComment}
              onRetryNotice={props.onRetryNotice}
              noticeStatusByCommentId={props.noticeStatusByCommentId}
              checkingNoticeStatus={props.checkingNoticeStatus}
              onApprove={props.onApprove}
              onApproveAndMerge={props.onApproveAndMerge}
              onClose={props.onClose}
              onRefuse={props.onRefuse}
            />
          )}
        </div>
      </div>
    </div>
  );
}
