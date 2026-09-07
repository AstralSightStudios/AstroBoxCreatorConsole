import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Avatar,
  Badge,
  Button,
  DataList,
  Flex,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { motion } from "framer-motion";
import {
  ArrowClockwiseIcon,
  ArrowDownLeftIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CaretDownIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { EventListeners, PartialOptions } from "overlayscrollbars";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import BlurEffect from "react-progressive-blur";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  AFDIAN_DIALOGS_QUERY_KEY,
  getAfdianDialogs,
  getAfdianMessageUserDetails,
  getAfdianMessages,
  sendAfdianMessage,
  type AfdianMessage,
  type AfdianMessagePage,
} from "~/api/afdian-messages";
import {
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianErrorMessage,
  getAfdianSessionStatus,
  isAfdianNativeAvailable,
} from "~/api/afdian-account";
import { Dialog, DropdownMenu } from "~/components/ScaleAwareThemes";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import { Bubble, BubbleContent } from "~/components/s11a/bubble";
import { AfdianDialogList } from "~/components/afdian/messages-sidebar";
import {
  useSetHeaderIdentity,
  type HeaderIdentityDetail,
} from "~/layout/header-actions";
import Page from "~/layout/page";

const SIDEBAR_WIDTH_STORAGE_KEY = "afdian-messages-sidebar-width";
const SEND_SHORTCUT_STORAGE_KEY = "afdian-messages-send-shortcut";
const QUICK_REPLIES_STORAGE_KEY = "afdian-messages-quick-replies";
const SIDEBAR_MIN_WIDTH = 144;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_COMPACT_WIDTH = 220;
const COMPLAINT_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const COMPLAINT_UNFREEZE_DELAY_MS = 10 * 24 * 60 * 60 * 1000;
const NARROW_PANE_EASE: [number, number, number, number] = [
  0.22, 0.82, 0.3, 1,
];
type SendShortcut = "enter" | "shift-enter";
const DEFAULT_QUICK_REPLIES = [
  "感谢你的支持！",
  "你好，有什么可以帮助你的？",
  "收到，我会尽快处理。",
  "如果还有问题，欢迎继续留言。",
] as const;
const AUTO_HIDE_SCROLLBAR_OPTIONS: PartialOptions = {
  overflow: { x: "hidden", y: "scroll" },
  scrollbars: {
    theme: "os-theme-light",
    autoHide: "scroll",
    autoHideDelay: 700,
  },
};

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function getStoredSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!stored) return SIDEBAR_DEFAULT_WIDTH;
    const value = Number(stored);
    return Number.isFinite(value)
      ? clampSidebarWidth(value)
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function getStoredSendShortcut(): SendShortcut {
  if (typeof window === "undefined") return "enter";
  try {
    return window.localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY) === "shift-enter"
      ? "shift-enter"
      : "enter";
  } catch {
    return "enter";
  }
}

function getStoredQuickReplies() {
  if (typeof window === "undefined") return [...DEFAULT_QUICK_REPLIES];
  try {
    const stored = window.localStorage.getItem(QUICK_REPLIES_STORAGE_KEY);
    if (!stored) return [...DEFAULT_QUICK_REPLIES];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...DEFAULT_QUICK_REPLIES];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [...DEFAULT_QUICK_REPLIES];
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatAmount(value?: string | null) {
  if (!value) return "--";
  if (value === "**") return "未公开";
  const amount = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(amount)) return value;
  return `¥${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function formatBirthday(value?: string | null) {
  if (!value) return null;
  const normalized = value.replaceAll("-", "");
  if (!/^\d{8}$/.test(normalized)) return value;
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6)}`;
}

function formatHiddenValue(value?: string | null) {
  if (!value) return null;
  return value === "**" ? "未公开" : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseAfdianOrder(content: unknown) {
  const record = asRecord(content);
  if (!record) return null;

  const productType = numberValue(record.product_type);
  const plan = asRecord(record.plan);
  const planName = textValue(plan?.name) || textValue(plan?.title);
  const skuDetails = Array.isArray(record.sku_detail)
    ? record.sku_detail
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => ({
          name: textValue(item.name),
          count: numberValue(item.count),
        }))
        .filter((item) => item.name && item.name !== "默认型号")
    : [];
  const isProduct = productType === 1;

  return {
    amount:
      textValue(record.show_amount) ||
      textValue(record.total_amount) ||
      textValue(record.per_month),
    isProduct,
    month: numberValue(record.month),
    orderNo: textValue(record.out_trade_no),
    orderTitle:
      textValue(record.title) ||
      textValue(record.product_name) ||
      planName ||
      (isProduct ? "商品订单" : "发电订单"),
    remark: textValue(record.remark),
    skuDetails,
  };
}

function parseAfdianGroup(content: unknown) {
  const record = asRecord(content);
  const group = asRecord(record?.group);
  if (!group) return null;

  const title = textValue(group.title);
  const cover = textValue(group.cover);
  if (!title && !cover) return null;

  return {
    cover,
    title: title || "爱发电电圈",
  };
}

function parseAfdianComplaint(content: unknown) {
  const text = textValue(content);
  if (!text?.startsWith("用户在微信发起投诉")) return null;

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 6) return null;

  lines.shift();
  const profileUrl = lines.at(-1)?.startsWith("http") ? lines.pop() : null;
  const orderNo = lines.pop() || null;
  const amount = lines.pop() || null;
  const submittedAt = lines.pop() || null;
  const complaintNo = lines.shift() || null;
  const reason = lines.join("\n") || "用户申请退款";
  const userId = profileUrl?.split("/").filter(Boolean).at(-1) || null;

  return {
    amount,
    complaintNo,
    orderNo,
    reason,
    submittedAt,
    userId,
  };
}

