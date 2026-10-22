import { ChatsCircleIcon, FlaskIcon, PlusIcon, UsersThreeIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
    BETA_RESTYPE_LABELS,
    BetaApi,
    formatBytes,
    type BetaOverview,
    type BetaRestype,
} from "~/api/astrobox/beta";
import PageHeader from "~/components/page-header";
import { Badge, Button, Dialog, Progress, Select, Spinner, Text, TextArea, TextField } from "~/components/ScaleAwareThemes";
import Page from "~/layout/page";
import { hasCreatorPlusOrAbove } from "~/logic/account/permissions";
import { useDisplayAccount } from "~/logic/account/store";
import { SectionCard } from "~/routes/resource/publish/components/shared";
import { BETA_CARD_CLASS, describeBetaError, formatRelative, ProgramIcon } from "./components/shared";

export default function BetaProgramsPage() {
    const navigate = useNavigate();
    const account = useDisplayAccount();
    const [overview, setOverview] = useState<BetaOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        setError("");
        try {
            setOverview(await BetaApi.overview());
        } catch (err) {
            setError(describeBetaError(err, "加载失败"));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!account.hasAstrobox) {
            setLoading(false);
            return;
        }
        void load();
    }, [account.hasAstrobox, load]);

    // 以服务端实时档位为准；接口没回来前先看本地账号信息
    const eligible = overview ? Boolean(overview.tier) : hasCreatorPlusOrAbove(account.plan);
    const programs = overview?.programs ?? [];
    const limits = overview?.limits;

    return (
        <Page>
            <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
                <PageHeader
                    title="测试分发"
                    icon={<FlaskIcon size={25} className="text-purple-300" />}
                    action={
                        eligible ? (
                            <Button onClick={() => setCreating(true)} disabled={loading}>
                                <PlusIcon size={15} />
                                新建测试
                            </Button>
                        ) : undefined
                    }
                />

                <div className="mx-auto flex w-full max-w-6xl flex-col gap-3.5">
                    {!account.hasAstrobox ? (
                        <SectionCard title="请先登录 AstroBox 账号" className={BETA_CARD_CLASS}>
                            <span />
                        </SectionCard>
                    ) : loading ? (
                        <div className="flex items-center gap-2 py-10 text-sm text-white/60">
                            <Spinner size="2" />
                            正在加载...
                        </div>
                    ) : error ? (
                        <SectionCard title="加载失败" description={error} className={BETA_CARD_CLASS}>
                            <div className="px-1.5 pb-1.5">
                                <Button size="1" variant="soft" onClick={() => void load()}>
                                    重试
                                </Button>
                            </div>
                        </SectionCard>
                    ) : (
                        <>
                            {!eligible && (
                                <div className="flex items-center gap-2 rounded-[12px] bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                                    <WarningOctagonIcon size={16} weight="fill" />
                                    {programs.length > 0 ? "会员已过期，无法发布新版本或邀请测试者" : "需要 CreatorPlus 或更高会员"}
                                </div>
                            )}

                            {limits && overview && (
                                <div className="grid gap-2.5 sm:grid-cols-3">
                                    <QuotaCard label="会员档位" value={overview.tier ?? "--"} hint={`测试者上限 ${limits.testersPerProgram}`} />
                                    <QuotaCard
                                        label="测试包存储"
                                        value={`${formatBytes(overview.storageUsedBytes)} / ${formatBytes(limits.storageBytes)}`}
                                        progress={overview.storageUsedBytes / limits.storageBytes}
                                        hint={`版本保留 ${limits.buildTtlDays} 天`}
                                    />
                                    <QuotaCard label="测试项目" value={`${programs.length} / ${limits.programs}`} hint={`单包上限 ${formatBytes(limits.packageBytes)}`} />
                                </div>
                            )}

                            {programs.length === 0 ? (
                                eligible && (
                                    <div className="flex flex-col items-center gap-3 rounded-[14px] bg-nav-item px-6 py-14 text-center">
                                        <FlaskIcon size={36} weight="duotone" className="text-purple-200/80" />
                                        <p className="text-base font-medium text-white">还没有测试项目</p>
                                        <Button onClick={() => setCreating(true)}>
                                            <PlusIcon size={15} />
                                            新建测试
                                        </Button>
                                    </div>
                                )
                            ) : (
                                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                                    {programs.map((program) => (
                                        <button
                                            key={program.id}
                                            type="button"
                                            onClick={() => navigate(`/beta/detail?id=${encodeURIComponent(program.id)}`)}
                                            className="flex flex-col gap-3 rounded-[14px] bg-nav-item p-3.5 text-left transition hover:bg-white/[0.06]"
                                        >
                                            <div className="flex items-center gap-3">
                                                <ProgramIcon src={program.icon} />
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-[15px] font-medium text-white">{program.name}</p>
                                                    <div className="mt-0.5 flex items-center gap-1.5">
                                                        <Badge variant="soft" color="gray" size="1">
                                                            {BETA_RESTYPE_LABELS[program.restype]}
                                                        </Badge>
                                                        {program.status === "closed" && (
                                                            <Badge variant="soft" color="red" size="1">
                                                                已关闭
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-white/55">
                                                <span className="truncate">
                                                    {program.latestBuild ? `最新 ${program.latestBuild.version}` : "尚未发布版本"}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <UsersThreeIcon size={13} />
                                                    {program.testerCount ?? 0}
                                                    {limits ? ` / ${limits.testersPerProgram}` : ""}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <ChatsCircleIcon size={13} />
                                                    {program.openFeedback ?? 0}
                                                    {(program.unreadFeedback ?? 0) > 0 && (
                                                        <span className="size-1.5 rounded-full bg-sky-400" />
                                                    )}
                                                </span>
                                                <span className="ml-auto shrink-0 text-white/35">{formatRelative(program.updatedAt)}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <CreateProgramDialog
                open={creating}
                onOpenChange={setCreating}
                onCreated={(id) => navigate(`/beta/detail?id=${encodeURIComponent(id)}`)}
            />
        </Page>
    );
}

function QuotaCard({ label, value, hint, progress }: { label: string; value: string; hint?: string; progress?: number }) {
    return (
        <div className="flex flex-col gap-1.5 rounded-[14px] bg-nav-item px-3.5 py-3">
            <Text size="1" color="gray">
                {label}
            </Text>
            <p className="text-lg font-semibold text-white">{value}</p>
            {progress !== undefined && (
                <Progress value={Math.min(100, Math.max(0, progress * 100))} size="1" color={progress > 0.9 ? "amber" : undefined} />
            )}
            {hint && <p className="text-[11px] text-white/40">{hint}</p>}
        </div>
    );
}

function CreateProgramDialog({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (programId: string) => void;
}) {
    const [name, setName] = useState("");
    const [restype, setRestype] = useState<BetaRestype>("quick_app");
    const [description, setDescription] = useState("");
    const [watchfaceId, setWatchfaceId] = useState("");
    const [resourceId, setResourceId] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName("");
        setRestype("quick_app");
        setDescription("");
        setWatchfaceId("");
        setResourceId("");
    }, [open]);

    const submit = async () => {
        if (!name.trim() || submitting) return;
        setSubmitting(true);
        try {
            const program = await BetaApi.createProgram({
                name: name.trim(),
                restype,
                description: description.trim(),
                watchfaceId: restype === "watchface" ? watchfaceId.trim() || null : null,
                resourceId: resourceId.trim() || null,
            });
            toast.success("测试已创建");
            onOpenChange(false);
            onCreated(program.id);
        } catch (err) {
            toast.error(`创建失败：${describeBetaError(err)}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
            <Dialog.Content maxWidth="520px" aria-describedby={undefined}>
                <Dialog.Title>新建测试</Dialog.Title>
                <div className="mt-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                        <Text size="2" weight="medium">
                            名称
                        </Text>
                        <TextField.Root value={name} maxLength={60} placeholder="资源名称" onChange={(event) => setName(event.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <Text size="2" weight="medium">
                            资源类型
                        </Text>
                        <Select.Root value={restype} onValueChange={(value) => setRestype(value as BetaRestype)}>
                            <Select.Trigger />
                            <Select.Content position="popper">
                                {(Object.keys(BETA_RESTYPE_LABELS) as BetaRestype[]).map((type) => (
                                    <Select.Item key={type} value={type}>
                                        {BETA_RESTYPE_LABELS[type]}
                                    </Select.Item>
                                ))}
                            </Select.Content>
                        </Select.Root>
                    </label>
                    {restype === "watchface" && (
                        <label className="flex flex-col gap-1.5">
                            <Text size="2" weight="medium">
                                表盘 ID（可选）
                            </Text>
                            <TextField.Root
                                value={watchfaceId}
                                maxLength={16}
                                placeholder="留空使用包内 ID"
                                onChange={(event) => setWatchfaceId(event.target.value)}
                            />
                        </label>
                    )}
                    <label className="flex flex-col gap-1.5">
                        <Text size="2" weight="medium">
                            介绍（可选）
                        </Text>
                        <TextArea
                            value={description}
                            rows={3}
                            maxLength={4000}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <Text size="2" weight="medium">
                            关联的已上架资源 ID（可选）
                        </Text>
                        <TextField.Root value={resourceId} placeholder="如 com.example.weather" onChange={(event) => setResourceId(event.target.value)} />
                    </label>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <Button variant="soft" color="gray" disabled={submitting} onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button loading={submitting} disabled={!name.trim()} onClick={() => void submit()}>
                        创建
                    </Button>
                </div>
            </Dialog.Content>
        </Dialog.Root>
    );
}
