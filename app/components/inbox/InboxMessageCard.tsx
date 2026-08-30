import { useLayoutEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CaretUpIcon,
  CheckCircleIcon,
  GithubLogoIcon,
  PackageIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Spinner } from "@radix-ui/themes";
import { AnimatePresence, motion } from "framer-motion";
import InboxIcon from "./InboxIcon";
import PanelButton from "./PanelButton";
import { cardExpandTransition } from "./styles";
import type { PendingAction } from "./types";
import {
  CC_NOTICE_BADGES,
  isCcNoticeMetadata,
  type InboxNotification,
} from "~/logic/inbox/types";
import { renderCommentMarkdownHtml } from "~/routes/resreview/utils/comment";

interface InboxMessageCardProps {
  message: InboxNotification;
  expanded: boolean;
  blurredBackground?: boolean;
  pendingAction?: PendingAction;
  onMarkRead: (message: InboxNotification) => void;
  onDeleteMessage: (id: string) => void;
  onToggleMessage: (id: string) => void;
  onOpenResource?: (message: InboxNotification) => void;
}

export default function InboxMessageCard({
  message,
  expanded,
  blurredBackground,
  pendingAction,
  onMarkRead,
  onDeleteMessage,
  onToggleMessage,
  onOpenResource,
}: InboxMessageCardProps) {
  const busy = !!pendingAction;
  const unread = !message.readAt;
  const meta = isCcNoticeMetadata(message.metadata) ? message.metadata : null;
  const badge = meta ? CC_NOTICE_BADGES[meta.subtype] : null;
  const expandedRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [expandedHeight, setExpandedHeight] = useState(0);
  const [collapsedHeight, setCollapsedHeight] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (summaryRef.current) {
        setCollapsedHeight(summaryRef.current.scrollHeight);
      }
      if (expanded && expandedRef.current) {
        setExpandedHeight(expandedRef.current.scrollHeight);
      }
    };

    measure();

    const targets: Element[] = [];
    if (summaryRef.current) targets.push(summaryRef.current);
    if (expanded && expandedRef.current) targets.push(expandedRef.current);
    if (targets.length === 0) return;

    const observer = new ResizeObserver(measure);
    for (const target of targets) observer.observe(target);

    return () => observer.disconnect();
  }, [expanded]);

  const badgeElement = badge ? (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${badge.className}`}
    >
      {badge.label}
    </span>
  ) : null;

  const summary = (
    <button
      type="button"
      className="tauri-no-drag flex w-full items-start gap-3 text-left"
      onClick={() => onToggleMessage(message.id)}
    >
      <span className="mt-0.5 flex size-[22px] shrink-0 items-center justify-center self-start">
        <InboxIcon read={!unread} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-white/90">
            {message.title}
          </h3>
          {badgeElement}
          <p className="mb-1 text-[11px] text-white/35">
            {formatTime(message.createdAt)}
          </p>
          {unread ? (
            <span
              aria-label="未读"
              className="h-2 w-2 shrink-0 rounded-full bg-red-500"
            />
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm leading-5 text-white/55">
          {message.body}
        </p>
      </div>
    </button>
  );

  const expandedContent = (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-[22px] shrink-0 items-center justify-center self-start">
        <InboxIcon read={!unread} />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="tauri-no-drag flex w-full min-w-0 items-center gap-2 text-left"
          onClick={() => onToggleMessage(message.id)}
          aria-expanded
        >
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-white/90">
            {message.title}
          </h3>
          {badgeElement}
          <p className="mb-1 text-[11px] text-white/35">
            {formatTime(message.createdAt)}
          </p>
          <CaretUpIcon size={14} className="shrink-0 text-white/40" />
        </button>
        <div className="mt-0 text-sm leading-6 text-white/75">
          <MarkdownBody body={message.body} />
        </div>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={false}
      animate={
        collapsedHeight > 0
          ? {
              height: expanded
                ? expandedHeight || collapsedHeight
                : collapsedHeight,
            }
          : {}
      }
      transition={cardExpandTransition}
      className={`relative overflow-visible ${expanded ? "z-20" : ""}`}
    >
      <motion.div
        ref={summaryRef}
        initial={false}
        animate={{
          opacity: expanded ? 0 : 1,
          scale: expanded ? 0.985 : 1,
        }}
        transition={cardExpandTransition}
        className={`group relative rounded-[14px] corner-rounded p-3 transition-colors ${
          unread
            ? "bg-[var(--nav-active-bg)]"
            : blurredBackground
              ? "bg-transparent"
              : "bg-[var(--nav-btn-bg)]"
        } ${expanded ? "pointer-events-none" : ""}`}
        style={{ transformOrigin: "top center" }}
      >
        {summary}
        {!expanded && unread && (
          <button
            type="button"
            disabled={busy}
            aria-busy={pendingAction === "read" || undefined}
            className={[
              "tauri-no-drag absolute right-3 bottom-3 inline-flex h-8 min-w-14 items-center justify-center gap-1 rounded-full bg-[var(--inbox-control-bg)] px-3.5 text-[13px] font-[500] text-white backdrop-blur-md transition-[background-color,opacity,transform] hover:bg-[var(--inbox-control-bg-hover)] active:scale-[0.96] active:bg-[var(--inbox-control-bg-active)] disabled:cursor-not-allowed",
              busy
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            ].join(" ")}
            onClick={(event) => {
              event.stopPropagation();
              onMarkRead(message);
            }}
          >
            {pendingAction === "read" ? (
              <Spinner size="1" />
            ) : (
              <>
                <CheckCircleIcon size={14} />
                标记已读
              </>
            )}
          </button>
        )}
      </motion.div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            ref={expandedRef}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={cardExpandTransition}
            className="absolute inset-x-0 top-0 z-20 rounded-[14px] corner-rounded bg-[var(--inbox-expanded-card-bg)] p-3 text-white shadow-[var(--inbox-expanded-card-shadow)]"
            style={{ transformOrigin: "top center" }}
          >
            {expandedContent}
            <div className="mt-3 flex flex-col gap-2">
              {onOpenResource && meta && (
                <PanelButton
                  fullWidth
                  disabled={busy}
                  onClick={() => onOpenResource(message)}
                >
                  <PackageIcon size={16} />
                  查看资源
                </PanelButton>
              )}
              {meta?.prUrl && (
                <PanelButton
                  fullWidth
                  disabled={busy}
                  onClick={() => void openUrl(meta.prUrl!)}
                >
                  <GithubLogoIcon size={16} weight="duotone" />
                  在 GitHub上查看
                </PanelButton>
              )}
              {unread && (
                <PanelButton
                  fullWidth
                  disabled={busy}
                  loading={pendingAction === "read"}
                  onClick={() => onMarkRead(message)}
                >
                  <CheckCircleIcon size={16} />
                  标记已读
                </PanelButton>
              )}
              <PanelButton
                fullWidth
                danger
                disabled={busy}
                loading={pendingAction === "delete"}
                onClick={() => onDeleteMessage(message.id)}
              >
                <TrashIcon size={16} />
                删除
              </PanelButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function MarkdownBody({ body }: { body: string }) {
  const safeBody = body.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return (
    <div
      className="break-words whitespace-pre-wrap"
      dangerouslySetInnerHTML={{
        __html: renderCommentMarkdownHtml(safeBody),
      }}
    />
  );
}

function formatTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