function parseAfdianDateTime(value?: string | null) {
  if (!value) return null;
  const matched = value.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!matched) return null;

  const [, year, month, day, hour, minute, second] = matched;
  const timestamp = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatRemainingDuration(duration: number) {
  const totalMinutes = Math.max(1, Math.ceil(duration / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function getComplaintStatus(submittedAt: string | null, now: number) {
  const submittedTimestamp = parseAfdianDateTime(submittedAt);
  if (submittedTimestamp === null) {
    return "订单已暂时冻结，请在 24 小时内回复并联系用户撤诉。";
  }

  const defaultWithdrawAt = submittedTimestamp + COMPLAINT_RESPONSE_WINDOW_MS;
  if (now < defaultWithdrawAt) {
    return `订单已暂时冻结，请在 ${formatRemainingDuration(defaultWithdrawAt - now)} 内回复并联系用户撤诉。`;
  }

  const unfreezeAt = defaultWithdrawAt + COMPLAINT_UNFREEZE_DELAY_MS;
  if (now < unfreezeAt) {
    return `用户超过 24 小时未继续投诉，已默认撤诉。订单预计在 ${formatRemainingDuration(unfreezeAt - now)} 后自动解冻。`;
  }

  return "用户超过 24 小时未继续投诉，已默认撤诉。订单已到达自动解冻时间。";
}

function normalizeOrderText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[×x]/g, "*")
    .replace(/\s+/g, "");
}

function matchesRedemptionNotice(content: unknown, notice: string) {
  const order = parseAfdianOrder(content);
  if (!order || !notice.includes("来自兑换码")) return false;

  const normalizedNotice = normalizeOrderText(notice);
  const contentMatches = [
    order.orderTitle,
    ...order.skuDetails.map((item) => item.name),
  ].every(
    (part) => !part || normalizedNotice.includes(normalizeOrderText(part)),
  );
  const countsMatch = order.skuDetails.every(
    (item) =>
      !item.count || normalizedNotice.includes(`*${item.count}`),
  );

  return contentMatches && countsMatch;
}

function AfdianOrderCard({
  content,
  usedRedemptionCode,
}: {
  content: unknown;
  usedRedemptionCode: boolean;
}) {
  const order = parseAfdianOrder(content);
  if (!order) return <p>此订单消息没有可显示的内容</p>;

  const {
    amount,
    isProduct,
    month,
    orderNo,
    orderTitle,
    remark,
    skuDetails,
  } = order;
  const redeemed = usedRedemptionCode || Boolean(remark?.includes("来自兑换码"));

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-[18px] text-white/90">
      <div className="min-w-0 bg-green-500 px-4 py-4 text-white">
        <p className="break-words text-sm leading-5">
          {isProduct ? "购买了" : "发电了"} {orderTitle}
        </p>
        {skuDetails.length > 0 && (
          <div className="mt-2 flex min-w-0 flex-col gap-1 text-sm leading-5">
            {skuDetails.map((item, index) => (
              <p key={`${item.name}-${index}`} className="break-words">
                [{item.name}] {orderTitle}
                {item.count && item.count > 0 ? ` × ${item.count}` : ""}
              </p>
            ))}
          </div>
        )}
        {orderNo && (
          <p className="mt-3 break-all font-mono-sarasa text-xs leading-5 text-white/75">
            订单号 {orderNo}
          </p>
        )}
        {(amount || redeemed) && (
          <div className="mt-4 flex min-w-0 flex-col items-start gap-1">
            {amount && (
              <span
                className={`text-3xl font-medium tracking-tight ${
                  redeemed ? "line-through decoration-2 decoration-white/80" : ""
                }`}
              >
                ¥ {amount}
              </span>
            )}
            {redeemed && (
              <span className="text-sm font-medium text-white/90">使用兑换码</span>
            )}
            {month && month > 0 && !isProduct && (
              <span className="text-xs text-white/75">{month} 个月</span>
            )}
          </div>
        )}
      </div>
      {remark && (
        <div className="px-4 py-3">
          <p className="mb-1 text-xs text-white/45">用户填写</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-5 text-white/80">
            {remark}
          </p>
        </div>
      )}
    </div>
  );
}

