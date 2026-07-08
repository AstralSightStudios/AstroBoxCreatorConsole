import { Button } from "@radix-ui/themes";
import type { GithubIssueComment, GithubPullRequest, GithubPullFile } from "~/api/github/pr-review";
import { useAccountState } from "~/logic/account/store";
import { deriveReviewStatus } from "~/logic/publish/review-status";
import { UserCircle } from "@phosphor-icons/react";
import { FileEntry } from "./FileEntry";
import { OverviewPanel } from "./OverviewPanel";
import { Panel } from "./Panel";
import { ResourcePreviewList } from "./ResourcePreview";
import type { PrResourcePreview } from "../types";
import { formatTime } from "../utils";

export interface ReviewDetailContentProps {
  openPull: GithubPullRequest | null;
  openStatus: ReturnType<typeof deriveReviewStatus>;
  openComments: GithubIssueComment[];
  files: GithubPullFile[];
  resourcePreviews: PrResourcePreview[];
  loadingDetail: boolean;
  needFixMessage: string;
  generalComment: string;
  onNeedFixChange: (value: string) => void;
  onGeneralCommentChange: (value: string) => void;
  onAddNeedFix: () => void;
  onAddGeneralComment: () => void;
  onMarkFixed: (id: string) => void;
  onApprove: () => void;
  onClose?: () => void;
  overviewPanelRef?: React.RefObject<HTMLDivElement | null>;
}

export function ReviewDetailContent(props: ReviewDetailContentProps) {
  const {
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
    onMarkFixed,
    onApprove,
    onClose,
    overviewPanelRef,
  } = props;

  const accountState = useAccountState();

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

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {(loadingDetail || resourcePreviews.length > 0) && (
            <Panel title="资源预览">
              {loadingDetail && resourcePreviews.length === 0 ? (
                <div className="py-8 text-center text-sm text-white/45">
                  正在解析资源信息...
                </div>
              ) : (
                <ResourcePreviewList resources={resourcePreviews} />
              )}
            </Panel>
          )}
          <Panel title="改动文件">
            {loadingDetail ? (
              <div className="py-10 text-center text-white/45">加载中...</div>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                {files.map((file) => (
                  <FileEntry key={file.filename} file={file} />
                ))}
                {files.length === 0 && (
                  <p className="text-sm text-white/45">暂无文件信息</p>
                )}
              </div>
            )}
          </Panel>
          <Panel title="评论流">
            <div className="flex flex-col gap-2">
              {openComments.map((comment) => (
                <div key={comment.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs text-white/45">
                    <span>{comment.user?.login}</span>
                    <span>{formatTime(comment.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-white/70">{comment.body}</p>
                </div>
              ))}
              {openComments.length === 0 && <p className="text-sm text-white/45">暂无评论</p>}
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="ABCC 状态">
            <div className="flex flex-col gap-2">
              {openStatus.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono-sarasa text-xs text-white/45">{item.id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${item.fixed ? "bg-emerald-500/15 text-emerald-100" : "bg-amber-500/15 text-amber-100"}`}>
                      {item.fixed ? "fixed" : "needfix"}
                    </span>
                  </div>
                  <p className="text-sm text-white/75">{item.message}</p>
                  {!item.fixed && (
                    <Button className="mt-2" size="1" variant="soft" onClick={() => onMarkFixed(item.id)}>
                      标记 fixed
                    </Button>
                  )}
                </div>
              ))}
              {openStatus.items.length === 0 && (
                <p className="text-sm text-white/45">还没有 ABCC needfix。</p>
              )}
            </div>
          </Panel>
          <Panel title="添加 Needfix">
            <textarea
              value={needFixMessage}
              onChange={(event) => onNeedFixChange(event.target.value)}
              className="min-h-28 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none"
            />
            <Button className="mt-2 w-full" onClick={onAddNeedFix}>
              发送 [ABCC_NEEDFIX]
            </Button>
          </Panel>
          <Panel title="普通评论">
            <textarea
              value={generalComment}
              onChange={(event) => onGeneralCommentChange(event.target.value)}
              className="min-h-28 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none"
            />
            <Button className="mt-2 w-full" variant="soft" onClick={onAddGeneralComment}>
              发送评论
            </Button>
          </Panel>
          {accountState.github?.username && (
            <Panel title="当前审核者">
              <div className="flex items-center gap-2 text-sm text-white/70">
                {accountState.github.avatar ? (
                  <img
                    src={accountState.github.avatar}
                    className="h-6 w-6 rounded-full object-cover"
                    alt={accountState.github.username}
                  />
                ) : (
                  <UserCircle size={20} weight="duotone" />
                )}
                <span>{accountState.github.username}</span>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
