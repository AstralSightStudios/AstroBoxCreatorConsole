import {
  BinocularsIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
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

const phosphorIconModules = import.meta.glob<
  { default?: ComponentType<{ size?: number; className?: string }> }
>("/node_modules/@phosphor-icons/react/dist/csr/*.es.js");

function isSubsequence(needle: string, haystack: string): boolean {
    let cursor = 0;
    for (const char of needle) {
        cursor = haystack.indexOf(char, cursor);
        if (cursor < 0) return false;
        cursor += 1;
    }
    return true;
}

function fuzzyIconMatch(name: string, rawQuery: string): boolean {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return true;
    const terms = query.split(/[\s-]+/).filter(Boolean);
    const normalizedName = name.toLowerCase().replace(/-/g, " ");
    return terms.every((term) => isSubsequence(term, normalizedName));
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
        if (active) setComponent(() => module.default ?? null);
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

  const filteredIcons = useMemo(() => {
    return PHOSPHOR_ICON_NAMES.filter((name) => fuzzyIconMatch(name, iconQuery));
  }, [iconQuery]);

  const visibleIcons = useMemo(
    () => filteredIcons.slice(0, 160),
    [filteredIcons],
  );

  return (
    <SectionCard
      title="作者与外链"
      description="作者会自动填入当前 AstroBox 用户名；外链用于补充官网、文档、社区等入口。"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 max-w-full overflow-x-auto">
          <Table.Root className="table-fixed w-full min-w-lg">
            <Table.Header>
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
                        disabled={index === 0}
                        onCheckedChange={(checked) =>
                          setAuthors((prev) =>
                            prev.map((item, idx) =>
                              idx === index
                                ? { ...item, bindABAccount: Boolean(checked) }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  </Table.RowHeaderCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </div>

        <div className="flex flex-col gap-3 max-w-full overflow-x-auto">
          <Table.Root className="table-fixed w-full min-w-lg">
            <Table.Header>
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
                      setLinks((prev) => [
                        ...prev,
                        { icon: "", title: "", url: "" },
                      ])
                    }
                  >
                    <PlusIcon size={16} weight="bold" />
                  </button>
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>图标</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>标题</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>网址</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {links.length === 0 ? (
                <Table.Row>
                  <Table.RowHeaderCell width="40px" justify="center" px="0" />
                  <Table.RowHeaderCell>
                    <span className="text-white/60">还未添加外部链接</span>
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell />
                  <Table.RowHeaderCell />
                </Table.Row>
              ) : (
                links.map((link, index) => {
                  const linkError = validateLink(link);
                  return (
                    <Table.Row
                      key={`links-${index}`}
                      className={
                        linkError ? "outline outline-1 outline-red-400/70" : ""
                      }
                    >
                      <Table.RowHeaderCell width="40px" justify="center" px="0">
                        <button
                          className="text-white/60 transition hover:text-red-400 flex items-center justify-center h-[30px] w-[30px] m-auto"
                          onClick={() =>
                            setLinks((prev) =>
                              prev.filter((_, idx) => idx !== index),
                            )
                          }
                        >
                          <MinusIcon size={16} weight="bold" />
                        </button>
                      </Table.RowHeaderCell>
                      <Table.RowHeaderCell>
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
                          <BinocularsIcon size={15} />
                          <span className="truncate">
                            {link.icon || "选择图标"}
                          </span>
                        </Button>
                      </Table.RowHeaderCell>
                      <Table.RowHeaderCell>
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
                      </Table.RowHeaderCell>
                      <Table.RowHeaderCell>
                        <div className="flex flex-col gap-1">
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
                            <p className="text-xs text-red-400">{linkError}</p>
                          )}
                        </div>
                      </Table.RowHeaderCell>
                    </Table.Row>
                  );
                })
              )}
            </Table.Body>
          </Table.Root>
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
        <Dialog.Content className="max-w-[min(94vw,760px)] p-5">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="m-0 min-w-0">选择 Phosphor Icon</Dialog.Title>
            <Dialog.Close className="grid size-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white">
              <XIcon size={17} />
            </Dialog.Close>
          </div>
          <TextField.Root
            placeholder="搜索图标名称"
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