function AfdianComplaintCard({ content }: { content: unknown }) {
  const complaint = parseAfdianComplaint(content);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!complaint) return <p>此投诉消息没有可显示的内容</p>;

  const status = getComplaintStatus(complaint.submittedAt, now);

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-[18px] text-white/90">
      <div className="min-w-0 bg-red-500 px-4 py-4 text-white">
        <Flex align="center" gap="2">
          <WarningCircleIcon size={20} weight="fill" />
          <Text size="3" weight="bold" highContrast>
            微信支付投诉
          </Text>
        </Flex>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-5">
          {complaint.reason}
        </p>
        {complaint.amount && (
          <p className="mt-4 text-3xl font-medium tracking-tight">
            ¥ {complaint.amount}
          </p>
        )}
        <p className="mt-3 text-xs leading-5 text-white/80">
          {status}
        </p>
      </div>
      <div className="px-4 py-3">
        <DataList.Root size="1">
          {complaint.submittedAt && (
            <DataList.Item align="start">
              <DataList.Label minWidth="88px">投诉时间</DataList.Label>
              <DataList.Value>{complaint.submittedAt}</DataList.Value>
            </DataList.Item>
          )}
          {complaint.orderNo && (
            <DataList.Item align="start">
              <DataList.Label minWidth="88px">订单号</DataList.Label>
              <DataList.Value className="min-w-0 break-all font-mono-sarasa">
                {complaint.orderNo}
              </DataList.Value>
            </DataList.Item>
          )}
          {complaint.complaintNo && (
            <DataList.Item align="start">
              <DataList.Label minWidth="88px">投诉单号</DataList.Label>
              <DataList.Value className="min-w-0 break-all font-mono-sarasa">
                {complaint.complaintNo}
              </DataList.Value>
            </DataList.Item>
          )}
          {complaint.userId && (
            <DataList.Item align="start">
              <DataList.Label minWidth="88px">用户 ID</DataList.Label>
              <DataList.Value className="min-w-0 break-all font-mono-sarasa">
                {complaint.userId}
              </DataList.Value>
            </DataList.Item>
          )}
        </DataList.Root>
      </div>
    </div>
  );
}

function AfdianGroupCard({ content }: { content: unknown }) {
  const group = parseAfdianGroup(content);
  if (!group) return <p>此电圈消息没有可显示的内容</p>;

  return (
    <Flex direction="column" gap="3" p="3" className="w-full min-w-0">
      <Text as="p" size="2" highContrast>
        您已加入
      </Text>
      <Flex align="center" gap="3" className="min-w-0">
        <Avatar
          size="6"
          radius="medium"
          src={group.cover ?? undefined}
          fallback={group.title.slice(0, 1) || "圈"}
          className="shrink-0"
        />
        <Text
          as="p"
          size="5"
          weight="bold"
          highContrast
          className="min-w-0 break-words leading-snug"
        >
          {group.title}
        </Text>
      </Flex>
    </Flex>
  );
}

function MessageContent({
  message,
  usedRedemptionCode,
}: {
  message: AfdianMessage;
  usedRedemptionCode: boolean;
}) {
  if (parseAfdianComplaint(message.content)) {
    return <AfdianComplaintCard content={message.content} />;
  }
  if (message.messageType === 1 || typeof message.content === "string") {
    return <p className="whitespace-pre-wrap text-sm leading-6">{String(message.content)}</p>;
  }
  if (message.messageType === 2) {
    return (
      <AfdianOrderCard
        content={message.content}
        usedRedemptionCode={usedRedemptionCode}
      />
    );
  }
  if (message.messageType === 6) {
    return <AfdianGroupCard content={message.content} />;
  }
  if (message.messageType === 4) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-6 text-white/70">
        {typeof message.content === "string"
          ? message.content
          : "系统消息"}
      </p>
    );
  }
  return <p className="text-sm text-white/55">此类消息请在爱发电中查看</p>;
}

function MessageBubble({
  message,
  avatar,
  fallback,
  usedRedemptionCode,
}: {
  message: AfdianMessage;
  avatar?: string | null;
  fallback: string;
  usedRedemptionCode: boolean;
}) {
  const sent = message.direction === "send";
  const isOrder = message.messageType === 2;
  const isGroup = message.messageType === 6;
  const isComplaint = Boolean(parseAfdianComplaint(message.content));
  const isWideCard = isOrder || isComplaint;
  const isRichCard = isWideCard || isGroup;
  return (
    <div className={`flex min-w-0 items-end gap-2 ${sent ? "justify-end" : "justify-start"}`}>
      {!sent && (
        <Avatar
          size="2"
          radius="full"
          src={avatar ?? undefined}
          fallback={fallback}
          className="relative z-10 mb-5 shrink-0"
        />
      )}
      <Bubble
        platform="imessage"
        align={sent ? "end" : "start"}
        variant={isWideCard ? "secondary" : sent ? "default" : "secondary"}
        className={
          isWideCard
            ? sent
              ? "w-[90%]! max-w-[34rem]!"
              : "w-[calc(100%_-_2.5rem)]! max-w-[34rem]!"
            : isGroup
              ? sent
                ? "w-[22rem]! max-w-[90%]!"
                : "w-[22rem]! max-w-[calc(100%_-_2.5rem)]!"
            : ""
        }
      >
        <BubbleContent
          className={`relative overflow-visible! rounded-[18px]! ${
            isRichCard ? "w-full! p-0!" : ""
          }`}
        >
          <MessageContent
            message={message}
            usedRedemptionCode={usedRedemptionCode}
          />
        </BubbleContent>
        <p
          className={`px-1 text-[11px] text-white/40 ${
            sent ? "self-end text-right" : "self-start text-left"
          }`}
        >
          {formatDateTime(message.sentAt)}
        </p>
      </Bubble>
    </div>
  );
}

