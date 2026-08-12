import {
  BinocularsIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { Button, Dialog, Switch, Table, TextField } from "@radix-ui/themes";
import {
  type ComponentType,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type AuthorInput, type LinkInput } from "./types";
import { SectionCard } from "./shared";
import { PHOSPHOR_ICON_NAMES } from "~/routes/resreview/phosphor-icons";
import {
  normalizeLinkUrl,
  validateLink,
} from "~/logic/publish/validation";

const iconNameToPascal = (name: string): string =>
  name
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("");

type PhosphorIconComponent = ComponentType<{ size?: number; className?: string }>;

const phosphorIconModules = import.meta.glob<Record<string, PhosphorIconComponent>>(
  "/node_modules/@phosphor-icons/react/dist/csr/*.es.js",
);

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
            (a, b) => iconBaseScore(b) - iconBaseScore(a) || a.localeCompare(b),
        );
    }
    return names
        .map((name) => {
            const pascalName = iconNameToPascal(name);
            const matchScore = tokens.reduce(
                (sum, token) => sum + iconMatchScore(name, pascalName, token),
                0,
            );
            return {
                name,
                score: matchScore + iconBaseScore(name),
                matched: tokens.every((token) => iconMatchScore(name, pascalName, token) > 0),
            };
        })
        .filter((option) => option.matched)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .map((option) => option.name);
}

