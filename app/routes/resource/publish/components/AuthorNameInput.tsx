import { Button, Spinner, TextField } from "~/components/ScaleAwareThemes";
import { UserIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
    type AuthorSearchItem,
    searchAuthors,
} from "~/api/astrobox/profile";

/** 与 NG 首页创作者搜索一致的防抖时长。 */
const SEARCH_DEBOUNCE_MS = 250;
/** 与 NG 首页一致：创作者最多取 10 条。 */
const SEARCH_LIMIT = 10;
/** 服务端 `/account/search` 的 keyword 长度上限。 */
const MAX_KEYWORD_LENGTH = 128;

interface AuthorNameInputProps {
    value: string;
    placeholder: string;
    /** 是否启用创作者搜索。第一个作者固定为当前账号，不启用。 */
    enableSearch: boolean;
    disabled?: boolean;
    /** 普通输入（含第一个作者的改名确认逻辑）走这里。 */
    onChange: (value: string) => void;
    /** 从搜索结果点选一位创作者时触发。 */
    onPick: (author: AuthorSearchItem) => void;
}

function authorLabel(author: AuthorSearchItem): string {
    return author.displayName || author.username || author.userId;
}

function authorSubtitle(author: AuthorSearchItem): string {
    return [
        author.username ? `@${author.username}` : "",
        `${author.resourceCount} 个作品`,
    ]
        .filter(Boolean)
        .join(" · ");
}

/**
 * 作者名称输入框：输入时按显示名 / 用户名搜索 AstroBox 创作者（与 NG 首页同一接口），
 * 下拉候选复用「发布选择仓库」那套键盘导航与浮层样式。第一个作者不启用搜索。
 */
export function AuthorNameInput({
    value,
    placeholder,
    enableSearch,
    disabled,
    onChange,
    onPick,
}: AuthorNameInputProps) {
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [debouncedKeyword, setDebouncedKeyword] = useState("");
    const containerRef = useRef<HTMLDivElement | null>(null);

    const trimmedValue = value.trim();

    useEffect(() => {
        const timer = window.setTimeout(
            () => setDebouncedKeyword(trimmedValue),
            SEARCH_DEBOUNCE_MS,
        );
        return () => window.clearTimeout(timer);
    }, [trimmedValue]);

    const keyword = debouncedKeyword;
    const canSearch =
        enableSearch &&
        keyword.length > 0 &&
        keyword.length <= MAX_KEYWORD_LENGTH;

    const authorsQuery = useQuery({
        queryKey: ["astrobox", "author-search", keyword],
        queryFn: () => searchAuthors(keyword, SEARCH_LIMIT),
        enabled: canSearch,
        staleTime: 60_000,
        retry: false,
    });

    const results = authorsQuery.data?.authors ?? [];
    // 输入还在防抖窗口内（或尚未落到查询）时，先按「搜索中」处理，避免闪出旧结果。
    const pending = trimmedValue !== keyword;

    useEffect(() => {
        setActiveIndex(0);
    }, [keyword, suggestOpen]);

    const selectAuthor = (author: AuthorSearchItem) => {
        onPick(author);
        setSuggestOpen(false);
    };

    return (
        <div
            ref={containerRef}
            className="relative min-w-0 flex-1"
            onBlur={(e) => {
                if (
                    e.relatedTarget &&
                    containerRef.current?.contains(e.relatedTarget as Node)
                ) {
                    return;
                }
                setSuggestOpen(false);
            }}
        >
            <TextField.Root
                className="w-full"
                placeholder={placeholder}
                value={value}
                disabled={disabled}
                radius="large"
                onChange={(e) => {
                    onChange(e.target.value);
                    if (enableSearch) setSuggestOpen(true);
                }}
                onFocus={() => {
                    if (enableSearch) setSuggestOpen(true);
                }}
                onKeyDown={(e) => {
                    if (!suggestOpen || results.length === 0) return;
                    if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setActiveIndex((prev) =>
                            Math.min(prev + 1, results.length - 1),
                        );
                    } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setActiveIndex((prev) => Math.max(prev - 1, 0));
                    } else if (e.key === "Enter") {
                        const author = results[activeIndex];
                        if (author) {
                            e.preventDefault();
                            selectAuthor(author);
                        }
                    } else if (e.key === "Escape") {
                        setSuggestOpen(false);
                    }
                }}
            />
            {enableSearch && suggestOpen && (
                <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-white/10 bg-[#151517] p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                    <div className="max-h-64 overflow-y-auto">
                        {keyword.length === 0 ? (
                            <p className="py-6 text-center text-xs text-white/40">
                                输入显示名或用户名，可从 AstroBox 账号中选择
                            </p>
                        ) : keyword.length > MAX_KEYWORD_LENGTH ? (
                            <p className="py-6 text-center text-xs text-white/40">
                                关键词过长，请缩短后再搜索
                            </p>
                        ) : pending || authorsQuery.isFetching ? (
                            <div className="flex h-16 flex-col items-center justify-center gap-1.5 text-xs text-white/50">
                                <Spinner size="2" />
                                正在搜索创作者…
                            </div>
                        ) : authorsQuery.isError ? (
                            <div className="flex flex-col items-center gap-2 px-3 py-4 text-xs text-red-100">
                                <span className="break-all text-center">
                                    {authorsQuery.error instanceof Error
                                        ? authorsQuery.error.message
                                        : "搜索失败"}
                                </span>
                                <Button
                                    size="1"
                                    variant="soft"
                                    color="red"
                                    onClick={() => void authorsQuery.refetch()}
                                >
                                    重试
                                </Button>
                            </div>
                        ) : results.length === 0 ? (
                            <p className="py-6 text-center text-xs text-white/40">
                                没有匹配的创作者（仅限已有作品的 AstroBox 账号）
                            </p>
                        ) : (
                            <div className="flex flex-col gap-0.5">
                                {results.map((author, index) => (
                                    <button
                                        key={author.userId}
                                        type="button"
                                        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${
                                            index === activeIndex
                                                ? "bg-white/15"
                                                : "hover:bg-white/10"
                                        }`}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => selectAuthor(author)}
                                        onMouseEnter={() =>
                                            setActiveIndex(index)
                                        }
                                    >
                                        {author.avatar ? (
                                            <img
                                                src={author.avatar}
                                                alt=""
                                                className="size-8 shrink-0 rounded-full object-cover"
                                            />
                                        ) : (
                                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/50">
                                                <UserIcon size={14} />
                                            </span>
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm text-white">
                                                {authorLabel(author)}
                                            </span>
                                            <span className="block truncate text-[11px] text-white/40">
                                                {authorSubtitle(author)}
                                            </span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
