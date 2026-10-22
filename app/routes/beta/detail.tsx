import {
    CaretLeftIcon,
    CloudArrowUpIcon,
    DownloadSimpleIcon,
    FlaskIcon,
    ImageSquareIcon,
    PackageIcon,
    TrashIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
    BETA_RESTYPE_LABELS,
    BetaApi,
    formatBytes,
    uploadBetaFile,
    type BetaAuthorProgram,
    type BetaBuild,
} from "~/api/astrobox/beta";
import NavIconButton from "~/components/nav-icon-button";
import PageHeader from "~/components/page-header";
import {
    AlertDialog,
    Badge,
    Button,
    Spinner,
    Tabs,
    Text,
    TextArea,
    TextField,
} from "~/components/ScaleAwareThemes";
import Page from "~/layout/page";
import { pickFiles } from "~/logic/publish/file-picker";
import { SectionCard } from "~/routes/resource/publish/components/shared";
import BuildComposerDialog from "./components/BuildComposerDialog";
import FeedbackPanel from "./components/FeedbackPanel";
import {
    BETA_CARD_CLASS,
    daysUntil,
    describeBetaError,
    formatDateTime,
    ProgramIcon,
    useDeviceCatalog,
} from "./components/shared";
import TestersPanel from "./components/TestersPanel";

const TAB_TRIGGER_CLASS =
    "px-4! py-2! text-sm! text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!";

type Tab = "builds" | "testers" | "feedback" | "settings";
const TABS: Tab[] = ["builds", "testers", "feedback", "settings"];
const DEFAULT_PACKAGE_LIMIT = 256 * 1024 * 1024;

