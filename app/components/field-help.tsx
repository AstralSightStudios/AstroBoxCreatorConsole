import { Button } from "@radix-ui/themes";
import { Dialog } from "~/components/ScaleAwareThemes";
import { ScrollArea } from "~/components/scroll-area";
import {
    ArrowSquareOutIcon,
    QuestionIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

export interface FieldHelpLink {
    label: string;
    href: string;
}

export interface FieldHelpItem {
    label: string;
    description: string;
    links?: FieldHelpLink[];
    /** 条目标题左侧的图标，建议 16px、weight="duotone"。 */
    icon?: ReactNode;
    /**
     * 分组名。相邻且同名的条目归入同一分区，分区之间显示小标题；
     * 不填则沿用原来的连续卡片列表。
     */
    group?: string;
}

/** 把相邻同名 group 的条目聚成一个个分区。 */
function groupHelpItems(items: FieldHelpItem[]) {
    const groups: Array<{ title?: string; items: FieldHelpItem[] }> = [];
    for (const item of items) {
        const last = groups[groups.length - 1];
        if (last && last.title === item.group) {
            last.items.push(item);
        } else {
            groups.push({ title: item.group, items: [item] });
        }
    }
    return groups;
}

/** 卡片头部的字段说明圆钮，配合 FieldHelpDialog 使用。 */
export function FieldHelpButton({
    onClick,
    title,
}: {
    onClick: () => void;
    title: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={title}
            title={title}
            className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/60 transition hover:bg-white/10 hover:text-white"
        >
            <QuestionIcon size={14} weight="bold" />
        </button>
    );
}

/** Tauri 下走系统浏览器打开，纯浏览器环境退回 window.open。 */
function openExternalUrl(href: string) {
    void import("@tauri-apps/plugin-opener")
        .then(({ openUrl }) => openUrl(href))
        .catch(() => window.open(href, "_blank", "noopener,noreferrer"));
}

export function FieldHelpDialog({
    open,
    onOpenChange,
    title,
    items,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    items: FieldHelpItem[];
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Content maxWidth="520px">
                <Dialog.Title>{title}</Dialog.Title>
                <ScrollArea className="mt-3 max-h-[var(--ui-viewport-height-56pct)]">
                    <div className="flex flex-col gap-4 pr-1">
                        {groupHelpItems(items).map((group, groupIndex) => (
                            <section
                                key={`${group.title ?? "group"}-${groupIndex}`}
                                className="flex flex-col gap-2"
                            >
                                {group.title && (
                                    <div className="flex items-center gap-2 px-0.5">
                                        <span className="shrink-0 text-[11px] font-medium tracking-wider text-white/40">
                                            {group.title}
                                        </span>
                                        <span className="h-px flex-1 bg-white/10" />
                                    </div>
                                )}
                                <div className="flex flex-col gap-2">
                                    {group.items.map((item, itemIndex) => (
                                        <div
                                            key={`${item.label}-${itemIndex}`}
                                            className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3"
                                        >
                                            {item.icon && (
                                                <span className="mt-0.5 shrink-0 text-white/45">
                                                    {item.icon}
                                                </span>
                                            )}
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-white/85">
                                                    {item.label}
                                                </div>
                                                <div className="mt-0.5 text-[13px] leading-relaxed text-white/60">
                                                    {item.description}
                                                </div>
                                                {item.links &&
                                                    item.links.length > 0 && (
                                                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                                            {item.links.map(
                                                                (link) => (
                                                                    <button
                                                                        key={
                                                                            link.href
                                                                        }
                                                                        type="button"
                                                                        onClick={() =>
                                                                            openExternalUrl(
                                                                                link.href,
                                                                            )
                                                                        }
                                                                        className="inline-flex items-center gap-1 text-[13px] text-sky-300 underline underline-offset-2 transition hover:text-sky-200"
                                                                    >
                                                                        <ArrowSquareOutIcon
                                                                            size={
                                                                                12
                                                                            }
                                                                            weight="bold"
                                                                        />
                                                                        {
                                                                            link.label
                                                                        }
                                                                    </button>
                                                                ),
                                                            )}
                                                        </div>
                                                    )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                </ScrollArea>
                <div className="mt-4 flex justify-end">
                    <Dialog.Close>
                        <Button variant="soft" color="gray">
                            关闭
                        </Button>
                    </Dialog.Close>
                </div>
            </Dialog.Content>
        </Dialog.Root>
    );
}
