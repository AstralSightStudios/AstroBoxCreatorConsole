import {
    ArrowClockwiseIcon,
    CaretLeftIcon,
    ChatsCircleIcon,
    CheckCircleIcon,
    DeviceMobileIcon,
    ImageIcon,
    PaperPlaneRightIcon,
    XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    BetaApi,
    resolveBetaUrl,
    uploadBetaFile,
    type BetaMessage,
    type BetaThread,
    type BetaThreadDetail,
    type BetaUploadedFile,
} from "~/api/astrobox/beta";
import { Badge, Button, Dialog, SegmentedControl, Spinner, Text, TextArea } from "~/components/ScaleAwareThemes";
import { pickFiles } from "~/logic/publish/file-picker";
import { Avatar, describeBetaError, displayNameOf, formatDateTime, formatRelative } from "./shared";

const MAX_ATTACHMENTS = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type Filter = "all" | "open" | "resolved";

type PendingImage = {
    key: string;
    file: File;
    preview: string;
    uploaded: BetaUploadedFile | null;
    failed: boolean;
};

export default function FeedbackPanel({
    programId,
    initialThreadId,
    onUnreadChanged,
}: {
    programId: string;
    initialThreadId?: string | null;
    onUnreadChanged?: () => void;
}) {
    const [filter, setFilter] = useState<Filter>("open");
    const [threads, setThreads] = useState<BetaThread[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(initialThreadId ?? null);

    const load = useCallback(
        async (nextPage = 1) => {
            setError("");
            try {
                const data = await BetaApi.listThreads(programId, {
                    status: filter === "all" ? undefined : filter,
                    page: nextPage,
                    pageSize: 20,
                });
                setThreads((current) => (nextPage === 1 ? data.threads : [...current, ...data.threads]));
                setTotal(data.total);
                setPage(nextPage);
            } catch (err) {
                setError(describeBetaError(err, "加载反馈失败"));
            } finally {
                setLoading(false);
            }
        },
        [programId, filter],
    );

    useEffect(() => {
        setLoading(true);
        void load(1);
    }, [load]);

    useEffect(() => {
        if (initialThreadId) setSelectedId(initialThreadId);
    }, [initialThreadId]);

    const markLocallyRead = useCallback(
        (threadId: string) => {
            setThreads((current) => current.map((item) => (item.id === threadId ? { ...item, unread: false } : item)));
            onUnreadChanged?.();
        },
        [onUnreadChanged],
    );

    const updateThread = useCallback((thread: BetaThread) => {
        setThreads((current) => current.map((item) => (item.id === thread.id ? thread : item)));
    }, []);

    return (
        <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className={`flex min-w-0 flex-col gap-2 ${selectedId ? "hidden lg:flex" : "flex"}`}>
                <div className="flex items-center gap-2">
                    <SegmentedControl.Root
                        value={filter}
                        onValueChange={(value) => setFilter(value as Filter)}
                        size="1"
                        className="flex-1"
                    >
                        <SegmentedControl.Item value="open">待处理</SegmentedControl.Item>
                        <SegmentedControl.Item value="resolved">已解决</SegmentedControl.Item>
                        <SegmentedControl.Item value="all">全部</SegmentedControl.Item>
                    </SegmentedControl.Root>
                    <Button size="1" variant="ghost" color="gray" onClick={() => void load(1)} aria-label="刷新">
                        <ArrowClockwiseIcon size={15} />
                    </Button>
                </div>
                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-white/60">
                        <Spinner size="2" />
                        正在加载反馈...
                    </div>
                ) : error ? (
                    <p className="py-4 text-sm text-red-300">{error}</p>
                ) : threads.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-[14px] bg-nav-item py-10 text-sm text-white/50">
                        <ChatsCircleIcon size={28} />
                        {filter === "open" ? "没有待处理的反馈" : "还没有反馈"}
                    </div>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {threads.map((thread) => (
                            <button
                                key={thread.id}
                                type="button"
                                onClick={() => setSelectedId(thread.id)}
                                className={`flex flex-col gap-1 rounded-[12px] border px-3 py-2.5 text-left transition ${
                                    selectedId === thread.id
                                        ? "border-white/25 bg-white/[0.07]"
                                        : "border-transparent bg-nav-item hover:bg-white/[0.05]"
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    {thread.unread && <span className="size-2 shrink-0 rounded-full bg-sky-400" />}
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{thread.title}</span>
                                    {thread.status === "resolved" && (
                                        <CheckCircleIcon size={14} weight="fill" className="shrink-0 text-emerald-300" />
                                    )}
                                </div>
                                <p className="line-clamp-2 text-xs text-white/55">
                                    {thread.lastSenderRole === "author" ? "你：" : ""}
                                    {thread.lastMessagePreview}
                                </p>
                                <div className="flex items-center gap-1.5 text-[11px] text-white/40">
                                    <span className="truncate">{displayNameOf(thread.tester)}</span>
                                    {thread.buildVersion && <span>· {thread.buildVersion}</span>}
                                    <span className="ml-auto shrink-0">{formatRelative(thread.lastMessageAt)}</span>
                                </div>
                            </button>
                        ))}
                        {threads.length < total && (
                            <Button variant="soft" color="gray" onClick={() => void load(page + 1)}>
                                加载更多
                            </Button>
                        )}
                    </div>
                )}
            </div>

            <div className={`min-w-0 ${selectedId ? "block" : "hidden lg:block"}`}>
                {selectedId ? (
                    <ThreadView
                        key={selectedId}
                        programId={programId}
                        threadId={selectedId}
                        onBack={() => setSelectedId(null)}
                        onRead={markLocallyRead}
                        onThreadChanged={updateThread}
                    />
                ) : (
                    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-[14px] bg-nav-item text-sm text-white/45">
                        <ChatsCircleIcon size={30} />
                        选择一条反馈查看对话
                    </div>
                )}
            </div>
        </div>
    );
}

function ThreadView({
    programId,
    threadId,
    onBack,
    onRead,
    onThreadChanged,
}: {
    programId: string;
    threadId: string;
    onBack: () => void;
    onRead: (threadId: string) => void;
    onThreadChanged: (thread: BetaThread) => void;
}) {
    const [detail, setDetail] = useState<BetaThreadDetail | null>(null);
    const [error, setError] = useState("");
    const [lightbox, setLightbox] = useState<BetaUploadedFile | null>(null);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        setError("");
        try {
            const data = await BetaApi.getThread(threadId);
            setDetail(data);
            onRead(threadId);
        } catch (err) {
            setError(describeBetaError(err, "加载对话失败"));
        }
    }, [threadId, onRead]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: "nearest" });
    }, [detail?.messages.length]);

    const toggleStatus = async () => {
        if (!detail || updatingStatus) return;
        const next = detail.thread.status === "open" ? "resolved" : "open";
        setUpdatingStatus(true);
        try {
            await BetaApi.setThreadStatus(threadId, next);
            const thread = { ...detail.thread, status: next } as BetaThread;
            setDetail({ ...detail, thread });
            onThreadChanged(thread);
        } catch (err) {
            toast.error(describeBetaError(err));
        } finally {
            setUpdatingStatus(false);
        }
    };

    const appendMessage = (message: BetaMessage) => {
        if (!detail) return;
        const thread: BetaThread = {
            ...detail.thread,
            messageCount: detail.thread.messageCount + 1,
            lastMessageAt: message.createdAt,
            lastMessagePreview: message.body || "[图片]",
            lastSenderRole: "author",
        };
        setDetail({ ...detail, thread, messages: [...detail.messages, message] });
        onThreadChanged(thread);
    };

    if (error) {
        return (
            <div className="flex flex-col gap-3 rounded-[14px] bg-nav-item p-4 text-sm text-red-300">
                {error}
                <div className="flex gap-2">
                    <Button size="1" variant="soft" color="gray" onClick={onBack}>
                        返回
                    </Button>
                    <Button size="1" variant="soft" onClick={() => void load()}>
                        重试
                    </Button>
                </div>
            </div>
        );
    }

    if (!detail) {
        return (
            <div className="flex items-center gap-2 rounded-[14px] bg-nav-item p-4 text-sm text-white/60">
                <Spinner size="2" />
                正在加载对话...
            </div>
        );
    }

    const { thread, messages } = detail;
    const device = thread.device;

    return (
        <div className="flex flex-col gap-3 rounded-[14px] bg-nav-item p-3">
            <div className="flex items-start gap-2">
                <Button size="1" variant="ghost" color="gray" className="lg:hidden!" onClick={onBack}>
                    <CaretLeftIcon size={15} />
                </Button>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="min-w-0 truncate text-base font-medium text-white">{thread.title}</h3>
                        <Badge color={thread.status === "open" ? "amber" : "green"} variant="soft" size="1">
                            {thread.status === "open" ? "待处理" : "已解决"}
                        </Badge>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/45">
                        <span>{displayNameOf(thread.tester)}</span>
                        {thread.buildVersion && <span>测试版本 {thread.buildVersion}</span>}
                        <span>{formatDateTime(thread.createdAt)}</span>
                    </p>
                    {device && (device.name || device.model) && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-white/45">
                            <DeviceMobileIcon size={12} />
                            {[device.name, device.model, device.firmware && `固件 ${device.firmware}`, device.platform, device.appVersion && `AstroBox ${device.appVersion}`]
                                .filter(Boolean)
                                .join(" · ")}
                        </p>
                    )}
                </div>
                <Button size="1" variant="soft" color="gray" loading={updatingStatus} onClick={() => void toggleStatus()}>
                    {thread.status === "open" ? "标记已解决" : "重新打开"}
                </Button>
            </div>

            <div className="flex max-h-[560px] flex-col gap-2.5 overflow-y-auto pr-1">
                {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} onOpenImage={setLightbox} />
                ))}
                <div ref={bottomRef} />
            </div>

            <Composer programId={programId} threadId={threadId} onSent={appendMessage} />

            <Dialog.Root open={Boolean(lightbox)} onOpenChange={(open) => !open && setLightbox(null)}>
                <Dialog.Content maxWidth="min(92vw, 1100px)" className="p-2!">
                    <Dialog.Title className="sr-only">图片预览</Dialog.Title>
                    {lightbox && (
                        <img
                            src={resolveBetaUrl(lightbox.url)}
                            alt=""
                            className="max-h-[82vh] w-full rounded-[10px] object-contain"
                        />
                    )}
                </Dialog.Content>
            </Dialog.Root>
        </div>
    );
}

function MessageBubble({
    message,
    onOpenImage,
}: {
    message: BetaMessage;
    onOpenImage: (file: BetaUploadedFile) => void;
}) {
    const mine = message.role === "author";
    return (
        <div className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
            <Avatar profile={message.sender} size={28} />
            <div className={`flex min-w-0 max-w-[80%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-1.5 text-[11px] text-white/45">
                    <span>{mine ? "你" : displayNameOf(message.sender)}</span>
                    <span>{formatRelative(message.createdAt)}</span>
                </div>
                {message.body && (
                    <p
                        className={`whitespace-pre-wrap break-words rounded-[12px] px-3 py-2 text-sm ${
                            mine ? "bg-sky-500/20 text-white" : "bg-white/[0.06] text-white/90"
                        }`}
                    >
                        {message.body}
                    </p>
                )}
                {message.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {message.attachments.map((file) => (
                            <button
                                key={file.id}
                                type="button"
                                onClick={() => onOpenImage(file)}
                                className="overflow-hidden rounded-[10px] border border-white/10 bg-black/30"
                            >
                                <img
                                    src={resolveBetaUrl(file.url)}
                                    alt=""
                                    loading="lazy"
                                    className="h-28 max-w-[220px] object-cover"
                                />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function Composer({
    programId,
    threadId,
    onSent,
}: {
    programId: string;
    threadId: string;
    onSent: (message: BetaMessage) => void;
}) {
    const [body, setBody] = useState("");
    const [images, setImages] = useState<PendingImage[]>([]);
    const [sending, setSending] = useState(false);
    const imagesRef = useRef(images);
    imagesRef.current = images;

    useEffect(
        () => () => {
            imagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview));
        },
        [],
    );

    const addImages = async () => {
        const files = await pickFiles({ accept: "png,jpg,jpeg,webp,gif", multiple: true, title: "选择图片" });
        const room = MAX_ATTACHMENTS - images.length;
        const accepted = files.filter((file) => file.size <= MAX_IMAGE_BYTES).slice(0, room);
        if (files.length > accepted.length) {
            toast.warning(`每条最多 ${MAX_ATTACHMENTS} 张，单张不超过 10 MB`);
        }
        setImages((current) => [
            ...current,
            ...accepted.map((file) => ({
                key: Math.random().toString(36).slice(2),
                file,
                preview: URL.createObjectURL(file),
                uploaded: null,
                failed: false,
            })),
        ]);
    };

    const removeImage = (key: string) => {
        setImages((current) => {
            const target = current.find((image) => image.key === key);
            if (target) URL.revokeObjectURL(target.preview);
            return current.filter((image) => image.key !== key);
        });
    };

    const canSend = useMemo(() => (body.trim().length > 0 || images.length > 0) && !sending, [body, images, sending]);

    const send = async () => {
        if (!canSend) return;
        setSending(true);
        try {
            const ids: string[] = [];
            for (const image of imagesRef.current) {
                if (image.uploaded) {
                    ids.push(image.uploaded.id);
                    continue;
                }
                try {
                    const uploaded = await uploadBetaFile(programId, "image", image.file);
                    ids.push(uploaded.id);
                    setImages((current) =>
                        current.map((item) => (item.key === image.key ? { ...item, uploaded, failed: false } : item)),
                    );
                } catch (error) {
                    setImages((current) => current.map((item) => (item.key === image.key ? { ...item, failed: true } : item)));
                    throw error;
                }
            }
            const message = await BetaApi.reply(threadId, body.trim(), ids);
            onSent(message);
            setBody("");
            imagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview));
            setImages([]);
        } catch (error) {
            toast.error(`发送失败：${describeBetaError(error)}`);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
            {images.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {images.map((image) => (
                        <div
                            key={image.key}
                            className={`relative size-16 overflow-hidden rounded-[10px] border ${
                                image.failed ? "border-red-400/70" : "border-white/10"
                            }`}
                        >
                            <img src={image.preview} alt="" className="h-full w-full object-cover" />
                            {!sending && (
                                <button
                                    type="button"
                                    onClick={() => removeImage(image.key)}
                                    className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
                                    aria-label="移除图片"
                                >
                                    <XIcon size={11} weight="bold" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
            <TextArea
                value={body}
                rows={3}
                maxLength={4000}
                disabled={sending}
                placeholder="回复测试者（Ctrl/⌘ + Enter 发送）"
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        void send();
                    }
                }}
            />
            <div className="flex items-center justify-between">
                <Button
                    variant="ghost"
                    color="gray"
                    disabled={sending || images.length >= MAX_ATTACHMENTS}
                    onClick={() => void addImages()}
                >
                    <ImageIcon size={16} />
                    图片
                </Button>
                <div className="flex items-center gap-2">
                    <Text size="1" color="gray">
                        对方会在 AstroBox 信箱收到提醒
                    </Text>
                    <Button loading={sending} disabled={!canSend} onClick={() => void send()}>
                        <PaperPlaneRightIcon size={15} />
                        发送
                    </Button>
                </div>
            </div>
        </div>
    );
}