export default function BetaProgramDetailPage() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const programId = params.get("id") ?? "";
    const tabParam = params.get("tab") as Tab | null;
    const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "builds";
    const threadId = params.get("thread");
    const [data, setData] = useState<BetaAuthorProgram | null>(null);
    const [error, setError] = useState("");
    const [composerOpen, setComposerOpen] = useState(false);
    const { options: deviceOptions, nameOf } = useDeviceCatalog();

    const load = useCallback(async () => {
        if (!programId) return;
        setError("");
        try {
            setData(await BetaApi.getProgram(programId));
        } catch (err) {
            setError(describeBetaError(err, "加载失败"));
        }
    }, [programId]);

    useEffect(() => {
        setData(null);
        void load();
    }, [load]);

    const setTab = (next: string) => {
        const nextParams = new URLSearchParams(params);
        nextParams.set("tab", next);
        if (next !== "feedback") nextParams.delete("thread");
        setParams(nextParams, { replace: true });
    };

    if (!programId) {
        return (
            <Page>
                <p className="p-6 text-sm text-white/60">缺少测试 ID</p>
            </Page>
        );
    }

    if (error) {
        return (
            <Page>
                <div className="flex flex-col items-start gap-3 p-6 text-sm text-red-300">
                    {error}
                    <div className="flex gap-2">
                        <Button size="1" variant="soft" color="gray" onClick={() => navigate("/beta")}>
                            返回列表
                        </Button>
                        <Button size="1" variant="soft" onClick={() => void load()}>
                            重试
                        </Button>
                    </div>
                </div>
            </Page>
        );
    }

    if (!data) {
        return (
            <Page>
                <div className="flex items-center gap-2 p-6 text-sm text-white/60">
                    <Spinner size="2" />
                    正在加载...
                </div>
            </Page>
        );
    }

    const { program, builds } = data;
    const closed = program.status === "closed";
    const canPublish = Boolean(data.tier) && !closed;

    return (
        <Page>
            <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
                <div className="flex items-center gap-2">
                    <NavIconButton onClick={() => navigate("/beta")} aria-label="返回">
                        <CaretLeftIcon size={18} />
                    </NavIconButton>
                    <Text size="2" color="gray">
                        测试分发
                    </Text>
                </div>
                <PageHeader
                    title={program.name}
                    description={`${BETA_RESTYPE_LABELS[program.restype]} · ${program.testerCount ?? 0} / ${data.testerLimit} 位测试者${closed ? " · 已关闭" : ""}`}
                    icon={<ProgramIcon src={program.icon} size={36} />}
                    action={
                        <Button disabled={!canPublish} onClick={() => setComposerOpen(true)}>
                            <CloudArrowUpIcon size={16} />
                            发布新版本
                        </Button>
                    }
                />

                <div className="mx-auto w-full max-w-6xl">
                    {!data.tier && (
                        <div className="mb-3 rounded-[12px] bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                            会员已过期，无法发布新版本或邀请测试者
                        </div>
                    )}
                    <Tabs.Root value={tab} onValueChange={setTab}>
                        <Tabs.List className="flex gap-0 border-b border-white/10">
                            <Tabs.Trigger value="builds" className={TAB_TRIGGER_CLASS}>
                                版本
                            </Tabs.Trigger>
                            <Tabs.Trigger value="testers" className={TAB_TRIGGER_CLASS}>
                                测试者
                            </Tabs.Trigger>
                            <Tabs.Trigger value="feedback" className={TAB_TRIGGER_CLASS}>
                                反馈
                            </Tabs.Trigger>
                            <Tabs.Trigger value="settings" className={TAB_TRIGGER_CLASS}>
                                设置
                            </Tabs.Trigger>
                        </Tabs.List>

                        <Tabs.Content value="builds" className="pt-4! outline-none!">
                            <BuildsList
                                builds={builds}
                                nameOf={nameOf}
                                canPublish={canPublish}
                                onCompose={() => setComposerOpen(true)}
                                onChanged={load}
                            />
                        </Tabs.Content>
                        <Tabs.Content value="testers" className="pt-4! outline-none!">
                            <TestersPanel programId={program.id} closed={closed || !data.tier} />
                        </Tabs.Content>
                        <Tabs.Content value="feedback" className="pt-4! outline-none!">
                            <FeedbackPanel programId={program.id} initialThreadId={threadId} />
                        </Tabs.Content>
                        <Tabs.Content value="settings" className="pt-4! outline-none!">
                            <SettingsPanel data={data} onSaved={setData} onDeleted={() => navigate("/beta", { replace: true })} />
                        </Tabs.Content>
                    </Tabs.Root>
                </div>
            </div>

            <BuildComposerDialog
                open={composerOpen}
                onOpenChange={setComposerOpen}
                programId={program.id}
                restype={program.restype}
                deviceOptions={deviceOptions}
                previous={builds.find((build) => build.status === "active") ?? null}
                topVersionCode={data.topVersionCode ?? Math.max(0, ...builds.map((build) => build.versionCode))}
                maxPackageBytes={DEFAULT_PACKAGE_LIMIT}
                onCreated={() => void load()}
            />
        </Page>
    );
}

