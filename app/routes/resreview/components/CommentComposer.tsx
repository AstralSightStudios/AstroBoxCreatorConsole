import { useEffect, useRef, useState } from "react";
import { Button, TextArea, Switch } from "@radix-ui/themes";
import { SegmentedControl } from "@radix-ui/themes";
import {
  ArrowSquareOut,
  Code,
  LinkSimple,
  ListBullets,
  ListNumbers,
  PaperPlaneRight,
  Quotes,
  TextB,
  TextItalic,
  X,
} from "@phosphor-icons/react";
import type { GithubIssueComment } from "~/api/github/pr-review";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import { renderCommentMarkdownHtml, buildReplyBody, parseReviewCommentBody } from "../utils/comment";
import { makeNeedFixId } from "../utils";

export interface ReplyTarget {
  comment: GithubIssueComment;
}

export interface EditingTarget {
  comment: GithubIssueComment;
}

export interface CommentComposerProps {
  avatarUrl?: string;
  username?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (body: string) => void;
  submitting?: boolean;
  replyTarget?: ReplyTarget | null;
  editingTarget?: EditingTarget | null;
  onCancelReply?: () => void;
  onCancelEdit?: () => void;
}

function scrollToComment(commentId: number) {
  const selector = `[data-comment-card-id="${commentId}"]`;
  for (let i = 0; i < 8; i += 1) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.transition = "background-color 0.3s ease";
      let tick = 0;
      const pulse = setInterval(() => {
        el.style.backgroundColor = tick % 2 === 0 ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.02)";
        tick += 1;
        if (tick >= 6) {
          clearInterval(pulse);
          el.style.backgroundColor = "";
        }
      }, 400);
      return;
    }
  }
}

