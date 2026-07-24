import {
    ArrowClockwiseIcon,
    CaretDownIcon,
    CaretUpIcon,
    ChatCircleTextIcon,
    HeartIcon,
} from "@phosphor-icons/react";
import { Button, Select, Spinner } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { CommunityApi, type CommentView } from "~/api/astrobox/community";
import {
    getCreatorCommentsSummary,
    listCreatorComments,
    type CreatorCommentItem,
    type CreatorCommentsResponse,
    type CreatorCommentsSummary,
} from "~/api/astrobox/interactions";
import DataCard from "~/components/cards/datacard";
import Page from "~/layout/page";
import { SectionCard } from "./resource/publish/components/shared";

const PAGE_SIZE = 20;
const CARD_CLASS = "!border-0 bg-nav-item";

function formatDateTime(value?: string | Date | null) {
    if (!value) return "--";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
}

function formatNumber(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) return "--";
    return value.toString();
}

// 服务端 detail 接口对非直接子回复会加 serveri18n 前缀，这里转成中文可读形式
function normalizeThreadContent(content: string) {
    return content.replace(/^serveri18n:replyTo\s*(@[^:]+):\s*/, "回复 $1：");
}

function ThreadBubble({
    comment,
    highlightedId,
}: {
    comment: CommentView;
    highlightedId: string;
}) {
    const highlighted = comment.id === highlightedId;
    return (
        <div
            className={`rounded-lg border px-3 py-2 ${
                highlighted
                    ? "border-amber-300/40 bg-amber-400/5"
                    : "border-white/10 bg-white/[0.03]"
            }`}
        >
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                {comment.senderAvatar && (
                    <img
                        src={comment.senderAvatar}
                        alt=""
                        className="h-5 w-5 rounded-full object-cover"
                    />
                )}
                <span className="text-white/80">
                    {comment.senderDisplayName || comment.senderId}
                </span>
                <span>{formatDateTime(comment.timestamp)}</span>
                {comment.senderLocation && <span>{comment.senderLocation}</span>}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-white/85">
                {normalizeThreadContent(comment.content)}
            </p>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-white/45">
                <HeartIcon size={12} />
                {comment.likes}
            </div>
        </div>
    );
}

function ThreadView({ comment }: { comment: CreatorCommentItem }) {
    const [thread, setThread] = useState<CommentView | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;
        const run = async () => {
            setLoading(true);
            setError("");
            try {
                // 回复从其父评论展开，根评论直接展开自己的子树
                const detail = await CommunityApi.comment.detail({
                    commentId: comment.parentId || comment.id,
                    pageSize: 50,
                });
                if (!active) return;
                setThread(detail);
            } catch (err) {
                if (!active) return;
                setError(err instanceof Error ? err.message : "加载对话失败");
            } finally {
                if (active) setLoading(false);
            }
        };

        void run();
        return () => {
            active = false;
        };
    }, [comment.id, comment.parentId]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-2 text-sm text-white/60">
                <Spinner size="1" />
                正在加载对话...
            </div>
        );
    }

    if (error) {
        return <p className="py-2 text-sm text-red-300">对话加载失败：{error}</p>;
    }

    if (!thread) {
        return <p className="py-2 text-sm text-white/50">该对话不存在或已被删除。</p>;
    }

    return (
        <div className="flex flex-col gap-2 border-l-2 border-white/10 pl-3">
            <ThreadBubble comment={thread} highlightedId={comment.id} />
            {thread.children.map((child) => (
                <ThreadBubble
                    key={child.id}
                    comment={child}
                    highlightedId={comment.id}
                />
            ))}
        </div>
    );
}

function CommentCard({ comment }: { comment: CreatorCommentItem }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="rounded-xl bg-black/20 px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                {comment.senderAvatar ? (
                    <img
                        src={comment.senderAvatar}
                        alt=""
                        className="h-6 w-6 rounded-full object-cover"
                    />
                ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[10px] text-white/60">
                        {(comment.senderDisplayName || "?").slice(0, 1)}
                    </div>
                )}
                <span className="text-sm text-white/85">
                    {comment.senderDisplayName || comment.senderId}
                </span>
                <span>{formatDateTime(comment.timestamp)}</span>
                {comment.senderLocation && <span>{comment.senderLocation}</span>}
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">
                    {comment.resourceName}
                </span>
            </div>

            {comment.replyTo && (
                <div className="mt-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-white/55">
                    回复 @{comment.replyTo.senderDisplayName}：
                    <span className="line-clamp-2">{comment.replyTo.content}</span>
                </div>
            )}

            <p className="mt-2 whitespace-pre-wrap text-sm text-white/90">
                {comment.content}
            </p>

            <div className="mt-2 flex items-center gap-3 text-xs text-white/50">
                <span className="flex items-center gap-1">
                    <HeartIcon size={13} />
                    {comment.likes}
                </span>
                <button
                    type="button"
                    className="flex items-center gap-1 text-blue-200 hover:underline"
                    onClick={() => setExpanded((value) => !value)}
                >
                    {expanded ? (
                        <>
                            <CaretUpIcon size={13} />
                            收起对话
                        </>
                    ) : (
                        <>
                            <CaretDownIcon size={13} />
                            查看对话
                        </>
                    )}
                </button>
            </div>

            {expanded && (
                <div className="mt-2.5">
                    <ThreadView comment={comment} />
                </div>
            )}
        </div>
    );
}

