import { Tabs } from "@radix-ui/themes";
import { useState, useCallback } from "react";
import { SealCheck } from "@phosphor-icons/react";
import type { GithubIssueComment, GithubPullRequest, GithubPullFile, GithubPullReview } from "~/api/github/pr-review";
import { useAccountState } from "~/logic/account/store";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { FileEntry } from "./FileEntry";
import { OverviewPanel } from "./OverviewPanel";
import { ResourceDetailTab } from "./ResourceDetailTab";
import { RuleCheckPanel } from "./RuleCheckPanel";
import { CommentTimeline } from "./CommentTimeline";
import { CommentComposer, type ReplyTarget, type EditingTarget } from "./CommentComposer";
import { RepoFileChanges } from "./RepoFileChanges";
import type { PrResourcePreview } from "../types";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";

export interface RepoFileChangeInfo {
  entryId: string;
  resourceName: string;
  isNew: boolean;
  owner: string;
  repo: string;
  commitHash: string;
  baseCommitHash?: string;
  manifest?: ManifestV2;
}

export interface ReviewDetailContentProps {
  openPull: GithubPullRequest | null;
  openStatus: ReturnType<typeof deriveReviewStatus>;
  openComments: GithubIssueComment[];
  files: GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
  reviews: GithubPullReview[];
  repoFileChanges: RepoFileChangeInfo[];
  loadingDetail: boolean;
  generalComment: string;
  replyTarget?: ReplyTarget | null;
  editingTarget?: EditingTarget | null;
  onGeneralCommentChange: (value: string) => void;
  onSubmitComment: (body: string) => void;
  onReply: (comment: GithubIssueComment) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onDeleteComment: (comment: GithubIssueComment) => void;
  onEditComment: (comment: GithubIssueComment) => void;
  onMarkFixed: (id: string) => void;
  onApprove: () => void;
  onClose?: () => void;
  onFileComment?: (filePath: string) => void;
  overviewPanelRef?: React.RefObject<HTMLDivElement | null>;
}

export function ReviewDetailContent(props: ReviewDetailContentProps) {
  const {
    openPull,
    openStatus,
    openComments,
    files,
    resourcePreviews,
    reviews: _reviews,
    repoFileChanges,
    loadingDetail,
    generalComment,
    replyTarget,
    editingTarget,
    onGeneralCommentChange,
    onSubmitComment,
    onReply,
    onCancelReply,
    onCancelEdit,
    onDeleteComment,
    onEditComment,
    onMarkFixed: _onMarkFixed,
    onApprove,
    onClose,
    onFileComment,
    overviewPanelRef,
  } = props;

  const accountState = useAccountState();
  const [tabValue, setTabValue] = useState("resources");

  const handleFileComment = useCallback((filePath: string) => {
    onGeneralCommentChange(`> 文件: \`${filePath}\`\n\n`);
    setTabValue("comments");
  }, [onGeneralCommentChange]);

  const setRef = (el: HTMLDivElement | null) => {
    if (overviewPanelRef) {
      overviewPanelRef.current = el;
    }
  };

  return (
    <>
      <div ref={setRef}>
        <OverviewPanel
          openPull={openPull}
          openStatus={openStatus}
          onApprove={onApprove}
          onClose={onClose}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs.Root value={tabValue} onValueChange={setTabValue}>
            <Tabs.List className="flex gap-0 border-b border-white/10">
              <Tabs.Trigger
                value="resources"
                className="px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
              >
                <svg className="octicon octicon-checklist fg-muted mr-2 d-none d-sm-inline-block" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style={{ verticalAlign: 'text-bottom' }}><path d="M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13.274 9.537v-.001l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425 4.026-3.932a.75.75 0 1 1 1.048 1.074ZM4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75Z"></path></svg>
                资源信息
              </Tabs.Trigger>
              <Tabs.Trigger
                value="checks"
                className="px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
              >
                <SealCheck size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: 'text-bottom' }} />
                自动检查
              </Tabs.Trigger>
              <Tabs.Trigger
                value="files"
                className="px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
              >
                <svg className="octicon octicon-file-diff fg-muted mr-2 d-none d-sm-inline-block" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style={{ verticalAlign: 'text-bottom' }}><path d="M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z"></path></svg>
                改动文件
              </Tabs.Trigger>
              <Tabs.Trigger
                value="comments"
                className="px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
              >
                <svg className="octicon octicon-comment-discussion fg-muted mr-2 d-none d-sm-inline-block" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style={{ verticalAlign: 'text-bottom' }}><path d="M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z"></path></svg>
                评论
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="resources" className="pt-3! outline-none!">
              {loadingDetail && resourcePreviews.length === 0 ? (
                <div className="py-8 text-center text-sm text-white/45">
                  正在解析资源信息...
                </div>
              ) : (
                <ResourceDetailTab resources={resourcePreviews} />
              )}
            </Tabs.Content>

            <Tabs.Content value="checks" className="pt-3! outline-none!">
              {loadingDetail && resourcePreviews.length === 0 ? (
                <div className="py-8 text-center text-sm text-white/45">
                  正在解析资源信息...
                </div>
              ) : (
                <RuleCheckPanel resources={resourcePreviews} prFiles={files} />
              )}
            </Tabs.Content>

            <Tabs.Content value="files" className="pt-3! outline-none!">
              {loadingDetail ? (
                <div className="py-10 text-center text-white/45">加载中...</div>
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
                  replyTarget={replyTarget}
                  onCancelReply={onCancelReply}
                  editingTarget={editingTarget}
                  onCancelEdit={onCancelEdit}
                />
                {loadingDetail ? (
                  <div className="py-6 text-center text-sm text-white/45">加载中...</div>
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
  const change = repoFileChanges[activeIdx];

  if (repoFileChanges.length === 1) {
    return (
      <RepoFileChanges
        owner={change!.owner}
        repo={change!.repo}
        commitHash={change!.commitHash}
        baseCommitHash={change!.baseCommitHash}
        manifest={change!.manifest}
        isNew={change!.isNew}
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
              i === activeIdx
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
        key={change!.entryId}
        owner={change!.owner}
        repo={change!.repo}
        commitHash={change!.commitHash}
        baseCommitHash={change!.baseCommitHash}
        manifest={change!.manifest}
        isNew={change!.isNew}
        onFileComment={onFileComment}
      />
    </div>
  );
}


