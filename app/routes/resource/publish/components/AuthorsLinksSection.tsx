import {
  BinocularsIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { Button, Switch, TextField } from "@radix-ui/themes";
import { type Dispatch, type SetStateAction } from "react";
import { type AuthorInput, type LinkInput } from "./types";
import { SectionCard } from "./shared";
import {
  normalizeLinkUrl,
  validateLink,
} from "~/logic/publish/validation";

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
      description="作者会自动填入当前 AstroBox 用户名；外链用于补充官网、文档、社区等入口。"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">作者</p>
              <p className="text-xs text-white/55">至少保留一个作者，作者名不能为空。</p>
            </div>
            <Button
              type="button"
              variant="soft"
              onClick={() =>
                setAuthors((prev) => [
                  ...prev,
                  { name: "", bindABAccount: true },
                ])
              }
            >
              <PlusIcon size={15} weight="bold" />
              添加作者
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {authors.map((author, index) => (
              <div
                key={`author-${index}`}
                className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <TextField.Root
                  placeholder="作者名称"
                  value={author.name}
                  radius="large"
                  onChange={(e) =>
                    setAuthors((prev) =>
                      prev.map((item, idx) =>
                        idx === index ? { ...item, name: e.target.value } : item,
                      ),
                    )
                  }
                />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <Switch
                      checked={author.bindABAccount}
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
                    关联 AstroBox 账号
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    color="red"
                    disabled={authors.length <= 1}
                    onClick={() =>
                      setAuthors((prev) => prev.filter((_, idx) => idx !== index))
                    }
                  >
                    <MinusIcon size={15} weight="bold" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">外部链接</p>
              <p className="text-xs text-white/55">
                标题、图标、网址为必填项；如果其中任意一项有值，另外两项也必须填写。
              </p>
            </div>
            <Button
              type="button"
              variant="soft"
              onClick={() =>
                setLinks((prev) => [
                  ...prev,
                  { icon: "", title: "", url: "" },
                ])
              }
            >
              <PlusIcon size={15} weight="bold" />
              添加链接
            </Button>
          </div>

          {links.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
              还未添加外部链接
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {links.map((link, index) => {
                const linkError = validateLink(link);
                return (
                  <div
                    key={`link-${index}`}
                    className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-2.5"
                  >
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_minmax(0,1.5fr)_auto] md:items-start">
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
                      <TextField.Root
                        placeholder="图标（必填）"
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
                      <Button
                        type="button"
                        variant="ghost"
                        color="red"
                        onClick={() =>
                          setLinks((prev) =>
                            prev.filter((_, idx) => idx !== index),
                          )
                        }
                      >
                        <MinusIcon size={15} weight="bold" />
                      </Button>
                    </div>
                    {linkError && (
                      <p className="text-xs text-red-400">{linkError}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

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
      </div>
    </SectionCard>
  );
}