function PhosphorIconByName({
  name,
  size = 16,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const [Component, setComponent] = useState<
    ComponentType<{ size?: number; className?: string }> | null
  >(null);

  useEffect(() => {
    let active = true;
    const modulePath = `/node_modules/@phosphor-icons/react/dist/csr/${iconNameToPascal(
      name,
    )}.es.js`;
    const loader = phosphorIconModules[modulePath];
    if (!loader) {
      setComponent(null);
      return;
    }
    loader()
      .then((module) => {
        if (!active) return;
        const pascalName = iconNameToPascal(name);
        const component =
          module[`${pascalName}Icon`] || module[pascalName] || null;
        setComponent(() => component);
      })
      .catch(() => {
        if (active) setComponent(null);
      });
    return () => {
      active = false;
    };
  }, [name]);

  if (!Component) return <span className="grid size-5 place-items-center" />;
  return <Component size={size} className={`text-white ${className ?? ""}`} />;
}

interface AuthorsLinksSectionProps {
  authors: AuthorInput[];
  setAuthors: Dispatch<SetStateAction<AuthorInput[]>>;
  links: LinkInput[];
  setLinks: Dispatch<SetStateAction<LinkInput[]>>;
}

export function AuthorsLinksSection({
  authors,
  setAuthors,
  links,
  setLinks,
}: AuthorsLinksSectionProps) {
  const [iconPickerIndex, setIconPickerIndex] = useState<number | null>(null);
  const [iconQuery, setIconQuery] = useState("");

  const filteredIcons = useMemo(
    () => searchIcons(PHOSPHOR_ICON_NAMES, iconQuery),
    [iconQuery],
  );

  const visibleIcons = useMemo(() => {
    if (iconQuery.trim()) return filteredIcons;
    return filteredIcons.slice(0, 240);
  }, [filteredIcons, iconQuery]);

  return (
    <SectionCard
      title="作者与外链"
      description="作者会自动填入当前 AstroBox 用户名；外链用于补充官网、文档、社区等入口。"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 max-w-full">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">作者</p>
            <Button
              type="button"
              variant="soft"
              size="1"
              onClick={() =>
                setAuthors((prev) => [
                  ...prev,
                  { name: "", bindABAccount: true },
                ])
              }
            >
              <PlusIcon size={14} weight="bold" />
              添加作者
            </Button>
          </div>
          <Table.Root className="table-fixed w-full">
            <Table.Header className="max-md:hidden">
              <Table.Row>
                <Table.ColumnHeaderCell
                  width="40px"
                  justify="center"
                  p="0"
                  className="h-full flex justify-center items-center shrink-0"
                >
                  <button
                    className="text-white/60 transition hover:text-blue-400 flex items-center justify-center h-[30px] w-[30px]"
                    onClick={() =>
                      setAuthors((prev) => [
                        ...prev,
                        { name: "", bindABAccount: true },
                      ])
                    }
                  >
                    <PlusIcon size={16} weight="bold" />
                  </button>
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>作者名称</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>关联 AstroBox 账号</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {authors.map((author, index) => (
                <Table.Row key={`author-${index}`}>
                  <Table.RowHeaderCell width="40px" justify="center" px="0">
                    <button
                      className="text-white/60 transition hover:text-red-400 flex items-center justify-center h-[30px] w-[30px] m-auto disabled:opacity-25"
                      disabled={index === 0 || authors.length <= 1}
                      onClick={() =>
                        setAuthors((prev) =>
                          prev.filter((_, idx) => idx !== index),
                        )
                      }
                    >
                      <MinusIcon size={16} weight="bold" />
                    </button>
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell>
                    <TextField.Root
                      placeholder={index === 0 ? "当前 AstroBox 账号" : "作者名称"}
                      value={author.name}
                      radius="large"
                      disabled={index === 0}
                      onChange={(e) =>
                        setAuthors((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? { ...item, name: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell>
                    <label className="flex items-center gap-2 text-sm text-white/80">
                      <Switch
                        checked={author.bindABAccount}
                        onCheckedChange={(checked) => {
                          if (index === 0) return;
                          setAuthors((prev) =>
                            prev.map((item, idx) =>
                              idx === index
                                ? { ...item, bindABAccount: Boolean(checked) }
                                : item,
                            ),
                          );
                        }}
                      />
                    </label>
                  </Table.RowHeaderCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </div>

        <div className="flex flex-col gap-3 max-w-full">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">外部链接</p>
            <Button
              type="button"
              variant="soft"
              size="1"
              onClick={() =>
                setLinks((prev) => [
                  ...prev,
                  { icon: "", title: "", url: "" },
                ])
              }
            >
              <PlusIcon size={14} weight="bold" />
              添加链接
            </Button>
          </div>
          {links.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
              还未添加外部链接
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-white/10">
              {links.map((link, index) => {
                const linkError = validateLink(link);
                const iconButton = (
                  <Button
                    type="button"
                    variant="surface"
                    color="gray"
                    radius="large"
                    className="min-w-0 w-full justify-start gap-2"
                    onClick={() => {
                      setIconQuery("");
                      setIconPickerIndex(index);
                    }}
                  >
                    {link.icon ? (
                      <PhosphorIconByName name={link.icon} size={16} />
                    ) : (
                      <BinocularsIcon size={15} />
                    )}
                    <span className="truncate">
                      {link.icon || "选择图标"}
                    </span>
                  </Button>
                );
                const titleField = (
                  <TextField.Root
                    placeholder="标题"
                    value={link.title}
                    radius="large"
                    onChange={(e) =>
                      setLinks((prev) =>
                        prev.map((item, idx) =>
                          idx === index
                            ? { ...item, title: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                );
                const urlField = (
                  <div className="relative pb-4">
                    <TextField.Root
                      type="url"
                      placeholder="https://example.com"
                      value={link.url}
                      radius="large"
                      color={linkError ? "red" : undefined}
                      onChange={(e) =>
                        setLinks((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? {
                                  ...item,
                                  url: normalizeLinkUrl(e.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    {linkError && (
                      <p className="absolute left-0 top-full mt-1 text-xs text-red-400">
                        {linkError}
                      </p>
                    )}
                  </div>
                );
                const removeButton = (
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-white/60 transition hover:text-red-400"
                    onClick={() =>
                      setLinks((prev) =>
                        prev.filter((_, idx) => idx !== index),
                      )
                    }
                  >
                    <MinusIcon size={16} weight="bold" />
                  </button>
                );
                return (
                  <div key={`links-${index}`} className="py-2.5">
                    <div className="hidden items-center gap-2 md:grid md:grid-cols-[40px_180px_minmax(0,1fr)_minmax(0,1.4fr)]">
                      {removeButton}
                      {iconButton}
                      {titleField}
                      {urlField}
                    </div>
                    <div className="flex flex-col gap-2 md:hidden">
                      <div className="flex items-center gap-1">
                        {removeButton}
                        <div className="w-28 shrink-0">{iconButton}</div>
                        <div className="min-w-0 flex-1">{titleField}</div>
                      </div>
                      <div className="pl-7">{urlField}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/65">
          <p className="flex items-center gap-1.5">
            <InfoIcon size={16} />
            图标请使用 Phosphor Icon 名称。
          </p>
          <a
            href="https://phosphoricons.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-blue-400 transition hover:bg-white/10 hover:text-blue-300"
          >
            <BinocularsIcon size={16} />
            浏览全部图标
          </a>
        </div>
      </div>

      <Dialog.Root
        open={iconPickerIndex !== null}
        onOpenChange={(open) => {
          if (!open) setIconPickerIndex(null);
        }}
      >
        <Dialog.Content className="flex max-w-[min(94vw,760px)] flex-col gap-4 p-5">
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
                    <PhosphorIconByName name={name} size={24} />
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