function BuildsList({
    builds,
    nameOf,
    canPublish,
    onCompose,
    onChanged,
}: {
    builds: BetaBuild[];
    nameOf: (id: string) => string;
    canPublish: boolean;
    onCompose: () => void;
    onChanged: () => Promise<void>;
}) {
    const [deleting, setDeleting] = useState<BetaBuild | null>(null);

    const remove = async () => {
        if (!deleting) return;
        const target = deleting;
        setDeleting(null);
        try {
            await BetaApi.deleteBuild(target.id);
            toast.success(`已删除版本 ${target.version}`);
            await onChanged();
        } catch (err) {
            toast.error(`删除失败：${describeBetaError(err)}`);
        }
    };

    if (builds.length === 0) {
        return (
            <div className="flex flex-col items-center gap-3 rounded-[14px] bg-nav-item px-6 py-14 text-center">
                <PackageIcon size={34} weight="duotone" className="text-white/50" />
                <p className="text-base font-medium text-white">还没有测试版本</p>
                <Button disabled={!canPublish} onClick={onCompose}>
                    <CloudArrowUpIcon size={16} />
                    发布第一个版本
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2.5">
            {builds.map((build, index) => {
                const remaining = daysUntil(build.expiresAt);
                const expired = build.status !== "active";
                return (
                    <div key={build.id} className={`flex flex-col gap-2.5 rounded-[14px] bg-nav-item p-3.5 ${expired ? "opacity-60" : ""}`}>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-medium text-white">{build.version}</span>
                            <span className="text-xs text-white/40">versionCode {build.versionCode}</span>
                            {index === 0 && !expired && (
                                <Badge color="green" variant="soft" size="1">
                                    最新
                                </Badge>
                            )}
                            {expired ? (
                                <Badge color="gray" variant="soft" size="1">
                                    已过期
                                </Badge>
                            ) : remaining !== null && remaining <= 14 ? (
                                <Badge color="amber" variant="soft" size="1">
                                    {remaining} 天后过期
                                </Badge>
                            ) : null}
                            <span className="ml-auto flex items-center gap-3 text-xs text-white/45">
                                <span className="flex items-center gap-1">
                                    <DownloadSimpleIcon size={13} />
                                    {build.downloads ?? 0}
                                </span>
                                <span>{formatDateTime(build.createdAt)}</span>
                                {!expired && (
                                    <button
                                        type="button"
                                        className="text-white/45 transition hover:text-red-300"
                                        onClick={() => setDeleting(build)}
                                        aria-label="删除版本"
                                    >
                                        <TrashIcon size={15} />
                                    </button>
                                )}
                            </span>
                        </div>
                        {build.changelog && <p className="whitespace-pre-wrap text-sm text-white/75">{build.changelog}</p>}
                        <div className="flex flex-col gap-1.5">
                            {build.files.map((file) => (
                                <div key={file.fileId} className="flex flex-col gap-1 rounded-[10px] bg-black/20 px-2.5 py-2">
                                    <div className="flex items-center gap-2 text-sm text-white/85">
                                        <PackageIcon size={15} className="shrink-0 text-white/50" />
                                        <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                                        <span className="shrink-0 text-xs text-white/40">{formatBytes(file.size)}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {file.devices.map((device) => (
                                            <span key={device} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/65">
                                                {nameOf(device)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}

            <AlertDialog.Root open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
                <AlertDialog.Content maxWidth="420px">
                    <AlertDialog.Title>删除版本 {deleting?.version}</AlertDialog.Title>
                    <AlertDialog.Description size="2">此操作无法撤销。</AlertDialog.Description>
                    <div className="mt-4 flex justify-end gap-2">
                        <AlertDialog.Cancel>
                            <Button variant="soft" color="gray">
                                取消
                            </Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                            <Button color="red" onClick={() => void remove()}>
                                删除
                            </Button>
                        </AlertDialog.Action>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Root>
        </div>
    );
}

function SettingsPanel({
    data,
    onSaved,
    onDeleted,
}: {
    data: BetaAuthorProgram;
    onSaved: (data: BetaAuthorProgram) => void;
    onDeleted: () => void;
}) {
    const { program } = data;
    const [name, setName] = useState(program.name);
    const [description, setDescription] = useState(program.description);
    const [watchfaceId, setWatchfaceId] = useState(program.watchfaceId ?? "");
    const [resourceId, setResourceId] = useState(program.resourceId ?? "");
    const [saving, setSaving] = useState(false);
    const [iconUploading, setIconUploading] = useState(false);
    const [togglingStatus, setTogglingStatus] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const dirty =
        name.trim() !== program.name ||
        description.trim() !== program.description ||
        (watchfaceId.trim() || null) !== program.watchfaceId ||
        (resourceId.trim() || null) !== program.resourceId;

    const apply = (next: typeof program) => onSaved({ ...data, program: { ...program, ...next } });

    const save = async () => {
        if (!name.trim() || saving) return;
        setSaving(true);
        try {
            const updated = await BetaApi.updateProgram(program.id, {
                name: name.trim(),
                description: description.trim(),
                watchfaceId: program.restype === "watchface" ? watchfaceId.trim() || null : null,
                resourceId: resourceId.trim() || null,
            });
            apply(updated);
            toast.success("已保存");
        } catch (err) {
            toast.error(`保存失败：${describeBetaError(err)}`);
        } finally {
            setSaving(false);
        }
    };

    const changeIcon = async () => {
        const [file] = await pickFiles({ accept: "png,jpg,jpeg,webp", title: "选择图标" });
        if (!file) return;
        setIconUploading(true);
        try {
            const uploaded = await uploadBetaFile(program.id, "image", file);
            apply(await BetaApi.updateProgram(program.id, { iconFileId: uploaded.id }));
            toast.success("图标已更新");
        } catch (err) {
            toast.error(`上传失败：${describeBetaError(err)}`);
        } finally {
            setIconUploading(false);
        }
    };

    const toggleStatus = async () => {
        setTogglingStatus(true);
        try {
            apply(
                await BetaApi.updateProgram(program.id, {
                    status: program.status === "active" ? "closed" : "active",
                }),
            );
        } catch (err) {
            toast.error(describeBetaError(err));
        } finally {
            setTogglingStatus(false);
        }
    };

    const remove = async () => {
        setConfirmDelete(false);
        try {
            await BetaApi.deleteProgram(program.id);
            toast.success("测试已删除");
            onDeleted();
        } catch (err) {
            toast.error(`删除失败：${describeBetaError(err)}`);
        }
    };

    return (
        <div className="flex flex-col gap-3.5">
            <SectionCard title="基本信息" className={BETA_CARD_CLASS}>
                <div className="flex flex-col gap-3 px-1.5 pb-1.5">
                    <div className="flex items-center gap-3">
                        <ProgramIcon src={program.icon} size={56} />
                        <Button variant="soft" color="gray" loading={iconUploading} onClick={() => void changeIcon()}>
                            <ImageSquareIcon size={15} />
                            更换图标
                        </Button>
                    </div>
                    <label className="flex flex-col gap-1.5">
                        <Text size="2" weight="medium">
                            名称
                        </Text>
                        <TextField.Root value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <Text size="2" weight="medium">
                            介绍
                        </Text>
                        <TextArea value={description} rows={4} maxLength={4000} onChange={(event) => setDescription(event.target.value)} />
                    </label>
                    {program.restype === "watchface" && (
                        <label className="flex flex-col gap-1.5">
                            <Text size="2" weight="medium">
                                表盘 ID
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
                            关联的已上架资源 ID
                        </Text>
                        <TextField.Root value={resourceId} placeholder="可选" onChange={(event) => setResourceId(event.target.value)} />
                    </label>
                    <div className="flex justify-end">
                        <Button loading={saving} disabled={!dirty || !name.trim()} onClick={() => void save()}>
                            保存
                        </Button>
                    </div>
                </div>
            </SectionCard>

            <SectionCard title={program.status === "active" ? "关闭测试" : "重新开放测试"} className={BETA_CARD_CLASS}>
                <div className="px-1.5 pb-1.5">
                    <Button variant="soft" color={program.status === "active" ? "amber" : "green"} loading={togglingStatus} onClick={() => void toggleStatus()}>
                        <FlaskIcon size={15} />
                        {program.status === "active" ? "关闭测试" : "重新开放"}
                    </Button>
                </div>
            </SectionCard>

            <SectionCard title="删除测试" className={BETA_CARD_CLASS}>
                <div className="px-1.5 pb-1.5">
                    <Button variant="soft" color="red" onClick={() => setConfirmDelete(true)}>
                        <TrashIcon size={15} />
                        删除测试
                    </Button>
                </div>
            </SectionCard>

            <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialog.Content maxWidth="420px">
                    <AlertDialog.Title>删除「{program.name}」</AlertDialog.Title>
                    <AlertDialog.Description size="2">此操作无法撤销。</AlertDialog.Description>
                    <div className="mt-4 flex justify-end gap-2">
                        <AlertDialog.Cancel>
                            <Button variant="soft" color="gray">
                                取消
                            </Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                            <Button color="red" onClick={() => void remove()}>
                                删除
                            </Button>
                        </AlertDialog.Action>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Root>
        </div>
    );
}
