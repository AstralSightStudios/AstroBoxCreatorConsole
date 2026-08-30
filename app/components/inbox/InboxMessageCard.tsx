import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretUpIcon,
  PackageIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  CC_NOTICE_BADGES,
  isCcNoticeMetadata,
  type InboxNotification,
} from "~/logic/inbox/types";
import { renderCommentMarkdownHtml } from "~/routes/resreview/utils/comment";

interface InboxMessageCardProps {
  message: InboxNotification;
  onRead: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function InboxMessageCard({
  message,
  onRead,
  onRemove,
}: InboxMessageCardProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const readNotifiedRef = useRef(false);
  const unread = !message.readAt;

  const meta = isCcNoticeMetadata(message.metadata) ? message.metadata : null;
  const badge = meta ? CC_NOTICE_BADGES[meta.subtype] : null;

  useEffect(() => {
    if (expanded && unread && !readNotifiedRef.current) {
      readNotifiedRef.current = true;
      onRead(message.id);
    }
  }, [expanded, unread, message.id, onRead]);

  const jumpToPr = () => {
    if (meta?.prUrl) {
      openUrl(meta.prUrl).catch(() => {
        window.open(meta.prUrl!, "_blank", "noopener,noreferrer");
      });
    }
  };

  const jumpToResource = () => {
    if (typeof meta?.prNumber === "number") {
      navigate(`/resreview/detail?pr=${meta.prNumber}`);
    }
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {badge ? (
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs ${badge.className}`}
              >
                {badge.label}
              </span>
            ) : null}
            <h3 className="min-w-0 flex-1 truncate font-medium text-white/90">
              {message.title}
            </h3>
            {unread ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
            ) : null}
          </div>
          <p className="mt-1 text-xs text-white/40">
            {formatTime(message.createdAt)}
          </p>
        </div>
        {expanded ? (
          <CaretUpIcon size={14} className="mt-0.5 shrink-0 text-white/40" />
        ) : (
          <CaretDownIcon size={14} className="mt-0.5 shrink-0 text-white/40" />
        )}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-3">
          {message.body ? (
            <div
              className="break-words text-white/75"
              dangerouslySetInnerHTML={{
                __html: renderCommentMarkdownHtml(message.body),
              }}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {meta?.prUrl ? (
              <button
                type="button"
                onClick={jumpToPr}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-white/80 transition-colors hover:bg-white/10"
              >
                <ArrowSquareOutIcon size={13} />
                查看 PR
              </button>
            ) : null}
            {typeof meta?.prNumber === "number" ? (
              <button
                type="button"
                onClick={jumpToResource}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-white/80 transition-colors hover:bg-white/10"
              >
                <PackageIcon size={13} />
                查看资源
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(message.id)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
            >
              <TrashIcon size={13} />
              删除
            </button>
          </div>
        </div>
      ) : null}
    </div>
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