export default function Interactions() {
    const [summary, setSummary] = useState<CreatorCommentsSummary | null>(null);
    const [summaryError, setSummaryError] = useState("");
    const [selectedResourceId, setSelectedResourceId] = useState("");
    const [page, setPage] = useState(1);
    const [data, setData] = useState<CreatorCommentsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        let active = true;
        const run = async () => {
            setSummaryError("");
            try {
                const result = await getCreatorCommentsSummary();
                if (!active) return;
                setSummary(result);
            } catch (err) {
                if (!active) return;
                setSummary(null);
                setSummaryError(
                    err instanceof Error ? err.message : "加载互动概况失败",
                );
            }
        };

        void run();
        return () => {
            active = false;
        };
    }, [refreshKey]);

    useEffect(() => {
        let active = true;
        const run = async () => {
            setLoading(true);
            setError("");
            try {
                const result = await listCreatorComments({
                    resourceId: selectedResourceId || undefined,
                    page,
                    pageSize: PAGE_SIZE,
                });
                if (!active) return;
                setData(result);
            } catch (err) {
                if (!active) return;
                setData(null);
                setError(err instanceof Error ? err.message : "加载评论失败");
            } finally {
                if (active) setLoading(false);
            }
        };

        void run();
        return () => {
            active = false;
        };
    }, [page, refreshKey, selectedResourceId]);

    const totalPages = useMemo(() => {
        if (!data || data.total <= 0) return 1;
        return Math.max(1, Math.ceil(data.total / data.pageSize));
    }, [data]);

    const selectedResource = useMemo(
        () =>
            summary?.resources.find(
                (resource) => resource.resourceId === selectedResourceId,
            ) ?? null,
        [selectedResourceId, summary],
    );

    return (
        <Page>
            <div className="flex items-center gap-3 px-2 pt-2.5">
                <div className="min-w-0 flex-1">
                    <Select.Root
                        value={selectedResourceId || "__all_resources__"}
                        onValueChange={(value) => {
                            setSelectedResourceId(
                                value === "__all_resources__" ? "" : value,
                            );
                            setPage(1);
                        }}
                    >
                        <Select.Trigger
                            radius="large"
                            placeholder="选择资源"
                            className="w-full"
                        />
                        <Select.Content position="popper">
                            <Select.Item value="__all_resources__">
                                全部资源
                            </Select.Item>
                            {(summary?.resources ?? []).map((resource) => (
                                <Select.Item
                                    key={resource.resourceId}
                                    value={resource.resourceId}
                                >
                                    {resource.resourceName} ({resource.total})
                                </Select.Item>
                            ))}
                        </Select.Content>
                    </Select.Root>
                </div>
                <Button
                    variant="ghost"
                    color="gray"
                    className="shrink-0"
                    onClick={() => setRefreshKey((value) => value + 1)}
                >
                    <ArrowClockwiseIcon size={15} />
                    刷新
                </Button>
            </div>

            <div className="grid gap-3.5 px-2 pt-3 pb-6">
                {summaryError && (
                    <p className="px-2 text-sm text-red-300">
                        互动概况加载失败：{summaryError}
                    </p>
                )}

                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    <DataCard label="总评论数">
                        <p className="card-num">
                            {formatNumber(
                                selectedResource ? selectedResource.total : summary?.total,
                            )}
                        </p>
                    </DataCard>
                    <DataCard label="近 7 日新增">
                        <p className="card-num">
                            {formatNumber(
                                selectedResource ? selectedResource.last7d : summary?.last7d,
                            )}
                        </p>
                    </DataCard>
                    <DataCard label="近 30 日新增">
                        <p className="card-num">
                            {formatNumber(
                                selectedResource
                                    ? selectedResource.last30d
                                    : summary?.last30d,
                            )}
                        </p>
                    </DataCard>
                    <DataCard label="有评论的资源">
                        <p className="card-num">
                            {formatNumber(summary?.resources.length)}
                        </p>
                    </DataCard>
                </div>

                <SectionCard
                    title="评论时间线"
                    description="你名下资源收到的评论与回复，按时间倒序"
                    className={CARD_CLASS}
                >
                    {loading && (
                        <div className="flex items-center gap-2 px-1.5 pb-3 text-sm text-white/60">
                            <Spinner size="1" />
                            正在加载评论...
                        </div>
                    )}
                    {!loading && error && (
                        <p className="px-1.5 pb-3 text-sm text-red-300">
                            评论加载失败：{error}
                        </p>
                    )}
                    {!loading && !error && (data?.comments.length ?? 0) === 0 && (
                        <div className="flex flex-col items-center gap-2 px-1.5 py-8 text-white/50">
                            <ChatCircleTextIcon size={28} />
                            <p className="text-sm">还没有收到评论</p>
                        </div>
                    )}
                    {!loading && !error && (data?.comments.length ?? 0) > 0 && (
                        <div className="flex flex-col gap-2 px-1.5 pb-2">
                            {data!.comments.map((comment) => (
                                <CommentCard key={comment.id} comment={comment} />
                            ))}

                            <div className="flex items-center justify-between pt-1.5">
                                <Button
                                    variant="soft"
                                    color="gray"
                                    disabled={page <= 1 || loading}
                                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                                >
                                    上一页
                                </Button>
                                <span className="text-xs text-white/55">
                                    第 {data!.page} / {totalPages} 页 · 共 {data!.total} 条
                                </span>
                                <Button
                                    variant="soft"
                                    color="gray"
                                    disabled={page >= totalPages || loading}
                                    onClick={() =>
                                        setPage((value) => Math.min(totalPages, value + 1))
                                    }
                                >
                                    下一页
                                </Button>
                            </div>
                        </div>
                    )}
                </SectionCard>
            </div>
        </Page>
    );
}
