import { useEffect, useMemo, useState } from "react";
import { DropdownMenu, AlertDialog, Button } from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowBendUpLeft,
  ArrowSquareOut,
  DotsThreeVertical,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import type { GithubIssueComment } from "~/api/github/pr-review";
import {
  parseReviewCommentBody,
  renderCommentMarkdownHtml,
  renderCommentMarkdownInlineHtml,
  formatRelativeTime,
  isLongContent,
  type ParsedReviewComment,
} from "../utils/comment";

export interface CommentTimelineProps {
  comments: GithubIssueComment[];
  currentUsername?: string;
  onReply?: (comment: GithubIssueComment) => void;
  onEdit?: (comment: GithubIssueComment) => void;
  onDelete?: (comment: GithubIssueComment) => void;
}

export function CommentTimeline({ comments, currentUsername, onReply, onEdit, onDelete }: CommentTimelineProps) {
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<GithubIssueComment | null>(null);

  const parsedMap = useMemo(() => {
    const next = new Map<string, ParsedReviewComment>();
    for (const comment of comments) {
      next.set(String(comment.id), parseReviewCommentBody(comment.body || ""));
    }
    return next;
  }, [comments]);

  useEffect(() => {
    setCollapsedState((prev) => {
      const next: Record<string, boolean> = {};
      for (const comment of comments) {
        const key = String(comment.id);
        next[key] = prev[key] ?? isLongContent(parsedMap.get(key));
      }
      return next;
    });
  }, [comments, parsedMap]);

  const parsedOf = (comment: GithubIssueComment): ParsedReviewComment =>
    parsedMap.get(String(comment.id)) || {
      tagType: "",
      tagId: "",
      replyTarget: "",
      replyExcerpt: "",
      content: comment.body || "",
    };

  const getTagBadgeClass = (tagType: ParsedReviewComment["tagType"]): string => {
    if (tagType === "NEEDFIX") return "bg-amber-500/15 text-amber-100";
    if (tagType === "FIXED") return "bg-emerald-500/15 text-emerald-100";
    return "bg-white/10 text-white/60";
  };

  const getReplyTargetId = (replyTarget: string): number | null => {
    const match = replyTarget.match(/#(\d+)/);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isFinite(id) ? id : null;
  };

  const scrollToReplyTarget = async (replyTarget: string): Promise<void> => {
    const id = getReplyTargetId(replyTarget);
    if (!id) return;
    const selector = `[data-comment-content-id="${id}"]`;
    for (let i = 0; i < 8; i += 1) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("ring-1", "ring-white/30", "bg-white/[0.06]", "rounded-md", "transition-all");
        setTimeout(() => {
          element.classList.remove("ring-1", "ring-white/30", "bg-white/[0.06]", "rounded-md", "transition-all");
        }, 1500);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  };

  const isCollapsed = (comment: GithubIssueComment): boolean =>
    collapsedState[String(comment.id)] ?? isLongContent(parsedMap.get(String(comment.id)));

  const toggleCollapsed = (comment: GithubIssueComment): void => {
    const key = String(comment.id);
    setCollapsedState((prev) => ({
      ...prev,
      [key]: !isCollapsed(comment),
    }));
  };

  if (comments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-sm text-white/45">
        暂无评论
      </div>
    );
  }

  return (
    <>
    <div className="relative space-y-4">
      <div className="pointer-events-none absolute bottom-5 top-5 w-px bg-white/10" style={{ left: "19px" }} />

      {comments.map((comment) => {
        const parsed = parsedOf(comment);
        const longContent = isLongContent(parsed);
        const collapsed = isCollapsed(comment);
        const hasReplyTarget = Boolean(getReplyTargetId(parsed.replyTarget));

        return (
          <div
            key={comment.id}
            className="relative flex items-start gap-3"
            data-comment-id={String(comment.id)}
          >
            {comment.user?.avatar_url ? (
              <img
                src={comment.user.avatar_url}
                className="relative z-10 h-10 w-10 shrink-0 rounded-full object-cover"
                loading="lazy"
                alt={comment.user.login}
              />
            ) : (
              <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-white/50">
                {comment.user?.login?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}

            <div className="relative z-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm">
              <div className="mb-2.5 border-b border-white/10 pb-2 text-xs text-white/45">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-white">{comment.user?.login || "unknown"}</span>
                    <span className="hidden shrink-0 sm:inline">{formatRelativeTime(comment.created_at)}</span>
                  </span>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <button
                        type="button"
                        className="inline-flex h-6 items-center justify-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 text-[11px] text-white/60 hover:bg-white/10 active:scale-95 transition-transform"
                      >
                        <DotsThreeVertical size={14} />
                        详情
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content side="bottom" align="end" sideOffset={6} className="min-w-[150px]">
                      {onReply ? (
                        <DropdownMenu.Item onSelect={() => onReply(comment)} className="gap-2">
                          <ArrowBendUpLeft size={14} />
                          回复
                        </DropdownMenu.Item>
                      ) : null}
                      {onEdit && comment.user?.login === currentUsername ? (
                        <DropdownMenu.Item
                          onSelect={() => onEdit(comment)}
                          className="gap-2"
                        >
                          <PencilSimple size={14} />
                          编辑
                        </DropdownMenu.Item>
                      ) : null}
                      {onDelete && comment.user?.login === currentUsername ? (
                        <DropdownMenu.Item
                          onSelect={() => setDeleteTarget(comment)}
                          className="gap-2 text-red-400"
                        >
                          <Trash size={14} />
                          删除
                        </DropdownMenu.Item>
                      ) : null}
                      {comment.html_url ? (
                        <DropdownMenu.Separator />
                      ) : null}
                      {comment.html_url ? (
                        <DropdownMenu.Item
                          onSelect={() => {
                            try {
                              void openUrl(comment.html_url!);
                            } catch {
                              window.open(comment.html_url, "_blank", "noopener,noreferrer");
                            }
                          }}
                          className="gap-2"
                        >
                          <ArrowSquareOut size={14} />
                          打开评论
                        </DropdownMenu.Item>
                      ) : null}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
                <div className="mt-0.5 pl-0 text-white/40 sm:hidden">
                  {formatRelativeTime(comment.created_at)}
                </div>
              </div>

              {parsed.replyTarget ? (
                <div className="mb-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs text-white/50">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-white/70">回复 {parsed.replyTarget}</div>
                    {hasReplyTarget ? (
                      <button
                        type="button"
                        className="inline-flex h-5 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] text-white/60 hover:bg-white/10 hover:text-white/80 active:scale-95 transition-transform"
                        onClick={() => void scrollToReplyTarget(parsed.replyTarget)}
                      >
                        <ArrowSquareOut size={12} />
                        定位
                      </button>
                    ) : null}
                  </div>
                  {parsed.replyExcerpt ? (
                    <div
                      className="mt-1 break-words"
                      dangerouslySetInnerHTML={{ __html: renderCommentMarkdownHtml(parsed.replyExcerpt) }}
                    />
                  ) : null}
                </div>
              ) : null}

              <div
                data-comment-content-id={String(comment.id)}
                className={`pt-0.5 break-words text-white/80 ${collapsed ? "max-h-36 overflow-hidden" : ""}`}
              >
                {parsed.tagId ? (
                  <span
                    className={`mr-1 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] ${getTagBadgeClass(parsed.tagType)}`}
                  >
                    {parsed.tagType || "COMMENT"} · {parsed.tagId}
                  </span>
                ) : null}
                <span
                  className="align-middle"
                  dangerouslySetInnerHTML={{ __html: renderCommentMarkdownInlineHtml(parsed.content) }}
                />
              </div>

              {longContent ? (
                <button
                  type="button"
                  className="mt-2 rounded-md px-1.5 py-0.5 text-xs text-white/50 hover:bg-white/10 hover:text-white/70 active:scale-95 transition-transform"
                  onClick={() => toggleCollapsed(comment)}
                >
                  {collapsed ? "展开" : "收起"}
                </button>
              ) : null}

              {collapsed && longContent ? (
                <div className="pointer-events-none absolute bottom-8 left-0 right-0 h-10 bg-gradient-to-t from-white/[0.03] to-transparent" />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>

      <AlertDialog.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialog.Content className="max-w-[400px]">
          <AlertDialog.Title>删除评论</AlertDialog.Title>
          <AlertDialog.Description size="2">
            确定要删除这条评论吗？此操作不可撤销。
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-3">
            <AlertDialog.Cancel>
              <Button variant="soft" size="2">取消</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                size="2"
                onClick={() => {
                  if (deleteTarget) {
                    onDelete?.(deleteTarget);
                    setDeleteTarget(null);
                  }
                }}
              >
                删除
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
