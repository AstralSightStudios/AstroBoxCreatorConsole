import {
  PlusIcon,
  MinusIcon,
  BinocularsIcon,
  InfoIcon,
} from "@phosphor-icons/react";
import { Switch, TextField, Table } from "@radix-ui/themes";
import { type Dispatch, type SetStateAction } from "react";
import { type AuthorInput, type LinkInput } from "./types";
import { Field, SectionCard } from "./shared";

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
  return (
    <SectionCard
      title="作者与外链"
      description="可以添加多个作者以及外部链接（官网、文档、社区等）。"
    >
      <div className="flex flex-col gap-1">
        {/*<div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white pt-1.5 px-2">
            资源作者列表
          </p>
        </div>*/}
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

                <Table.ColumnHeaderCell>
                  关联 AstroBox 账号
                </Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {authors.map((author, index) => (
                <Table.Row key={`author-${index}`}>
                  <Table.RowHeaderCell width="40px" justify="center" px="0">
                    {authors.length > 1 && (
                      <button
                        className="text-white/60 transition hover:text-red-400 flex items-center justify-center h-[30px] w-[30px] m-auto"
                        onClick={() =>
                          setAuthors((prev) =>
                            prev.filter((_, idx) => idx !== index),
                          )
                        }
                      >
                        <MinusIcon size={16} weight="bold" />
                      </button>
                    )}
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell>
                    <TextField.Root
                      placeholder="作者名称"
                      value={author.name}
                      radius="large"
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
                    <label className="flex items-center gap-2 text-sm text-white/80 h-full">
                      <Switch
                        checked={author.bindABAccount}
                        onCheckedChange={(checked) =>
                          setAuthors((prev) =>
                            prev.map((item, idx) =>
                              idx === index
                                ? {
                                    ...item,
                                    bindABAccount: Boolean(checked),
                                  }
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
      </div>
      <div className="flex flex-col gap-1">
        {/*<div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white pt-1.5 px-2">
            外部链接列表
          </p>
        </div>*/}
        <div className="flex flex-col gap-3 max-w-full overflow-x-auto">
          <Table.Root className="table-fixed w-full min-w-lg">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell
                  width="40px"
                  justify="center"
                  p="0"
                  className="h-full flex justify-center items-center"
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
                <Table.ColumnHeaderCell>外部链接标题</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>
                  图标
                  <span className="text-xs text-white/60">（可选）</span>
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>网址</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {links.map((link, index) => (
                <Table.Row key={`links-${index}`}>
                  <Table.RowHeaderCell width="40px" justify="center" px="0">
                    {links.length > 0 && (
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
                    )}
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell>
                    <label className="flex items-center gap-2 text-sm text-white/80 h-full">
                      <TextField.Root
                        placeholder="anything..."
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
                    </label>
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell>
                    <TextField.Root
                      placeholder="...Icon"
                      value={link.icon}
                      radius="large"
                      onChange={(e) =>
                        setLinks((prev) =>
                          prev.map((item, idx) =>
                            idx === index
                              ? { ...item, icon: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell>
                    <label className="flex items-center gap-2 text-sm text-white/80 h-full">
                      <TextField.Root
                        placeholder="https://example.com"
                        value={link.url}
                        radius="large"
                        onChange={(e) =>
                          setLinks((prev) =>
                            prev.map((item, idx) =>
                              idx === index
                                ? { ...item, url: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  </Table.RowHeaderCell>
                </Table.Row>
              ))}
              {links.length === 0 && (
                <Table.Row key={`links-0`}>
                  <Table.RowHeaderCell
                    width="40px"
                    justify="center"
                    px="0"
                  ></Table.RowHeaderCell>
                  <Table.RowHeaderCell>
                    <span className="text-white/60">还未添加外部链接</span>
                  </Table.RowHeaderCell>
                  <Table.RowHeaderCell />
                  <Table.RowHeaderCell />
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        </div>
        <div className="flex justify-between gap-1.5 px-1.5 pt-1.5 w-full flex-wrap">
          <p className="text-sm text-white/70 flex gap-1 items-center leading-4.5">
            <InfoIcon size={18} className="shrink-0" />
            你可以使用 PhosphorIcon 作为外部链接图标。
          </p>
          <a
            href="https://phosphoricons.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-size-medium rounded-lg -mx-2 -my-1 px-2 py-1.5 flex gap-1 items-center text-blue-500/75 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <BinocularsIcon size={18} className="shrink-0" />
            浏览全部图标
          </a>
        </div>
      </div>
    </SectionCard>
  );
}