function MessageComposer({
  value,
  error,
  sending,
  disabled,
  sendShortcut,
  onSendShortcutChange,
  onHeightChange,
  onChange,
  onSend,
}: {
  value: string;
  error: string;
  sending: boolean;
  disabled: boolean;
  sendShortcut: SendShortcut;
  onSendShortcutChange: (shortcut: SendShortcut) => void;
  onHeightChange: (height: number) => void;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  const sendOnEnter = sendShortcut === "enter";
  const composerRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [inputHeight, setInputHeight] = useState(36);
  const [quickReplies, setQuickReplies] = useState<string[]>(
    getStoredQuickReplies,
  );
  const [quickReplyDrafts, setQuickReplyDrafts] = useState<string[]>([]);
  const [quickReplyDialogOpen, setQuickReplyDialogOpen] = useState(false);

  const resizeTextArea = useCallback(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;

    textArea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textArea.scrollHeight, 36), 120);
    textArea.style.height = `${nextHeight}px`;
    textArea.style.overflowY = textArea.scrollHeight > 120 ? "auto" : "hidden";
    setInputHeight((current) => current === nextHeight ? current : nextHeight);
  }, []);

  useLayoutEffect(() => {
    resizeTextArea();
  }, [resizeTextArea, value]);

  useEffect(() => {
    window.addEventListener("resize", resizeTextArea);
    return () => window.removeEventListener("resize", resizeTextArea);
  }, [resizeTextArea]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const updateHeight = () => {
      onHeightChange(Math.ceil(composer.getBoundingClientRect().height));
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [onHeightChange]);

  const insertQuickReply = (reply: string) => {
    onChange(value.trimEnd() ? `${value.trimEnd()} ${reply}` : reply);
    requestAnimationFrame(() => textAreaRef.current?.focus());
  };

  const openQuickReplyManager = () => {
    setQuickReplyDrafts([...quickReplies]);
    setQuickReplyDialogOpen(true);
  };

  const saveQuickReplies = () => {
    const normalized = Array.from(
      new Set(quickReplyDrafts.map((item) => item.trim()).filter(Boolean)),
    );
    setQuickReplies(normalized);
    try {
      window.localStorage.setItem(
        QUICK_REPLIES_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      return;
    } finally {
      setQuickReplyDialogOpen(false);
    }
  };

  return (
    <>
      <div
        ref={composerRef}
        className="absolute inset-x-0 bottom-0 z-10 px-4 pb-4 pt-6 sm:px-6"
      >
        <BlurEffect
          className="!pointer-events-none h-full w-full"
          intensity={100}
          position="bottom"
        />
        {error && (
          <p className="relative z-20 mb-2 text-xs text-red-300">{error}</p>
        )}
        <div className="relative z-20 flex items-end gap-2.5">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger disabled={sending}>
              <Button
                size="1"
                variant="soft"
                color="gray"
                radius="full"
                disabled={sending}
                aria-label="打开辅助功能"
                className="mb-0.5 !size-9 shrink-0 bg-white/[0.14]! !p-0 text-white! shadow-lg shadow-black/20"
              >
                <PlusIcon size={20} weight="regular" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content side="top" align="start" sideOffset={8}>
              <DropdownMenu.Label>常用语</DropdownMenu.Label>
              <DropdownMenu.Separator />
              {quickReplies.length === 0 && (
                <DropdownMenu.Item disabled>暂无常用语</DropdownMenu.Item>
              )}
              {quickReplies.map((reply) => (
                <DropdownMenu.Item
                  key={reply}
                  onSelect={() => insertQuickReply(reply)}
                >
                  {reply}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={openQuickReplyManager}>
                管理常用语
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <textarea
            ref={textAreaRef}
            rows={1}
            value={value}
            disabled={sending}
            placeholder={`输入私信内容，按 ${sendOnEnter ? "Enter" : "Shift + Enter"} 发送`}
            style={{ height: inputHeight }}
            className="box-border min-h-9 max-h-[120px] min-w-0 flex-1 resize-none rounded-[18px] border-0 bg-white/[0.14] px-4 py-2 text-sm leading-5 text-white/90 shadow-lg shadow-black/20 outline-none placeholder:text-white/40 disabled:opacity-50"
            onChange={(event) => onChange(event.target.value)}
            onInput={resizeTextArea}
            onKeyDown={(event) => {
              const shouldSend = sendOnEnter
                ? event.key === "Enter" && !event.shiftKey
                : event.key === "Enter" && event.shiftKey;
              if (shouldSend) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          <div className="flex h-9 shrink-0 overflow-hidden rounded-[18px] shadow-lg shadow-black/20">
            <Button
              disabled={disabled || sending}
              onClick={onSend}
              variant="soft"
              color="gray"
              radius="full"
              className="h-9! rounded-r-none! bg-white/[0.14]! px-4 text-white!"
            >
              {sending ? <Spinner size="1" /> : "发送"}
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger disabled={sending}>
                <Button
                  disabled={sending}
                  variant="soft"
                  color="gray"
                  radius="full"
                  aria-label="设置发送快捷键"
                  className="h-9! rounded-l-none! bg-white/[0.14]! px-2.5 text-white!"
                >
                  <CaretDownIcon size={15} weight="bold" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content side="top" align="end" sideOffset={8}>
                <DropdownMenu.Label>发送快捷键</DropdownMenu.Label>
                <DropdownMenu.Separator />
                <DropdownMenu.RadioGroup
                  value={sendShortcut}
                  onValueChange={(value) =>
                    onSendShortcutChange(value as SendShortcut)
                  }
                >
                  <DropdownMenu.RadioItem value="enter">
                    Enter 发送，Shift + Enter 换行
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="shift-enter">
                    Shift + Enter 发送，Enter 换行
                  </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>

      <Dialog.Root
        open={quickReplyDialogOpen}
        onOpenChange={setQuickReplyDialogOpen}
      >
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>管理常用语</Dialog.Title>
          <Dialog.Description size="2" className="mt-1 text-white/55">
            常用语保存在当前设备，点击加号即可快速插入。
          </Dialog.Description>
          <div className="mt-4 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {quickReplyDrafts.map((reply, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={reply}
                  maxLength={200}
                  aria-label={`常用语 ${index + 1}`}
                  className="h-9 min-w-0 flex-1 rounded-lg border-0 bg-white/[0.08] px-3 text-sm text-white/90 outline-none placeholder:text-white/35"
                  placeholder="输入常用语"
                  onChange={(event) =>
                    setQuickReplyDrafts((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  size="2"
                  variant="soft"
                  color="red"
                  aria-label={`删除常用语 ${index + 1}`}
                  onClick={() =>
                    setQuickReplyDrafts((items) =>
                      items.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <TrashIcon size={16} />
                </Button>
              </div>
            ))}
            {quickReplyDrafts.length === 0 && (
              <p className="py-4 text-center text-sm text-white/45">
                暂无常用语
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="soft"
            className="mt-3"
            onClick={() => setQuickReplyDrafts((items) => [...items, ""])}
          >
            <PlusIcon size={16} />
            添加常用语
          </Button>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="soft"
              onClick={() => setQuickReplyDialogOpen(false)}
            >
              取消
            </Button>
            <Button type="button" onClick={saveQuickReplies}>
              保存
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

export default function AfdianMessagesPage() {
  const nativeAvailable = isAfdianNativeAvailable();
  const { isDesktop, isNarrow } = useUiScaleViewport();
  const setHeaderIdentity = useSetHeaderIdentity();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [narrowPane, setNarrowPane] = useState<"dialogs" | "conversation">(
    searchParams.get("userId") ? "conversation" : "dialogs",
  );
  const [selectedUserId, setSelectedUserId] = useState(
    searchParams.get("userId") || "",
  );
  const [detailsUserId, setDetailsUserId] = useState("");
  const sessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: nativeAvailable,
    staleTime: 30_000,
    retry: false,
  });
  const connected = sessionQuery.data?.connected === true;
  const dialogsQuery = useInfiniteQuery({
    queryKey: AFDIAN_DIALOGS_QUERY_KEY,
    queryFn: ({ pageParam }) => getAfdianDialogs(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: nativeAvailable && connected,
    staleTime: 30_000,
    retry: 1,
  });
  const dialogs = dialogsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    const requestedUserId = searchParams.get("userId");
    if (requestedUserId && requestedUserId !== selectedUserId) {
      setSelectedUserId(requestedUserId);
      return;
    }
    if (!selectedUserId && dialogs[0]) {
      setSelectedUserId(dialogs[0].user.userId);
      if (isDesktop) {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set("userId", dialogs[0].user.userId);
        setSearchParams(nextSearchParams, { replace: true });
      }
      return;
    }
    if (isDesktop && selectedUserId && !requestedUserId) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set("userId", selectedUserId);
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [dialogs, isDesktop, searchParams, selectedUserId, setSearchParams]);

  useEffect(() => {
    if (!isNarrow) return;
    setNarrowPane(
      searchParams.get("userId") ? "conversation" : "dialogs",
    );
  }, [isNarrow, searchParams]);

  const selectedDialog = dialogs.find(
    (item) => item.user.userId === selectedUserId,
  );
  const selectedDialogAvatar = selectedDialog?.user.avatar;
  const selectedDialogName = selectedDialog?.user.name;
  const userDetailsQuery = useQuery({
    queryKey: ["afdian", "message-user-details", selectedUserId],
    queryFn: () => getAfdianMessageUserDetails(selectedUserId),
    enabled:
      nativeAvailable &&
      connected &&
      Boolean(selectedUserId) &&
      !isNarrow &&
      detailsUserId === selectedUserId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const headerIdentityDetails = useMemo<HeaderIdentityDetail[]>(() => {
    if (!selectedDialog) return [];
    const profile = userDetailsQuery.data;
    const details: HeaderIdentityDetail[] = [
      { label: "用户 ID", value: selectedDialog.user.userId },
    ];
    const addDetail = (
      label: string,
      value: string | number | null | undefined,
    ) => {
      if (value === null || value === undefined || value === "") return;
      details.push({ label, value: String(value) });
    };
    const addBadgeDetail = (
      label: string,
      values: string[],
      icon?: HeaderIdentityDetail["icon"],
    ) => {
      if (values.length === 0) return;
      details.push({
        icon,
        label,
        value: (
          <Flex
            gap="1"
            wrap="wrap"
            className="w-full min-w-0 max-w-full overflow-hidden"
          >
            {values.map((value) => (
              <Badge
                key={value}
                color="gray"
                size="1"
                variant="soft"
                title={value}
                className="block min-w-0 max-w-full! overflow-hidden! text-ellipsis! whitespace-nowrap!"
              >
                {value}
              </Badge>
            ))}
          </Flex>
        ),
      });
    };

    if (profile) {
      details.push({
        icon: <ArrowDownLeftIcon size={16} weight="bold" />,
        label: "对方发电",
        value: `${formatAmount(profile.sponsoredAmount)} · ${profile.sponsoredOrderCount} 笔`,
      });
      details.push({
        icon: <ArrowUpRightIcon size={16} weight="bold" />,
        label: "我的发电",
        value: `${formatAmount(profile.receivedAmount)} · ${profile.receivedOrderCount} 笔`,
      });
      addBadgeDetail(
        "对方计划",
        profile.sponsoredPlanNames,
        <ArrowDownLeftIcon size={16} weight="bold" />,
      );
      addBadgeDetail(
        "我的计划",
        profile.receivedPlanNames,
        <ArrowUpRightIcon size={16} weight="bold" />,
      );
      addDetail("最近收到", profile.lastSponsoredAt ? formatDateTime(profile.lastSponsoredAt) : null);
      addDetail("最近发出", profile.lastReceivedAt ? formatDateTime(profile.lastReceivedAt) : null);
      addDetail("生日", formatBirthday(profile.birthday));
      addDetail(
        "类型",
        profile.creatorType === 1
          ? "个人"
          : profile.creatorType === 2
            ? "组织"
            : null,
      );
      addDetail("分类", profile.categoryName);
      addDetail("月赞助", formatHiddenValue(profile.monthlyFans));
      addDetail("月收入", formatAmount(profile.monthlyIncome));
      addDetail("介绍", profile.creatorDetail);
    }

    addDetail("私信", selectedDialog.totalCount);
    addDetail("未读", selectedDialog.unreadCount);
    addDetail("联系时间", formatDateTime(selectedDialog.sentAt));
    return details;
  }, [selectedDialog, userDetailsQuery.data]);
  const userDetailsError = userDetailsQuery.isError
    ? getAfdianErrorMessage(userDetailsQuery.error, "部分用户资料暂时无法加载")
    : null;
  const requestSelectedUserDetails = useCallback(() => {
    setDetailsUserId(selectedUserId);
  }, [selectedUserId]);

  useLayoutEffect(() => {
    if (isNarrow || !selectedDialogName) {
      setHeaderIdentity(null);
      return;
    }

    setHeaderIdentity({
      avatar: selectedDialogAvatar,
      cover: userDetailsQuery.data?.cover,
      description: userDetailsQuery.data?.creatorDoing,
      details: headerIdentityDetails,
      detailsError: userDetailsError,
      detailsLoading: userDetailsQuery.isLoading,
      fallback: selectedDialogName.slice(0, 1) || "爱",
      isVerified: userDetailsQuery.data?.isVerified,
      name: selectedDialogName,
      onDetailsOpen: requestSelectedUserDetails,
      profileSlug: userDetailsQuery.data?.urlSlug,
    });

    return () => setHeaderIdentity(null);
  }, [
    isNarrow,
    headerIdentityDetails,
    selectedDialogAvatar,
    selectedDialogName,
    requestSelectedUserDetails,
    setHeaderIdentity,
    userDetailsError,
    userDetailsQuery.data?.cover,
    userDetailsQuery.data?.creatorDoing,
    userDetailsQuery.data?.isVerified,
    userDetailsQuery.data?.urlSlug,
    userDetailsQuery.isLoading,
  ]);
  const messagesQuery = useInfiniteQuery({
    queryKey: ["afdian", "messages", selectedUserId],
    queryFn: ({ pageParam }) =>
      getAfdianMessages({
        userId: selectedUserId,
        messageType: pageParam ? "old" : "new",
        messageId: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.oldestMessageId ?? undefined : undefined,
    enabled: nativeAvailable && connected && Boolean(selectedUserId),
    staleTime: 10_000,
    retry: 1,
  });
  const messages = useMemo(() => {
    const unique = new Map<string, AfdianMessage>();
    for (const item of messagesQuery.data?.pages.flatMap((page) => page.items) ?? []) {
      unique.set(item.id, item);
    }
    return [...unique.values()].sort((left, right) => {
      const leftTime = left.sentAt ? new Date(left.sentAt).getTime() : 0;
      const rightTime = right.sentAt ? new Date(right.sentAt).getTime() : 0;
      return leftTime - rightTime;
    });
  }, [messagesQuery.data]);
  const { redemptionOrderIds, hiddenRedemptionNoticeIds } = useMemo(() => {
    const orderIds = new Set<string>();
    const noticeIds = new Set<string>();
    const orders = messages.filter((message) => message.messageType === 2);

    messages.forEach((message) => {
      if (
        typeof message.content !== "string" ||
        !message.content.includes("来自兑换码")
      ) {
        return;
      }

      const matchedOrders = orders.filter((order) =>
        matchesRedemptionNotice(order.content, message.content as string),
      );
      if (matchedOrders.length === 0) return;

      noticeIds.add(message.id);
      matchedOrders.forEach((order) => orderIds.add(order.id));
    });

    return {
      redemptionOrderIds: orderIds,
      hiddenRedemptionNoticeIds: noticeIds,
    };
  }, [messages]);
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) => !hiddenRedemptionNoticeIds.has(message.id),
      ),
    [hiddenRedemptionNoticeIds, messages],
  );
  const workspaceRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef =
    useRef<OverlayScrollbarsComponentRef<"div">>(null);
  const shouldScrollToBottomRef = useRef(true);
  const messageScrollEvents = useMemo<EventListeners>(
    () => ({
      initialized: (instance) => {
        if (!shouldScrollToBottomRef.current) return;
        const viewport = instance.elements().scrollOffsetElement;
        viewport.scrollTop = viewport.scrollHeight;
        shouldScrollToBottomRef.current = false;
      },
    }),
    [],
  );
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(76);
  const [sendShortcut, setSendShortcut] = useState<SendShortcut>(
    getStoredSendShortcut,
  );
  const compactSidebar = !isDesktop && !isNarrow && sidebarWidth < SIDEBAR_COMPACT_WIDTH;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_WIDTH_STORAGE_KEY,
        String(sidebarWidth),
      );
    } catch {
      return;
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, sendShortcut);
    } catch {
      return;
    }
  }, [sendShortcut]);

  useEffect(() => {
    setDraft("");
    setSendError("");
    shouldScrollToBottomRef.current = true;
  }, [selectedUserId]);

  useEffect(() => {
    if (
      !selectedUserId ||
      messagesQuery.isLoading ||
      messagesQuery.isError ||
      messages.length === 0 ||
      !shouldScrollToBottomRef.current
    ) {
      return;
    }
    let frame = 0;
    let attempts = 0;
    const scrollToBottom = () => {
      const viewport = messagesViewportRef.current
        ?.osInstance()
        ?.elements().scrollOffsetElement;
      if (!viewport) {
        attempts += 1;
        if (attempts < 30) frame = requestAnimationFrame(scrollToBottom);
        return;
      }
      viewport.scrollTop = viewport.scrollHeight;
      shouldScrollToBottomRef.current = false;
    };
    frame = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(frame);
  }, [
    messages.length,
    messagesQuery.isError,
    messagesQuery.isLoading,
    selectedUserId,
  ]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !selectedUserId || isSending) return;

    setIsSending(true);
    setSendError("");
    try {
      const sentMessage = await sendAfdianMessage({
        userId: selectedUserId,
        content,
      });
      queryClient.setQueryData<{
        pages: AfdianMessagePage[];
        pageParams: unknown[];
      }>(["afdian", "messages", selectedUserId], (current) => {
        if (!current || current.pages.length === 0) return current;
        const firstPage = current.pages[0];
        const items = firstPage.items.some((item) => item.id === sentMessage.id)
          ? firstPage.items.map((item) =>
              item.id === sentMessage.id ? sentMessage : item,
            )
          : [...firstPage.items, sentMessage];
        return {
          ...current,
          pages: [{ ...firstPage, items }, ...current.pages.slice(1)],
        };
      });
      setDraft("");
      shouldScrollToBottomRef.current = true;
      void queryClient.invalidateQueries({
        queryKey: AFDIAN_DIALOGS_QUERY_KEY,
      });
      requestAnimationFrame(() => {
        const viewport = messagesViewportRef.current
          ?.osInstance()
          ?.elements().scrollOffsetElement;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    } catch (error) {
      setSendError(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "消息发送失败",
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const nextWidth = event.clientX - workspace.getBoundingClientRect().left;
    setSidebarWidth(clampSidebarWidth(nextWidth));
  };

  const handleResizePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
  };

  const handleDialogScroll = (target: HTMLElement) => {
    if (
      (!compactSidebar && !isNarrow) ||
      !dialogsQuery.hasNextPage ||
      dialogsQuery.isFetchingNextPage
    ) {
      return;
    }
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 80) {
      void dialogsQuery.fetchNextPage();
    }
  };

  const selectDialog = (userId: string) => {
    setSelectedUserId(userId);
    setSearchParams({ userId }, { replace: true });
    if (isNarrow) setNarrowPane("conversation");
  };

  const returnToDialogList = () => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("userId");
    setSearchParams(nextSearchParams, { replace: true });
    setNarrowPane("dialogs");
  };

  if (!nativeAvailable) {
    return (
      <Page>
        <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
          <div className="rounded-xl bg-nav-item px-5 py-12 text-center text-sm text-white/55">
            爱发电私信仅支持客户端。
          </div>
        </div>
      </Page>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <Page>
        <div className="flex items-center justify-center px-3 py-20 text-sm text-white/50 sm:px-5">
          <Spinner />
        </div>
      </Page>
    );
  }

  if (sessionQuery.isError) {
    return (
      <Page>
        <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
          <div className="rounded-xl bg-nav-item px-5 py-12 text-center text-sm text-white/55">
            {getAfdianErrorMessage(sessionQuery.error, "无法读取爱发电登录状态")}
          </div>
        </div>
      </Page>
    );
  }

  if (!connected) {
    return (
      <Page>
        <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-nav-item px-5 py-12 text-center">
            <p className="text-white/80">尚未登录爱发电</p>
            <p className="text-sm text-white/50">登录后即可查看私信对话。</p>
            <Button onClick={() => navigate("/settings")}>
              前往设置
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {dialogsQuery.isError ? (
          <div className="flex items-center justify-between px-4 py-3 text-sm text-white/60">
            <span>私信列表暂时无法加载</span>
            <Button variant="soft" onClick={() => void dialogsQuery.refetch()}>
              <ArrowClockwiseIcon size={14} />
              重试
            </Button>
          </div>
        ) : dialogsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-white/50">
            <Spinner />
          </div>
        ) : (
          <div
            ref={workspaceRef}
            className={isResizing ? "relative flex min-h-0 flex-1 select-none" : "relative flex min-h-0 flex-1"}
          >
            {!isDesktop && (
              <motion.section
                initial={false}
                animate={
                  isNarrow
                    ? { x: narrowPane === "dialogs" ? "0%" : "-100%" }
                    : { x: 0 }
                }
                transition={{ duration: 0.26, ease: NARROW_PANE_EASE }}
                aria-hidden={isNarrow && narrowPane !== "dialogs"}
                style={isNarrow ? undefined : { width: sidebarWidth }}
                className={`flex min-h-0 flex-col overflow-hidden ${isNarrow ? `absolute inset-0 w-full bg-[var(--app-background)] ${narrowPane === "dialogs" ? "" : "pointer-events-none"}` : "shrink-0"}`}
              >
                {!compactSidebar && (
                  <div className="flex shrink-0 items-center justify-between px-2 py-2">
                    <p className="text-sm font-medium text-white/80">全部对话</p>
                    {dialogsQuery.hasNextPage && (
                      <Button
                        size="1"
                        variant="ghost"
                        disabled={dialogsQuery.isFetchingNextPage}
                        onClick={() => void dialogsQuery.fetchNextPage()}
                      >
                        {dialogsQuery.isFetchingNextPage ? <Spinner size="1" /> : "加载更多"}
                      </Button>
                    )}
                  </div>
                )}
                <AfdianDialogList
                  items={dialogs}
                  selectedUserId={selectedUserId}
                  onSelect={selectDialog}
                  compact={compactSidebar}
                  onScroll={handleDialogScroll}
                />
              </motion.section>
            )}

            {!isDesktop && !isNarrow && (
              <div
                role="separator"
                aria-label="调整对话列表宽度"
                aria-orientation="vertical"
                aria-valuemin={SIDEBAR_MIN_WIDTH}
                aria-valuemax={SIDEBAR_MAX_WIDTH}
                aria-valuenow={sidebarWidth}
                tabIndex={0}
                className="group flex w-2 shrink-0 cursor-col-resize touch-none items-stretch justify-center outline-none"
                onPointerDown={handleResizePointerDown}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    setSidebarWidth((value) =>
                      Math.max(SIDEBAR_MIN_WIDTH, value - 16),
                    );
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    setSidebarWidth((value) =>
                      Math.min(SIDEBAR_MAX_WIDTH, value + 16),
                    );
                  }
                }}
              >
                <span className="my-3 w-px bg-white/10 transition-colors group-hover:bg-white/25 group-focus:bg-white/35" />
              </div>
            )}

            <motion.section
              initial={false}
              animate={
                isNarrow
                  ? { x: narrowPane === "conversation" ? "0%" : "100%" }
                  : { x: 0 }
              }
              transition={{ duration: 0.26, ease: NARROW_PANE_EASE }}
              aria-hidden={isNarrow && narrowPane !== "conversation"}
              className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${isNarrow ? `absolute inset-0 z-10 bg-[var(--app-background)] ${narrowPane === "conversation" ? "" : "pointer-events-none"}` : ""}`}
            >
              {selectedDialog && isNarrow ? (
                <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
                  {isNarrow && (
                    <Button
                      size="1"
                      variant="ghost"
                      aria-label="返回对话列表"
                      onClick={returnToDialogList}
                    >
                      <ArrowLeftIcon size={18} />
                    </Button>
                  )}
                  <Avatar
                    size="3"
                    radius="full"
                    src={selectedDialog.user.avatar ?? undefined}
                    fallback={selectedDialog.user.name.slice(0, 1) || "爱"}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white/90">
                      {selectedDialog.user.name}
                    </p>
                    <p className="text-xs text-white/40">
                      最近消息 {formatDateTime(selectedDialog.sentAt)}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="relative flex min-h-0 flex-1 flex-col">
                {messagesQuery.isLoading ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-white/50">
                    <Spinner />
                  </div>
                ) : messagesQuery.isError ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-white/50">
                    私信内容暂时无法加载
                  </div>
                ) : !selectedDialog ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-white/45">
                    请选择一个对话
                  </div>
                ) : (
                  <OverlayScrollbarsComponent
                    defer
                    ref={messagesViewportRef}
                    className="afdian-message-scroll min-h-0 flex-1"
                    style={
                      {
                        "--afdian-composer-height": `${composerHeight}px`,
                      } as CSSProperties
                    }
                    options={AUTO_HIDE_SCROLLBAR_OPTIONS}
                    events={messageScrollEvents}
                  >
                    <div className="flex min-h-full flex-col px-4 pb-[calc(var(--afdian-composer-height)+1rem)]">
                      {messagesQuery.hasNextPage && (
                        <Button
                          variant="ghost"
                          className="my-2 flex shrink-0 self-center"
                          disabled={messagesQuery.isFetchingNextPage}
                          onClick={() => void messagesQuery.fetchNextPage()}
                        >
                          {messagesQuery.isFetchingNextPage ? <Spinner size="1" /> : "加载更早消息"}
                        </Button>
                      )}
                      <div className="mt-auto flex flex-col gap-3 px-1 py-4 sm:px-3">
                        {visibleMessages.map((message) => (
                          <MessageBubble
                            key={message.id}
                            message={message}
                            avatar={selectedDialog.user.avatar}
                            fallback={selectedDialog.user.name.slice(0, 1) || "爱"}
                            usedRedemptionCode={redemptionOrderIds.has(message.id)}
                          />
                        ))}
                        {visibleMessages.length === 0 && (
                          <div className="flex flex-1 items-center justify-center text-sm text-white/45">
                            暂无消息内容
                          </div>
                        )}
                      </div>
                    </div>
                  </OverlayScrollbarsComponent>
                )}

                {selectedDialog && !messagesQuery.isLoading && (
                  <MessageComposer
                    value={draft}
                    error={sendError}
                    sending={isSending}
                    disabled={!draft.trim()}
                    sendShortcut={sendShortcut}
                    onSendShortcutChange={setSendShortcut}
                    onHeightChange={setComposerHeight}
                    onChange={(value) => {
                      setDraft(value);
                      if (sendError) setSendError("");
                    }}
                    onSend={() => void handleSend()}
                  />
                )}
              </div>
            </motion.section>
          </div>
        )}
      </div>
    </div>
  );
}
