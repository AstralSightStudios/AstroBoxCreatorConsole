import { PlusCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { Button, Switch, TextField } from "@radix-ui/themes";
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
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">作者</p>
                    <Button
                        className="styledbtn"
                        onClick={() =>
                            setAuthors((prev) => [...prev, { name: "", bindABAccount: true }])
                        }
                    >
                        <PlusCircleIcon size={16} /> 添加作者
                    </Button>
                </div>
                <div className="flex flex-col gap-3">
                    {authors.map((author, index) => (
                        <div
                            key={`author-${index}`}
                            className="flex flex-row items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-3"
                        >
                            <div className="flex items-center gap-2">
                                <TextField.Root
                                    placeholder="作者名称"
                                    value={author.name}
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
                                <label className="flex items-center gap-2 text-sm text-white/80">
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
                                    关联 AstroBox 账号
                                </label>
                                {authors.length > 1 && (
                                    <button
                                        className="text-white/60 transition hover:text-red-400"
                                        onClick={() =>
                                            setAuthors((prev) =>
                                                prev.filter((_, idx) => idx !== index),
                                            )
                                        }
                                    >
                                        <XCircleIcon size={18} weight="fill" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-3 pt-3">
                <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">外部链接</p>
                    <Button
                        className="styledbtn"
                        onClick={() =>
                            setLinks((prev) => [...prev, { icon: "", title: "", url: "" }])
                        }
                    >
                        <PlusCircleIcon size={16} /> 添加链接
                    </Button>
                </div>
                <div className="flex flex-col gap-3">
                    {links.map((link, index) => (
                        <div
                            key={`link-${index}`}
                            className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 md:grid-cols-3"
                        >
                            <TextField.Root
                                placeholder="图标（可选）"
                                value={link.icon}
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
                                placeholder="标题"
                                value={link.title}
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
                            <div className="flex items-center gap-2">
                                <TextField.Root
                                    placeholder="https://example.com"
                                    value={link.url}
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
                                {links.length > 0 && (
                                    <button
                                        className="text-white/60 transition hover:text-red-400"
                                        onClick={() =>
                                            setLinks((prev) =>
                                                prev.filter((_, idx) => idx !== index),
                                            )
                                        }
                                    >
                                        <XCircleIcon size={18} weight="fill" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {links.length === 0 && (
                        <p className="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60">
                            目前没有外部链接，如有需要请点击上方按钮添加。
                        </p>
                    )}
                </div>
            </div>
        </SectionCard>
    );
}
