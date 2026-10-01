import {
    ArrowCounterClockwiseIcon,
    MinusIcon,
    PlusIcon,
    WarningDiamondIcon,
} from "@phosphor-icons/react";
import {
    AlertDialog,
    Button,
    Callout,
    Switch,
    TextField,
} from "~/components/ScaleAwareThemes";
import {
    type Dispatch,
    type SetStateAction,
    useState,
} from "react";
import { type AuthorInput } from "./types";
import {
    type FieldHelpItem,
    FieldHelpButton,
    FieldHelpDialog,
    SectionCard,
} from "./shared";
import { log } from "~/logic/logging";
import { logFieldChange } from "~/logic/logging/publish-flow";

const AUTHOR_FIELD_HELP: FieldHelpItem[] = [
    {
        label: "作者名称",
        description: "展示在资源详情页的作者署名。第一个作者默认填入当前登录的 AstroBox 用户名。",
    },
    {
        label: "关联 AstroBox 账号",
        description:
            "开启后该署名会关联到一个真实的 AstroBox 账号，用户点击可跳转到其主页。第一个作者固定关联当前账号，无法关闭。",
    },
    {
        label: "第一个作者",
        description:
            "代表你自己，固定关联当前 AstroBox 账号。改名或移除都会让资源失去与你的关联，因此需要二次确认。至少需要保留一个作者。",
    },
];

interface AuthorsSectionProps {
    authors: AuthorInput[];
    setAuthors: Dispatch<SetStateAction<AuthorInput[]>>;
    defaultAuthorName?: string;
}

