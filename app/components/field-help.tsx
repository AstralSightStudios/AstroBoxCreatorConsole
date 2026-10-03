import { Button } from "@radix-ui/themes";
import { Dialog } from "~/components/ScaleAwareThemes";
import { ScrollArea } from "~/components/scroll-area";
import {
    ArrowSquareOutIcon,
    QuestionIcon,
} from "@phosphor-icons/react";

export interface FieldHelpLink {
    label: string;
    href: string;
}

export interface FieldHelpItem {
    label: string;
    description: string;
    links?: FieldHelpLink[];
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
                    <div className="flex flex-col gap-3 pr-1">
                        {items.map((item) => (
                            <div
                                key={item.label}
                                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
                            >
                                <div className="text-sm font-medium text-white/80">
                                    {item.label}
                                </div>
                                <div className="mt-0.5 text-[13px] leading-relaxed text-white/60">
                                    {item.description}
                                </div>
                                {item.links && item.links.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                        {item.links.map((link) => (
                                            <button
                                                key={link.href}
                                                type="button"
                                                onClick={() =>
                                                    openExternalUrl(link.href)
                                                }
                                                className="inline-flex items-center gap-1 text-[13px] text-sky-300 underline underline-offset-2 transition hover:text-sky-200"
                                            >
                                                <ArrowSquareOutIcon
                                                    size={12}
                                                    weight="bold"
                                                />
                                                {link.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
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
