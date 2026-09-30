import {
    MagnifyingGlassIcon,
    MinusIcon,
    PlusIcon,
} from "@phosphor-icons/react";
import {
    Button,
    Dialog,
    TextField,
} from "~/components/ScaleAwareThemes";
import {
    type Dispatch,
    type SetStateAction,
    useMemo,
    useState,
} from "react";
import { type LinkInput } from "./types";
import {
    type FieldHelpItem,
    FieldHelpButton,
    FieldHelpDialog,
    SectionCard,
} from "./shared";
import { PHOSPHOR_LINK_ICON_NAMES } from "~/logic/publish/phosphor-link-icon";
import {
    PhosphorIconByName,
    phosphorIconNameToPascal,
} from "~/components/phosphor-icon";
import { normalizeLinkUrl } from "~/logic/publish/validation";
import { log } from "~/logic/logging";
import { logFieldChange } from "~/logic/logging/publish-flow";

const LINK_FIELD_HELP: FieldHelpItem[] = [
    {
        label: "图标、标题、网址",
        description:
            "三项都必须填写，缺任意一项都无法提交。只要填了其中任意一项，这一行就会参与校验；反过来，三项都留空的行会被自动忽略，不会写进资源。",
    },
    {
        label: "图标",
        description:
            "从 Phosphor 图标库里挑一个代表该链接的图标，例如 github、globe、chat、book。未选择时按钮显示为虚线框，提交前必须补上。",
    },
    {
        label: "标题",
        description: "链接的显示名称，例如「项目主页」「使用文档」「交流群」。",
    },
    {
        label: "网址",
        description:
            "必须是有效的 HTTPS 地址。带反引号或尖括号包裹的内容会自动去除，可直接粘贴 Markdown 里的链接写法。QQ 群也可以作为链接：先获取 QQ 群邀请二维码，用手机扫码后即可得到群链接，再填进来。",
    },
];

function isSubsequence(needle: string, haystack: string): boolean {
    let cursor = 0;
    for (const char of needle) {
        cursor = haystack.indexOf(char, cursor);
        if (cursor < 0) return false;
        cursor += 1;
    }
    return true;
}

const preferredExact = new Set([
    "link",
    "link-simple",
    "github-logo",
    "gitlab-logo",
    "git-pull-request",
    "globe",
    "globe-simple",
    "code",
    "terminal",
    "book",
    "book-open",
    "article",
    "newspaper",
    "rss",
    "download",
    "download-simple",
    "cloud-arrow-down",
    "package",
    "telegram-logo",
    "discord-logo",
    "youtube-logo",
    "x-logo",
    "twitter-logo",
    "instagram-logo",
    "facebook-logo",
    "wechat-logo",
    "whatsapp-logo",
    "envelope",
    "envelope-simple",
    "chat",
    "chat-circle",
    "notion-logo",
    "figma-logo",
    "medium-logo",
    "dev-to-logo",
    "open-ai-logo",
]);

const preferredTokens = [
    "link",
    "git",
    "repo",
    "github",
    "gitlab",
    "code",
    "terminal",
    "web",
    "globe",
    "site",
    "blog",
    "book",
    "article",
    "news",
    "docs",
    "read",
    "rss",
    "download",
    "cloud",
    "package",
    "message",
    "chat",
    "mail",
    "envelope",
    "social",
    "telegram",
    "discord",
    "youtube",
    "twitter",
    "instagram",
    "facebook",
    "wechat",
    "whatsapp",
    "notion",
    "figma",
    "medium",
    "dev",
    "stack",
    "open-ai",
];

function iconBaseScore(name: string): number {
    let score = 0;
    if (preferredExact.has(name)) score += 800;
    for (const token of preferredTokens) {
        if (name.includes(token)) score += 40;
    }
    return score;
}

function iconMatchScore(name: string, pascalName: string, token: string): number {
    const normalized = token.toLowerCase();
    if (name === normalized) return 300;
    if (name.startsWith(normalized)) return 180;
    if (pascalName.toLowerCase().startsWith(normalized)) return 170;
    if (name.includes(normalized)) return 120;
    if (isSubsequence(normalized, name)) return 60;
    return 0;
}