export function AuthorsSection({
    authors,
    setAuthors,
    defaultAuthorName = "",
}: AuthorsSectionProps) {
    const [helpOpen, setHelpOpen] = useState(false);
    const [pendingFirstAuthorName, setPendingFirstAuthorName] = useState("");
    const [confirmEditFirstAuthor, setConfirmEditFirstAuthor] = useState(false);
    const [confirmRemoveFirstAuthor, setConfirmRemoveFirstAuthor] =
        useState(false);
    const [firstAuthorEditConfirmed, setFirstAuthorEditConfirmed] =
        useState(false);

    const addAuthor = () => {
        log.info("form/authors", "添加作者");
        setAuthors((prev) => [...prev, { name: "", bindABAccount: true }]);
    };

    return (
        <SectionCard
            title="作者"
            description="作者会自动填入当前 AstroBox 账号；第一个作者代表你自己，修改需二次确认。"
            headerExtra={
                <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                        type="button"
                        variant="soft"
                        size="1"
                        className="text-xs!"
                        onClick={addAuthor}
                    >
                        <PlusIcon size={14} weight="bold" />
                        添加作者
                    </Button>
                    <FieldHelpButton
                        onClick={() => setHelpOpen(true)}
                        title="作者字段说明"
                    />
                </div>
            }
        >
            {authors.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
                    还未添加作者
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {authors.map((author, index) => {
                        const isFirst = index === 0;
                        const canRemove = authors.length > 1;
                        return (
                            <div
                                key={`author-${index}`}
                                className="flex flex-col gap-2.5 rounded-lg border border-white/10 bg-black/20 p-2.5"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="shrink-0 text-xs font-medium text-white/55">
                                        作者 {index + 1}
                                    </span>
                                    {isFirst && (
                                        <span className="shrink-0 text-xs text-amber-100/80">
                                            当前 AstroBox 账号
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        aria-label={`删除作者 ${index + 1}`}
                                        title={
                                            canRemove
                                                ? "删除"
                                                : "至少需要保留一个作者"
                                        }
                                        disabled={!canRemove}
                                        className="ml-auto shrink-0 rounded-lg p-1 text-red-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30 disabled:hover:bg-transparent"
                                        onClick={() => {
                                            if (isFirst) {
                                                setConfirmRemoveFirstAuthor(true);
                                                return;
                                            }
                                            log.info("form/authors", "移除作者", {
                                                data: {
                                                    name:
                                                        author.name ||
                                                        `#${index + 1}`,
                                                },
                                            });
                                            setAuthors((prev) =>
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
                                    <div className="flex min-w-0 items-center gap-2 md:grow md:shrink md:basis-[300px]">
                                        <TextField.Root
                                            className="min-w-0 flex-1"
                                            placeholder={
                                                isFirst
                                                    ? "当前 AstroBox 账号"
                                                    : "作者名称"
                                            }
                                            value={author.name}
                                            radius="large"
                                            onChange={(e) => {
                                                if (
                                                    isFirst &&
                                                    !firstAuthorEditConfirmed
                                                ) {
                                                    setPendingFirstAuthorName(
                                                        e.target.value,
                                                    );
                                                    setConfirmEditFirstAuthor(
                                                        true,
                                                    );
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
                                                            ? {
                                                                  ...item,
                                                                  name: e.target
                                                                      .value,
                                                              }
                                                            : item,
                                                    ),
                                                );
                                            }}
                                        />
                                        {isFirst &&
                                        defaultAuthorName &&
                                        author.name.trim() !==
                                            defaultAuthorName ? (
                                            <Button
                                                type="button"
                                                variant="surface"
                                                color="gray"
                                                size="1"
                                                className="shrink-0"
                                                aria-label="恢复默认名称"
                                                title="恢复默认名称"
                                                onClick={() => {
                                                    log.info(
                                                        "form/authors",
                                                        "恢复第一个作者默认名称",
                                                        {
                                                            data: {
                                                                name: defaultAuthorName,
                                                            },
                                                        },
                                                    );
                                                    setFirstAuthorEditConfirmed(
                                                        false,
                                                    );
                                                    setAuthors((prev) =>
                                                        prev.map((item, idx) =>
                                                            idx === 0
                                                                ? {
                                                                      ...item,
                                                                      name: defaultAuthorName,
                                                                  }
                                                                : item,
                                                        ),
                                                    );
                                                }}
                                            >
                                                <ArrowCounterClockwiseIcon
                                                    size={14}
                                                />
                                            </Button>
                                        ) : null}
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2 md:ml-auto">
                                        <span className="text-xs text-white/65">
                                            关联账号
                                        </span>
                                        <Switch
                                            checked={author.bindABAccount}
                                            disabled={isFirst}
                                            title={
                                                isFirst
                                                    ? "第一个作者固定关联当前 AstroBox 账号"
                                                    : "关联到一个真实的 AstroBox 账号"
                                            }
                                            onCheckedChange={(checked) => {
                                                if (isFirst) return;
                                                log.info(
                                                    "form/authors",
                                                    "切换关联 AstroBox 账号",
                                                    {
                                                        data: {
                                                            name:
                                                                author.name ||
                                                                `#${index + 1}`,
                                                            bindABAccount: Boolean(
                                                                checked,
                                                            ),
                                                        },
                                                    },
                                                );
                                                setAuthors((prev) =>
                                                    prev.map((item, idx) =>
                                                        idx === index
                                                            ? {
                                                                  ...item,
                                                                  bindABAccount:
                                                                      Boolean(
                                                                          checked,
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
                title="作者字段说明"
                items={AUTHOR_FIELD_HELP}
            />

            <AlertDialog.Root
                open={confirmEditFirstAuthor}
                onOpenChange={setConfirmEditFirstAuthor}
            >
                <AlertDialog.Content maxWidth="440px">
                    <AlertDialog.Title className="flex items-center gap-2 text-amber-100">
                        <WarningDiamondIcon size={20} weight="fill" />
                        确认修改第一个作者？
                    </AlertDialog.Title>
                    <Callout.Root color="amber" size="1" className="mt-3">
                        <Callout.Icon>
                            <WarningDiamondIcon size={16} weight="fill" />
                        </Callout.Icon>
                        <Callout.Text>
                            第一个作者代表你自己，固定关联当前 AstroBox
                            账号。改名为「
                            {pendingFirstAuthorName.trim() || "空"}
                            」后，资源将不再随你的账号自动关联，且无法一键恢复。
                        </Callout.Text>
                    </Callout.Root>
                    <div className="mt-4 flex justify-end gap-3">
                        <AlertDialog.Cancel>
                            <Button variant="soft" color="gray">
                                保持默认
                            </Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                            <Button
                                variant="solid"
                                color="red"
                                onClick={() => {
                                    setFirstAuthorEditConfirmed(true);
                                    log.info(
                                        "form/authors",
                                        "修改第一个作者名称",
                                        {
                                            data: {
                                                name: pendingFirstAuthorName,
                                            },
                                        },
                                    );
                                    setAuthors((prev) =>
                                        prev.map((item, idx) =>
                                            idx === 0
                                                ? {
                                                      ...item,
                                                      name: pendingFirstAuthorName,
                                                  }
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
                <AlertDialog.Content maxWidth="440px">
                    <AlertDialog.Title className="flex items-center gap-2 text-red-200">
                        <WarningDiamondIcon size={20} weight="fill" />
                        确认移除第一个作者？
                    </AlertDialog.Title>
                    <Callout.Root color="red" size="1" className="mt-3">
                        <Callout.Icon>
                            <WarningDiamondIcon size={16} weight="fill" />
                        </Callout.Icon>
                        <Callout.Text>
                            第一个作者代表你自己，移除后资源将不再与你的 AstroBox
                            账号关联。若只是不想署名，建议改名而不是移除。
                        </Callout.Text>
                    </Callout.Root>
                    <div className="mt-4 flex justify-end gap-3">
                        <AlertDialog.Cancel>
                            <Button variant="soft" color="gray">
                                取消
                            </Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                            <Button
                                variant="solid"
                                color="red"
                                onClick={() => {
                                    log.info("form/authors", "移除第一个作者");
                                    setAuthors((prev) =>
                                        prev.filter((_, idx) => idx !== 0),
                                    );
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
