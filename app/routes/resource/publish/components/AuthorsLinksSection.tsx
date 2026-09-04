import {
  BinocularsIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import {
  AlertDialog,
  Button,
  Dialog,
  Switch,
  Table,
  TextField,
} from "~/components/ScaleAwareThemes";
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
import { log } from "~/logic/logging";
import { logFieldChange } from "~/logic/logging/publish-flow";

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
  const [pendingFirstAuthorName, setPendingFirstAuthorName] = useState("");
  const [confirmEditFirstAuthor, setConfirmEditFirstAuthor] = useState(false);
  const [confirmRemoveFirstAuthor, setConfirmRemoveFirstAuthor] =
    useState(false);
  const [firstAuthorEditConfirmed, setFirstAuthorEditConfirmed] =
    useState(false);

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
              onClick={() => {
                log.info("form/authors", "添加作者");
                setAuthors((prev) => [
                  ...prev,
                  { name: "", bindABAccount: true },
                ]);
              }}
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
                    onClick={() => {
                      log.info("form/authors", "添加作者");
                      setAuthors((prev) => [
                        ...prev,
                        { name: "", bindABAccount: true },
                      ]);
                    }}
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
                  <Table.RowHeaderCell
                    width="40px"
                    justify="center"
                    px="0"
                    style={{ verticalAlign: "middle" }}
                  >
                    <button
                      className="text-white/60 transition hover:text-red-400 flex items-center justify-center h-[30px] w-[30px] m-auto disabled:opacity-25"
                      disabled={authors.length <= 1}
                      onClick={() => {
                        if (index === 0) {
                          setConfirmRemoveFirstAuthor(true);
                          return;
                        }
                        log.info("form/authors", "移除作者", {
                          data: { name: author.name || `#${index + 1}` },
                        });
                        setAuthors((prev) =>
                          prev.filter((_, idx) => idx !== index),
                        );
                      }}
                    >
                      <MinusIcon size={16} weight="bold" />
                    </button>
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell>
                    <TextField.Root
                      placeholder={index === 0 ? "当前 AstroBox 账号" : "作者名称"}
                      value={author.name}
                      radius="large"
                      onChange={(e) => {
                        if (index === 0 && !firstAuthorEditConfirmed) {
                          setPendingFirstAuthorName(e.target.value);
                          setConfirmEditFirstAuthor(true);
                          return;
                        }
                        logFieldChange(
                          `author-name-${index}`,
                          `作者名称(#${index + 1})`,
                          e.target.value,
                        );
                        setAuthors((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? { ...item, name: e.target.value }
                              : item,
                          ),
                        );
                      }}
                    />
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell style={{ verticalAlign: "middle" }}>
                    <label className="flex h-full items-center gap-2 text-sm text-white/80">
                      <Switch
                        checked={author.bindABAccount}
                        onCheckedChange={(checked) => {
                          if (index === 0) return;
                          log.info("form/authors", "切换关联 AstroBox 账号", {
                            data: {
                              name: author.name || `#${index + 1}`,
                              bindABAccount: Boolean(checked),
                            },
                          });
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
                    className="min-w-0 w-auto justify-start gap-2"
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
                    <span className="max-w-40 truncate">
                      {link.icon || "选择图标"}
                    </span>
                  </Button>
                );
                const titleField = (
                  <div className="flex flex-col gap-1">
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
                              ? { ...item, title: e.target.value }
                              : item,
                          ),
                        );
                      }}
                    />
                    <div className="min-h-4 text-xs text-red-400">
                      {"\u00A0"}
                    </div>
                  </div>
                );
                const urlField = (
                  <div className="flex flex-col gap-1">
                    <TextField.Root
                      type="url"
                      placeholder="https://example.com"
                      value={link.url}
                      radius="large"
                      color={linkError ? "red" : undefined}
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
                                  url: normalizeLinkUrl(e.target.value),
                                }
                              : item,
                          ),
                        );
                      }}
                    />
                    <div className="min-h-4 text-xs text-red-400">
                      {linkError || "\u00A0"}
                    </div>
                  </div>
                );
                const removeButton = (
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-white/60 transition hover:text-red-400"
                    onClick={() => {
                      log.info("form/links", "移除外部链接", {
                        data: {
                          title: link.title || `#${index + 1}`,
                          url: link.url,
                        },
                      });
                      setLinks((prev) =>
                        prev.filter((_, idx) => idx !== index),
                      );
                    }}
                  >
                    <MinusIcon size={16} weight="bold" />
                  </button>
                );
                return (
                  <div key={`links-${index}`} className="py-2.5">
                    <div className="hidden items-start gap-2 md:grid md:grid-cols-[40px_auto_minmax(0,1fr)_minmax(0,1.4fr)]">
                      {removeButton}
                      {iconButton}
                      {titleField}
                      {urlField}
                    </div>
                    <div className="flex flex-col gap-2 md:hidden">
                      <div className="flex items-center gap-1">
                        {removeButton}
                        <div className="shrink-0">{iconButton}</div>
                      </div>
                      <div className="flex items-start gap-1 pl-7">
                        <div className="min-w-0 flex-1">{titleField}</div>
                        <div className="min-w-0 flex-1">{urlField}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

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

      <AlertDialog.Root
        open={confirmEditFirstAuthor}
        onOpenChange={setConfirmEditFirstAuthor}
      >
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>修改第一个作者？</AlertDialog.Title>
          <AlertDialog.Description size="2">
            第一个作者默认读取当前 AstroBox 账号，不建议手动修改。
            确认将名称改为「{pendingFirstAuthorName.trim() || "空"}」吗？
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-3">
            <AlertDialog.Cancel>
              <Button variant="solid">保持默认</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="soft"
                onClick={() => {
                  setFirstAuthorEditConfirmed(true);
                  log.info("form/authors", "修改第一个作者名称", {
                    data: { name: pendingFirstAuthorName },
                  });
                  setAuthors((prev) =>
                    prev.map((item, idx) =>
                      idx === 0
                        ? { ...item, name: pendingFirstAuthorName }
                        : item,
                    ),
                  );
                }}
              >
                仍然修改
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={confirmRemoveFirstAuthor}
        onOpenChange={setConfirmRemoveFirstAuthor}
      >
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>移除第一个作者？</AlertDialog.Title>
          <AlertDialog.Description size="2">
            第一个作者默认绑定当前 AstroBox 账号，不建议移除。
            确认仍要移除吗？
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-3">
            <AlertDialog.Cancel>
              <Button variant="solid">取消</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="soft"
                color="red"
                onClick={() => {
                  log.info("form/authors", "移除第一个作者");
                  setAuthors((prev) => prev.filter((_, idx) => idx !== 0));
                }}
              >
                仍然移除
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </SectionCard>
  );
}