export function CommentComposer({
  avatarUrl,
  username,
  value,
  onChange,
  onSubmit,
  submitting = false,
  replyTarget = null,
  editingTarget = null,
  onCancelReply,
  onCancelEdit,
}: CommentComposerProps) {
  const { logicalHeight } = useUiScaleViewport();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [tagEnabled, setTagEnabled] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const tagIdRef = useRef(makeNeedFixId());

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.max(120, logicalHeight * 0.4))}px`;
  }, [logicalHeight, value, tab]);

  useEffect(() => {
    if (editingTarget) {
      const parsed = parseReviewCommentBody(editingTarget.comment.body || "");
      setTagEnabled(Boolean(parsed.tagId));
      if (parsed.tagId) {
        tagIdRef.current = parsed.tagId;
      }
    }
  }, [editingTarget]);

  const replaceSelection = (
    transform: (source: string, start: number, end: number) => { value: string; nextStart: number; nextEnd: number },
  ) => {
    const textarea = textareaRef.current;
    const source = value;
    const start = textarea?.selectionStart ?? source.length;
    const end = textarea?.selectionEnd ?? source.length;
    const result = transform(source, start, end);
    onChange(result.value);
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(result.nextStart, result.nextEnd);
    });
  };

  const wrapSelection = (prefix: string, suffix: string, placeholder: string) => {
    replaceSelection((source, start, end) => {
      const selected = source.slice(start, end);
      const content = selected || placeholder;
      const inserted = `${prefix}${content}${suffix}`;
      const nextValue = `${source.slice(0, start)}${inserted}${source.slice(end)}`;
      if (selected) {
        return { value: nextValue, nextStart: start + prefix.length, nextEnd: start + prefix.length + selected.length };
      }
      return { value: nextValue, nextStart: start + prefix.length, nextEnd: start + prefix.length + placeholder.length };
    });
  };

  const prefixLines = (linePrefixBuilder: (index: number) => string) => {
    replaceSelection((source, start, end) => {
      const selected = source.slice(start, end) || "内容";
      const lines = selected.split("\n");
      const prefixed = lines.map((line, index) => `${linePrefixBuilder(index)}${line}`).join("\n");
      const nextValue = `${source.slice(0, start)}${prefixed}${source.slice(end)}`;
      return { value: nextValue, nextStart: start, nextEnd: start + prefixed.length };
    });
  };

  const insertBold = () => wrapSelection("**", "**", "加粗文本");
  const insertItalic = () => wrapSelection("*", "*", "斜体文本");
  const insertInlineCode = () => wrapSelection("`", "`", "code");
  const insertQuote = () => prefixLines(() => "> ");
  const insertUnorderedList = () => prefixLines(() => "- ");
  const insertOrderedList = () => prefixLines((index) => `${index + 1}. `);
  const insertLink = () => {
    replaceSelection((source, start, end) => {
      const selected = source.slice(start, end) || "链接文字";
      const inserted = `[${selected}](https://)`;
      const nextValue = `${source.slice(0, start)}${inserted}${source.slice(end)}`;
      const urlStart = start + inserted.length - "https://".length - 1;
      return { value: nextValue, nextStart: urlStart, nextEnd: urlStart + "https://".length };
    });
  };

  const handleTagToggle = (checked: boolean) => {
    setTagEnabled(checked);
    if (checked) {
      tagIdRef.current = makeNeedFixId();
    }
  };

  const handleSubmit = () => {
    if (!value.trim()) return;
    let body = value.trim();
    if (tagEnabled) {
      body = `[ABCC_NEEDFIX_${tagIdRef.current}] ${body}`;
    }
    if (replyTarget) {
      const tc = replyTarget.comment;
      const excerpt = tc.body?.slice(0, 120) ?? "";
      body = buildReplyBody(tc.user?.login ?? "unknown", tc.id, excerpt, body);
    }
    onSubmit(body);
  };

  const canSubmit = value.trim().length > 0 && !submitting;
  const isEditing = editingTarget !== null;
  const isReplying = replyTarget !== null;

  return (
    <div className="flex items-start gap-3">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          className="hidden h-10 w-10 shrink-0 rounded-full object-cover sm:block"
          loading="lazy"
          alt={username || ""}
        />
      ) : (
        <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-white/50 sm:flex">
          {username?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
        {isEditing ? (
          <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-white/60">
            <span className="inline-flex items-center justify-center gap-2">
              正在编辑评论 #{editingTarget!.comment.id}
              <button
                type="button"
                className="inline-flex items-center justify-center gap-0.5 text-white/50 hover:text-white/80"
                onClick={() => scrollToComment(editingTarget!.comment.id)}
              >
                <ArrowSquareOut size={12} />
                定位
              </button>
            </span>
            <Button variant="ghost" size="1" onClick={onCancelEdit} className="cursor-pointer">
              <X size={14} />
            </Button>
          </div>
        ) : null}

        {isReplying ? (
          <div className="flex items-center justify-between gap-2 border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-white/60">
            <span className="inline-flex items-center justify-center gap-2">
              正在回复 #{replyTarget!.comment.id} · @{replyTarget!.comment.user?.login ?? "unknown"}
              <button
                type="button"
                className="inline-flex items-center justify-center gap-0.5 text-white/50 hover:text-white/80"
                onClick={() => scrollToComment(replyTarget!.comment.id)}
              >
                <ArrowSquareOut size={12} />
                定位
              </button>
            </span>
            <Button variant="ghost" size="1" onClick={onCancelReply} className="cursor-pointer">
              <X size={14} />
            </Button>
          </div>
        ) : null}

        <div className="border-b border-white/10">
          <SegmentedControl.Root
            value={tab}
            onValueChange={(val: "write" | "preview") => setTab(val)}
            size="2"
            radius="large"
            variant="surface"
            className="mx-3 my-2"
          >
            <SegmentedControl.Item
              value="write"
              className={`
                px-3 py-2 text-sm cursor-pointer
                ${tab === "write" ? "bg-white/20 font-medium" : ""}
              `}
            >
              编辑
            </SegmentedControl.Item>
            <SegmentedControl.Item
              value="preview"
              className={`
                px-3 py-2 text-sm cursor-pointer
                ${tab === "preview" ? "bg-white/20 font-medium" : ""}
              `}
            >
              预览
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </div>

        {tab === "write" ? (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-white/[0.02] px-3 py-2">
              <Button variant="ghost" color="gray" size="2" onClick={insertBold} title="粗体" className="h-9 px-2">
                <TextB size={18} />
                <span className="hidden sm:inline text-sm">粗体</span>
              </Button>
              <Button variant="ghost" color="gray" size="2" onClick={insertItalic} title="斜体" className="h-9 px-2">
                <TextItalic size={18} />
                <span className="hidden sm:inline text-sm">斜体</span>
              </Button>
              <Button variant="ghost" color="gray" size="2" onClick={insertInlineCode} title="代码" className="h-9 px-2">
                <Code size={18} />
                <span className="hidden sm:inline text-sm">代码</span>
              </Button>
              <Button variant="ghost" color="gray" size="2" onClick={insertQuote} title="引用" className="h-9 px-2">
                <Quotes size={18} />
                <span className="hidden sm:inline text-sm">引用</span>
              </Button>
              <Button variant="ghost" color="gray" size="2" onClick={insertUnorderedList} title="列表" className="h-9 px-2">
                <ListBullets size={18} />
                <span className="hidden sm:inline text-sm">列表</span>
              </Button>
              <Button variant="ghost" color="gray" size="2" onClick={insertOrderedList} title="编号" className="h-9 px-2">
                <ListNumbers size={18} />
                <span className="hidden sm:inline text-sm">编号</span>
              </Button>
              <Button variant="ghost" color="gray" size="2" onClick={insertLink} title="链接" className="h-9 px-2">
                <LinkSimple size={18} />
                <span className="hidden sm:inline text-sm">链接</span>
              </Button>
            </div>
            <div className="px-3 py-3">
              <TextArea
                ref={textareaRef}
                value={value}
                placeholder="写下你的评论..."
                className="min-h-[64px] resize-none overflow-y-auto border border-white/10 bg-black/20 text-sm text-white/80 outline-none placeholder:text-white/30"
                style={{ borderRadius: "10px" }}
                onChange={(e) => onChange(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="min-h-[120px] px-3 py-3">
            {value.trim() ? (
              <div
                className="break-words text-sm leading-6 text-white/80"
                dangerouslySetInnerHTML={{ __html: renderCommentMarkdownHtml(value) }}
              />
            ) : (
              <p className="text-sm text-white/30">没有可预览的内容</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-white/[0.02] px-3 py-2">
          <label className="inline-flex items-center gap-2 text-xs text-white/50">
            <Switch checked={tagEnabled} onCheckedChange={handleTagToggle} />
            NEEDFIX 标签
          </label>
          <div className="ml-auto">
            <Button size="2" disabled={!canSubmit} onClick={handleSubmit} className="gap-1.5">
              {!submitting ? <PaperPlaneRight size={14} /> : null}
              {submitting ? "发送中..." : isReplying ? "回复评论" : isEditing ? "更新评论" : "发送评论"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