function searchIcons(names: readonly string[], rawQuery: string): string[] {
    const query = rawQuery.trim().toLowerCase();
    const tokens = query.split(/[\s-]+/).filter(Boolean);
    if (tokens.length === 0) {
        return [...names].sort(
            (a, b) =>
                iconBaseScore(b) - iconBaseScore(a) || a.localeCompare(b),
        );
    }
    return names
        .map((name) => {
            const pascalName = phosphorIconNameToPascal(name);
            const matchScore = tokens.reduce(
                (sum, token) => sum + iconMatchScore(name, pascalName, token),
                0,
            );
            return {
                name,
                score: matchScore + iconBaseScore(name),
                matched: tokens.every(
                    (token) => iconMatchScore(name, pascalName, token) > 0,
                ),
            };
        })
        .filter((option) => option.matched)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .map((option) => option.name);
}

interface LinksSectionProps {
    links: LinkInput[];
    setLinks: Dispatch<SetStateAction<LinkInput[]>>;
}

export function LinksSection({ links, setLinks }: LinksSectionProps) {
    const [iconPickerIndex, setIconPickerIndex] = useState<number | null>(null);
    const [iconQuery, setIconQuery] = useState("");
    const [helpOpen, setHelpOpen] = useState(false);

    const filteredIcons = useMemo(
        () => searchIcons(PHOSPHOR_LINK_ICON_NAMES, iconQuery),
        [iconQuery],
    );

    const visibleIcons = useMemo(() => {
        if (iconQuery.trim()) return filteredIcons;
        return filteredIcons.slice(0, 240);
    }, [filteredIcons, iconQuery]);

    return (
        <SectionCard
            title="外部链接"
            description="外链用于补充官网、文档、社区等入口。"
            headerExtra={
                <div className="flex items-center gap-1.5">
                    <FieldHelpButton
                        onClick={() => setHelpOpen(true)}
                        title="外部链接字段说明"
                    />
                    <Button
                        type="button"
                        variant="soft"
                        size="1"
                        className="text-xs!"
                        onClick={() => {
                            log.info("form/links", "添加外部链接");
                            setLinks((prev) => [
                                ...prev,
                                { icon: "", title: "", url: "" },
                            ]);
                        }}
                    >
                        <PlusIcon size={14} weight="bold" />
                        添加链接
                    </Button>
                </div>
            }
        >
            {links.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
                    还未添加外部链接
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {links.map((link, index) => {
                        return (
                          <div
                              key={`links-${index}`}
                              className="flex flex-col gap-2.5 rounded-lg border border-white/10 bg-black/20 p-2.5"
                          >
                                <div className="flex items-center gap-2">
                                    <span className="shrink-0 text-xs font-medium text-white/55">
                                        链接 {index + 1}
                                    </span>
                                    {link.icon && (
                                        <span className="shrink-0 text-xs text-white/40">
                                            {link.icon}
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        aria-label={`删除链接 ${index + 1}`}
                                        title="删除"
                                        className="ml-auto shrink-0 rounded-lg p-1 text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
                                        onClick={() => {
                                            log.info("form/links", "移除外部链接", {
                                                data: {
                                                    title:
                                                        link.title ||
                                                        `#${index + 1}`,
                                                    url: link.url,
                                                },
                                            });
                                            setLinks((prev) =>
                                                prev.filter(
                                                    (_, idx) => idx !== index,
                                                ),
                                            );
                                        }}
                                    >
                                        <MinusIcon size={16} weight="bold" />
                                    </button>
                                </div>

                                <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2">
                                    <div className="flex items-center gap-2 lg:contents">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIconQuery("");
                                                setIconPickerIndex(index);
                                            }}
                                            aria-label={
                                                link.icon
                                                    ? `更换图标（当前 ${link.icon}）`
                                                    : "选择图标（必填）"
                                            }
                                            title={
                                                link.icon
                                                    ? `当前图标 ${link.icon}，点击更换`
                                                    : "选择图标（必填）"
                                            }
                                            className={`grid size-8 shrink-0 place-items-center rounded-lg transition ${
                                                link.icon
                                                    ? "border border-white/15 bg-white/[0.06] text-white hover:bg-white/10"
                                                    : "border border-dashed border-white/40 text-white/70 hover:border-white/70 hover:text-white"
                                            }`}
                                        >
                                            {link.icon ? (
                                                <PhosphorIconByName
                                                    name={link.icon}
                                                    size={16}
                                                    className="text-white"
                                                />
                                            ) : (
                                                <PlusIcon
                                                    size={16}
                                                    weight="bold"
                                                />
                                            )}
                                        </button>
                                        <div className="min-w-0 flex-1 lg:grow lg:shrink lg:basis-[240px]">
                                            <TextField.Root
                                                placeholder="标题"
                                                value={link.title}
                                                radius="large"
                                                onChange={(e) => {
                                                    logFieldChange(
                                                        `link-title-${index}`,
                                                        `链接标题(#${index + 1})`,
                                                        e.target.value,
                                                    );
                                                    setLinks((prev) =>
                                                        prev.map((item, idx) =>
                                                            idx === index
                                                                ? {
                                                                      ...item,
                                                                      title: e.target
                                                                          .value,
                                                                  }
                                                                : item,
                                                        ),
                                                    );
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="min-w-0 lg:grow lg:shrink lg:basis-[320px]">
                                        <TextField.Root
                                            type="url"
                                            placeholder="https://example.com"
                                            value={link.url}
                                            radius="large"
                                            onChange={(e) => {
                                                logFieldChange(
                                                    `link-url-${index}`,
                                                    `链接地址(#${index + 1})`,
                                                    e.target.value,
                                                );
                                                setLinks((prev) =>
                                                    prev.map((item, idx) =>
                                                        idx === index
                                                            ? {
                                                                  ...item,
                                                                  url: normalizeLinkUrl(
                                                                      e.target
                                                                          .value,
                                                                  ),
                                                              }
                                                            : item,
                                                    ),
                                                );
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <FieldHelpDialog
                open={helpOpen}
                onOpenChange={setHelpOpen}
                title="外部链接字段说明"
                items={LINK_FIELD_HELP}
            />

            <Dialog.Root
                open={iconPickerIndex !== null}
                onOpenChange={(open) => {
                    if (!open) setIconPickerIndex(null);
                }}
            >
                <Dialog.Content
                    maxWidth="var(--ui-viewport-width)"
                    className="flex w-[min(calc(var(--ui-viewport-width)-2rem),760px)]! max-w-none! flex-col gap-4 overflow-hidden p-4 sm:p-5"
                >
                    <div className="flex items-start justify-between gap-4">
                        <Dialog.Title className="m-0 min-w-0 text-base">
                            选择 Phosphor Icon
                        </Dialog.Title>
                    </div>
                    <TextField.Root
                        placeholder="输入关键词，例如 github / link / globe / chat / docs"
                        value={iconQuery}
                        radius="large"
                        onChange={(e) => setIconQuery(e.target.value)}
                    >
                        <TextField.Slot>
                            <MagnifyingGlassIcon size={16} />
                        </TextField.Slot>
                    </TextField.Root>
                    <div className="max-h-[420px] overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                            {visibleIcons.map((name) => (
                                <button
                                    key={name}
                                    type="button"
                                    className="flex min-w-0 flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-3 text-center text-xs text-white/70 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
                                    onClick={() => {
                                        if (iconPickerIndex == null) return;
                                        log.info("form/links", "选择链接图标", {
                                            data: { icon: name },
                                        });
                                        setLinks((prev) =>
                                            prev.map((item, idx) =>
                                                idx === iconPickerIndex
                                                    ? { ...item, icon: name }
                                                    : item,
                                            ),
                                        );
                                        setIconPickerIndex(null);
                                    }}
                                >
                                    <span className="grid size-10 shrink-0 place-items-center text-white">
                                        <PhosphorIconByName
                                            name={name}
                                            size={24}
                                            className="text-white"
                                        />
                                    </span>
                                    <span className="w-full truncate">{name}</span>
                                </button>
                            ))}
                        </div>
                        {filteredIcons.length === 0 && (
                            <p className="py-10 text-center text-sm text-white/40">
                                没有匹配的图标
                            </p>
                        )}
                        {filteredIcons.length > visibleIcons.length && (
                            <p className="mt-2 text-center text-xs text-white/40">
                                仅显示前 {visibleIcons.length} 个，搜索可缩小范围。
                            </p>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Root>
        </SectionCard>
    );
}
