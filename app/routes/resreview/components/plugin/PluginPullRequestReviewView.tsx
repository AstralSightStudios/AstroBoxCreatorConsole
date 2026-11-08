import { useCallback, useState } from "react";
import { Tabs } from "@radix-ui/themes";
import { Chats, GitDiff, Info, SealCheck } from "@phosphor-icons/react";
import type {
  GithubIssueComment,
  GithubPullFile,
  GithubPullRequest,
} from "~/api/github/pr-review";
import { useAccountState } from "~/logic/account/store";
import type { ReviewStatusResult } from "~/logic/publish/review-status";
import { PullRequestSummaryCard } from "../PullRequestSummaryCard";
import { FileEntry } from "../FileEntry";
import { CommentComposer, type EditingTarget, type ReplyTarget } from "../CommentComposer";
import { CommentTimeline } from "../CommentTimeline";
import { LoadingIndicator } from "../LoadingIndicator";
import { PluginInfoTab } from "./PluginInfoTab";
import { PluginRuleCheckPanel } from "./PluginRuleCheckPanel";
import { usePluginPullPreview } from "./usePluginPullPreview";

interface PluginPullRequestReviewViewProps {
  openPull: GithubPullRequest | null;
  openStatus: ReviewStatusResult;
  openComments: GithubIssueComment[];
  files: GithubPullFile[];
  loadingDetail: boolean;
  generalComment: string;
  replyTarget?: ReplyTarget | null;
  editingTarget?: EditingTarget | null;
  submittingComment: boolean;
  approving: boolean;
  merging: boolean;
  closing: boolean;
  requestingChanges: boolean;
  onGeneralCommentChange: (value: string) => void;
  onSubmitComment: (body: string) => void;
  onReply: (comment: GithubIssueComment) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onDeleteComment: (comment: GithubIssueComment) => void;
  onEditComment: (comment: GithubIssueComment) => void;
  onApprove: () => void;
  onApproveAndMerge: () => void;
  onRequestChanges: (body: string) => void;
  onClose: (reason: string) => void;
}

export function PluginPullRequestReviewView(
  props: PluginPullRequestReviewViewProps,
) {
  const accountState = useAccountState();
  const preview = usePluginPullPreview({
    openPull: props.openPull,
    files: props.files,
    token: accountState.github?.token || "",
  });
  const [tabValue, setTabValue] = useState("info");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["info"]));
  const handleTabChange = useCallback((value: string) => {
    setTabValue(value);
    setVisitedTabs((previous) =>
      previous.has(value) ? previous : new Set([...previous, value]),
    );
  }, []);

  return (
    <>
      <PullRequestSummaryCard
        source="plugin"
        openPull={props.openPull}
        openStatus={props.openStatus}
        onApprove={props.onApprove}
        approving={props.approving}
        merging={props.merging}
        closing={props.closing}
        refusing={false}
        requestingChanges={props.requestingChanges}
        canMerge
        rollbackScopeLabel=""
        onApproveAndMerge={props.onApproveAndMerge}
        onRequestChanges={props.onRequestChanges}
        onClose={props.onClose}
        onRefuse={() => {}}
      />

      <div className="flex min-w-0 flex-col gap-4">
        <Tabs.Root value={tabValue} onValueChange={handleTabChange}>
          <Tabs.List className="flex gap-0 border-b border-white/10">
            <Tabs.Trigger
              value="info"
              className="px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
            >
              <Info size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: "text-bottom" }} />
              插件信息
            </Tabs.Trigger>
            <Tabs.Trigger
              value="checks"
              className="px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
            >
              <SealCheck size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: "text-bottom" }} />
              自动检查
            </Tabs.Trigger>
            <Tabs.Trigger
              value="files"
              className="px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
            >
              <GitDiff size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: "text-bottom" }} />
              改动文件
            </Tabs.Trigger>
            <Tabs.Trigger
              value="comments"
              className="px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!"
            >
              <Chats size={16} weight="duotone" className="mr-2 inline-block" style={{ verticalAlign: "text-bottom" }} />
              评论
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content
            value="info"
            forceMount={visitedTabs.has("info") ? true : undefined}
            className="pt-3! outline-none! data-[state=inactive]:hidden"
          >
            <PluginInfoTab
              groups={preview.groups}
              loading={preview.loading || (props.loadingDetail && props.files.length === 0)}
              error={preview.error}
            />
          </Tabs.Content>

          <Tabs.Content
            value="checks"
            forceMount={visitedTabs.has("checks") ? true : undefined}
            className="pt-3! outline-none! data-[state=inactive]:hidden"
          >
            <PluginRuleCheckPanel
              groups={preview.groups}
              loading={preview.loading || (props.loadingDetail && props.files.length === 0)}
              reloading={preview.reloading}
              error={preview.error}
              publishedError={preview.publishedError}
              onReload={preview.reload}
            />
          </Tabs.Content>

          <Tabs.Content
            value="files"
            forceMount={visitedTabs.has("files") ? true : undefined}
            className="pt-3! outline-none! data-[state=inactive]:hidden"
          >
            {props.loadingDetail ? (
              <LoadingIndicator />
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                {props.files.map((file) => (
                  <FileEntry key={file.filename} file={file} />
                ))}
                {props.files.length === 0 && (
                  <p className="text-sm text-white/45">暂无文件信息</p>
                )}
              </div>
            )}
          </Tabs.Content>

          <Tabs.Content
            value="comments"
            forceMount={visitedTabs.has("comments") ? true : undefined}
            className="pt-3! outline-none! data-[state=inactive]:hidden"
          >
            <div className="flex flex-col gap-4">
              <CommentComposer
                plain
                avatarUrl={accountState.github?.avatar}
                username={accountState.github?.username}
                value={props.generalComment}
                onChange={props.onGeneralCommentChange}
                onSubmit={props.onSubmitComment}
                submitting={props.submittingComment}
                replyTarget={props.replyTarget}
                onCancelReply={props.onCancelReply}
                editingTarget={props.editingTarget}
                onCancelEdit={props.onCancelEdit}
              />
              {props.loadingDetail ? (
                <LoadingIndicator className="py-6" />
              ) : (
                <CommentTimeline
                  comments={props.openComments}
                  currentUsername={accountState.github?.username}
                  onReply={props.onReply}
                  onEdit={props.onEditComment}
                  onDelete={props.onDeleteComment}
                />
              )}
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </>
  );
}
