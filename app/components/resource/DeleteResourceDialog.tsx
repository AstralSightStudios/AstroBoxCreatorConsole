import {
    GithubLogoIcon,
    TrashIcon,
    WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
    Button,
    Callout,
    Checkbox,
    Dialog,
    Spinner,
    TextField,
} from "~/components/ScaleAwareThemes";
import {
    deleteResourceRepository,
    isLegacyItemId,
    openResourceDeletionPullRequest,
    prepareResourceDeletion,
    requiredDeletionConfirmation,
    ResourceDeletionError,
    type PreparedDeletionSubmission,
} from "~/logic/publish/resource-deletion";
import type { ResourceCatalogContext } from "~/logic/publish/resources";

type DialogPhase = "form" | "submitting" | "error" | "pr-retry";

export function DeleteResourceDialog({
    open,
    resource,
    onOpenChange,
    onSubmitted,
}: {
    open: boolean;
    resource: ResourceCatalogContext | null;
    onOpenChange: (open: boolean) => void;
    onSubmitted?: (resourceId: string, prUrl: string) => void;
}) {
    const navigate = useNavigate();
    const [phase, setPhase] = useState<DialogPhase>("form");
    const [deleteRepository, setDeleteRepository] = useState(false);
    const [confirmation, setConfirmation] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [prepared, setPrepared] =
        useState<PreparedDeletionSubmission | null>(null);
    const [repoDeleted, setRepoDeleted] = useState(false);

    const entry = resource?.entry ?? null;
    const required = requiredDeletionConfirmation(deleteRepository);
    const submitting = phase === "submitting";

    useEffect(() => {
        if (!open) return;
        setPhase("form");
        setDeleteRepository(false);
        setConfirmation("");
        setMessage("");
        setError("");
        setErrorCode(null);
        setPrepared(null);
        setRepoDeleted(false);
    }, [open, entry?.id]);

    const handleOpenChange = (next: boolean) => {
        if (!next && (phase === "submitting" || phase === "pr-retry")) {
            return;
        }
        onOpenChange(next);
    };

    const finish = (prUrl: string) => {
        if (!entry) return;
        toast.success("已成功提交删除请求，可以前往审核列表查看进度。");
        onSubmitted?.(entry.id, prUrl);
        onOpenChange(false);
    };

    const handleConfirm = async () => {
        if (!resource || !entry || submitting) return;
        if (confirmation.trim() !== required) return;

        setPhase("submitting");
        setError("");
        let currentPrepared = prepared;
        let currentRepoDeleted = repoDeleted;

        try {
            if (!currentPrepared) {
                setMessage("正在读取最新目录并准备删除申请…");
                currentPrepared = await prepareResourceDeletion(entry);
                setPrepared(currentPrepared);
            }

            if (deleteRepository && !currentRepoDeleted) {
                const result = await deleteResourceRepository({
                    entry: currentPrepared.entry,
                    token: currentPrepared.token,
                    onProgress: setMessage,
                });
                currentRepoDeleted =
                    result === "deleted" || result === "already-gone";
                setRepoDeleted(currentRepoDeleted);
            }

            setMessage("正在创建删除申请 PR…");
            const created = await openResourceDeletionPullRequest({
                prepared: currentPrepared,
                deleteRepository,
                repoDeleted: currentRepoDeleted,
            });
            finish(created.prUrl);
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            setError(text);
            setErrorCode(
                err instanceof ResourceDeletionError ? err.code : null,
            );
            setPhase(
                currentPrepared && deleteRepository && currentRepoDeleted
                    ? "pr-retry"
                    : "error",
            );
        }
    };

    const retryCreatePullRequest = async () => {
        if (!prepared) return;
        setPhase("submitting");
        setError("");
        setErrorCode(null);
        setMessage("正在重试创建删除申请 PR…");
        try {
            const created = await openResourceDeletionPullRequest({
                prepared,
                deleteRepository: true,
                repoDeleted,
            });
            finish(created.prUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setPhase("pr-retry");
        }
    };

    const scopeMissing = errorCode === "scope-missing";

    return (
        <Dialog.Root open={open && Boolean(resource)} onOpenChange={handleOpenChange}>
            <Dialog.Content
                maxWidth="560px"
                className="max-h-[85vh] overflow-y-auto"
                onEscapeKeyDown={(event) => {
                    if (phase === "submitting" || phase === "pr-retry") {
                        event.preventDefault();
                    }
                }}
                onInteractOutside={(event) => {
                    if (phase === "submitting" || phase === "pr-retry") {
                        event.preventDefault();
                    }
                }}
            >
                <Dialog.Title className="flex items-center gap-2 text-red-100">
                    <TrashIcon size={20} weight="duotone" />
                    删除资源
                </Dialog.Title>

                {entry && (
                    <Dialog.Description size="2" className="text-white/70">
                        即将处理「{entry.name || entry.id}」（ID：
                        <span className="font-mono text-white/85">
                            {entry.id}
                        </span>
                        ）。请先阅读下面的后果，再输入确认语句。
                    </Dialog.Description>
                )}

                {phase === "form" && entry && (
                    <div className="mt-4 flex flex-col gap-4">
                        <section className="rounded-xl border border-red-400/25 bg-red-400/[0.06] p-3">
                            <p className="text-sm font-semibold text-red-100">
                                删除资源索引的后果
                            </p>
                            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-5 text-white/70">
                                <li>
                                    资源会从 AstroBox 官方资源索引中移除，用户无法再通过搜索、推荐位或资源页找到并下载它。
                                </li>
                                <li>
                                    已安装用户可能保留本地副本，但之后无法收到更新；卸载或重置后可能无法重新安装。
                                </li>
                                <li>
                                    付费/内购/试用资源：删除后用户可能无法恢复已购内容。AstroBox
                                    内容规范要求“用户付费后应能顺利解锁所购买的内容，重新安装资源后也应能恢复已购内容”，请在删除前处理售后、退款或迁移。
                                </li>
                                <li>
                                    如果其他资源将本资源声明为捆绑项，删除后这些资源的安装可能失败。
                                </li>
                                <li>
                                    重新上架需要重新提交审核；删除索引不会自动清除服务端已有的订单、统计等数据。
                                </li>
                                <li>
                                    删除会以公开 PR 形式记录在社区仓库，维护者可见。
                                </li>
                                {isLegacyItemId(entry.id) && (
                                    <li>
                                        旧版资源（LegacyItem）只会从 v2 索引移除；v1
                                        索引和旧客户端可能仍保留记录。
                                    </li>
                                )}
                            </ul>
                        </section>

                        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    checked={deleteRepository}
                                    disabled={submitting || repoDeleted}
                                    onCheckedChange={(checked) => {
                                        setDeleteRepository(checked === true);
                                        setConfirmation("");
                                    }}
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-white">
                                        同时删除资源所在的 GitHub 仓库
                                    </p>
                                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-white/60">
                                        <GithubLogoIcon
                                            size={14}
                                            weight="duotone"
                                        />
                                        <span className="break-all font-mono text-white/75">
                                            {entry.repo_owner}/{entry.repo_name}
                                        </span>
                                    </p>
                                </div>
                            </div>

                            {deleteRepository && (
                                <div className="mt-3 rounded-lg border border-red-400/25 bg-red-400/[0.06] p-3">
                                    <p className="text-sm font-semibold text-red-100">
                                        删除 GitHub 仓库的后果
                                    </p>
                                    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-5 text-white/70">
                                        <li>
                                            永久删除该仓库的代码、提交历史、Releases、Issues、Stars、Forks、Actions
                                            secrets/settings 等内容，无法恢复。
                                        </li>
                                        <li>
                                            所有指向该仓库的下载、更新、图标/封面/预览链接将失效。
                                        </li>
                                        <li>
                                            已安装用户无法获取更新；已购用户可能无法重新下载或恢复购买内容，可能违反
                                            AstroBox 对付费资源售后的要求。
                                        </li>
                                        <li>
                                            仓库删除后不能通过 AstroBox
                                            恢复；重新发布需要新建仓库并重新审核。
                                        </li>
                                        <li>
                                            如果仓库还包含 README、文档或其他用途，也会一并删除。
                                        </li>
                                    </ul>
                                </div>
                            )}
                        </section>

                        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <p className="text-sm font-semibold text-white">
                                输入下面的确认语句
                            </p>
                            <p className="mt-1 select-all rounded-lg bg-black/30 px-2.5 py-2 font-mono text-xs leading-5 text-white/80">
                                {required}
                            </p>
                            <TextField.Root
                                className="mt-2"
                                value={confirmation}
                                disabled={submitting}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="请逐字输入上方确认语句"
                                onChange={(event) =>
                                    setConfirmation(event.target.value)
                                }
                            />
                            <p className="mt-2 text-xs text-white/50">
                                提交后，仓库 Action
                                会自动关闭该资源其他进行中的 PR（包括之前卡住的删除申请），再处理本次删除。
                            </p>
                        </section>

                        <div className="flex justify-end gap-2">
                            <Dialog.Close>
                                <Button variant="soft" color="gray">
                                    取消
                                </Button>
                            </Dialog.Close>
                            <Button
                                color="red"
                                disabled={
                                    confirmation.trim() !== required ||
                                    submitting
                                }
                                onClick={() => void handleConfirm()}
                            >
                                {submitting && <Spinner size="1" />}
                                确认删除
                            </Button>
                        </div>
                    </div>
                )}

                {phase === "submitting" && (
                    <div
                        className="mt-5 flex flex-col items-center gap-3 py-6"
                        role="status"
                        aria-live="polite"
                    >
                        <Spinner size="3" />
                        <p className="text-sm font-medium text-white/75">
                            {message || "正在处理…"}
                        </p>
                        <p className="text-xs text-white/45">
                            请勿关闭窗口。
                        </p>
                    </div>
                )}

                {phase === "error" && (
                    <div className="mt-4 flex flex-col gap-4">
                        <Callout.Root color="red" variant="soft">
                            <Callout.Icon>
                                <WarningOctagonIcon size={16} weight="fill" />
                            </Callout.Icon>
                            <Callout.Text className="font-semibold">
                                {error || "删除失败，请重试。"}
                            </Callout.Text>
                        </Callout.Root>
                        <div className="flex justify-end gap-2">
                            {scopeMissing && (
                                <Button
                                    variant="soft"
                                    onClick={() => {
                                        onOpenChange(false);
                                        navigate("/settings");
                                    }}
                                >
                                    前往设置
                                </Button>
                            )}
                            <Button
                                variant="soft"
                                color="gray"
                                onClick={() => {
                                    setError("");
                                    setPhase("form");
                                }}
                            >
                                返回修改
                            </Button>
                            <Button
                                variant="soft"
                                color="gray"
                                onClick={() => onOpenChange(false)}
                            >
                                关闭
                            </Button>
                        </div>
                    </div>
                )}

                {phase === "pr-retry" && (
                    <div className="mt-4 flex flex-col gap-4">
                        <Callout.Root color="red" variant="soft">
                            <Callout.Icon>
                                <WarningOctagonIcon size={16} weight="fill" />
                            </Callout.Icon>
                            <Callout.Text className="font-semibold">
                                GitHub 仓库已删除，但删除申请 PR 创建失败。请重试创建
                                PR，避免资源索引继续指向已删除的仓库。
                            </Callout.Text>
                        </Callout.Root>
                        <Callout.Root color="gray" variant="soft">
                            <Callout.Text className="break-all text-xs">
                                {error}
                            </Callout.Text>
                        </Callout.Root>
                        <div className="flex justify-end gap-2">
                            <Button
                                color="red"
                                onClick={() => void retryCreatePullRequest()}
                            >
                                重试创建 PR
                            </Button>
                        </div>
                    </div>
                )}
            </Dialog.Content>
        </Dialog.Root>
    );
}
