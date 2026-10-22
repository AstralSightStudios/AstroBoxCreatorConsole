import {
    CopyIcon,
    EnvelopeSimpleIcon,
    LinkIcon,
    PaperPlaneRightIcon,
    UserMinusIcon,
    XCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
    BetaApi,
    parseUserIdList,
    type BetaInviteLink,
    type BetaInviteResultStatus,
    type BetaTester,
    type BetaTesterStatus,
} from "~/api/astrobox/beta";
import {
    AlertDialog,
    Badge,
    Button,
    Progress,
    Spinner,
    Text,
    TextArea,
    TextField,
} from "~/components/ScaleAwareThemes";
import { SectionCard } from "~/routes/resource/publish/components/shared";
import {
    Avatar,
    BETA_CARD_CLASS,
    describeBetaError,
    displayNameOf,
    formatDateTime,
    formatRelative,
} from "./shared";

const STATUS_LABEL: Record<BetaTesterStatus, { label: string; color: "green" | "amber" | "gray" | "red" }> = {
    active: { label: "已加入", color: "green" },
    invited: { label: "邀请中", color: "amber" },
    left: { label: "已退出", color: "gray" },
    declined: { label: "已拒绝", color: "gray" },
    removed: { label: "已移出", color: "red" },
};

const RESULT_LABEL: Record<BetaInviteResultStatus, string> = {
    invited: "已发送邀请",
    already: "已在测试中",
    not_found: "用户不存在",
    limit: "名额已满",
    self: "不能邀请自己",
};

async function copy(text: string, label: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(`已复制${label}`);
    } catch {
        toast.error("复制失败，请手动复制");
    }
}

export default function TestersPanel({
    programId,
    closed,
    onSeatsChanged,
}: {
    programId: string;
    closed: boolean;
    onSeatsChanged?: (used: number) => void;
}) {
    const [testers, setTesters] = useState<BetaTester[]>([]);
    const [limit, setLimit] = useState(0);
    const [used, setUsed] = useState(0);
    const [links, setLinks] = useState<BetaInviteLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [inviteInput, setInviteInput] = useState("");
    const [inviteNote, setInviteNote] = useState("");
    const [inviting, setInviting] = useState(false);
    const [inviteResults, setInviteResults] = useState<Array<{ userId: string; status: BetaInviteResultStatus }>>([]);
    const [linkMaxUses, setLinkMaxUses] = useState("");
    const [linkDays, setLinkDays] = useState("");
    const [creatingLink, setCreatingLink] = useState(false);
    const [removing, setRemoving] = useState<BetaTester | null>(null);

    const load = useCallback(async () => {
        setError("");
        try {
            const [testerData, linkData] = await Promise.all([
                BetaApi.listTesters(programId),
                BetaApi.listLinks(programId),
            ]);
            setTesters(testerData.testers);
            setLimit(testerData.limit);
            setUsed(testerData.used);
            setLinks(linkData.links);
            onSeatsChanged?.(testerData.used);
        } catch (err) {
            setError(describeBetaError(err, "加载测试者失败"));
        } finally {
            setLoading(false);
        }
    }, [programId, onSeatsChanged]);

    useEffect(() => {
        setLoading(true);
        void load();
    }, [load]);

    const invite = async () => {
        const userIds = parseUserIdList(inviteInput);
        if (userIds.length === 0 || inviting) return;
        setInviting(true);
        try {
            const { results } = await BetaApi.inviteTesters(programId, userIds, inviteNote.trim() || undefined);
            setInviteResults(results);
            const sent = results.filter((item) => item.status === "invited").length;
            if (sent > 0) toast.success(`已向 ${sent} 位用户发送邀请`);
            else toast.warning("没有发出新的邀请");
            setInviteInput(
                results
                    .filter((item) => item.status === "limit" || item.status === "not_found")
                    .map((item) => item.userId)
                    .join("\n"),
            );
            await load();
        } catch (err) {
            toast.error(`邀请失败：${describeBetaError(err)}`);
        } finally {
            setInviting(false);
        }
    };

    const createLink = async () => {
        if (creatingLink) return;
        setCreatingLink(true);
        try {
            const maxUses = Number(linkMaxUses);
            const days = Number(linkDays);
            const link = await BetaApi.createLink(programId, {
                maxUses: Number.isFinite(maxUses) && maxUses > 0 ? maxUses : undefined,
                expiresInDays: Number.isFinite(days) && days > 0 ? days : undefined,
            });
            setLinks((current) => [link, ...current]);
            setLinkMaxUses("");
            setLinkDays("");
            void copy(link.url, "邀请链接");
        } catch (err) {
            toast.error(`创建失败：${describeBetaError(err)}`);
        } finally {
            setCreatingLink(false);
        }
    };

    const revokeLink = async (code: string) => {
        try {
            await BetaApi.revokeLink(programId, code);
            setLinks((current) => current.map((link) => (link.code === code ? { ...link, revoked: true } : link)));
            toast.success("链接已作废");
        } catch (err) {
            toast.error(`作废失败：${describeBetaError(err)}`);
        }
    };

    const removeTester = async () => {
        if (!removing) return;
        const target = removing;
        setRemoving(null);
        try {
            await BetaApi.removeTester(programId, target.userId);
            toast.success(`已移出 ${displayNameOf(target)}`);
            await load();
        } catch (err) {
            toast.error(`移出失败：${describeBetaError(err)}`);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-8 text-sm text-white/60">
                <Spinner size="2" />
                正在加载...
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-3 py-6 text-sm text-red-300">
                {error}
                <Button size="1" variant="soft" onClick={() => void load()}>
                    重试
                </Button>
            </div>
        );
    }

    const activeLinks = links.filter((link) => !link.revoked && !link.expired);
    const inactiveLinks = links.filter((link) => link.revoked || link.expired);

    return (
        <div className="flex flex-col gap-3.5">
            <SectionCard title="测试名额" className={BETA_CARD_CLASS}>
                <div className="flex flex-col gap-2 px-1.5 pb-1.5">
                    <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-semibold text-white">
                            {used}
                            <span className="text-base font-normal text-white/45"> / {limit}</span>
                        </span>
                        {limit === 0 && <Text size="1" color="amber">会员已过期，暂时无法邀请</Text>}
                    </div>
                    <Progress value={limit > 0 ? Math.min(100, (used / limit) * 100) : 0} color={used >= limit ? "amber" : undefined} />
                </div>
            </SectionCard>

            <div className="grid gap-3.5 lg:grid-cols-2">
                <SectionCard
                    title={
                        <span className="flex items-center gap-2">
                            <EnvelopeSimpleIcon size={18} />
                            按用户 ID 邀请
                        </span>
                    }
                    className={BETA_CARD_CLASS}
                >
                    <div className="flex flex-col gap-2 px-1.5 pb-1.5">
                        <TextArea
                            value={inviteInput}
                            rows={3}
                            disabled={closed || inviting}
                            placeholder="用户 ID，逗号或换行分隔"
                            onChange={(event) => setInviteInput(event.target.value)}
                        />
                        <TextField.Root
                            value={inviteNote}
                            maxLength={300}
                            disabled={closed || inviting}
                            placeholder="附言（可选）"
                            onChange={(event) => setInviteNote(event.target.value)}
                        />
                        <div className="flex justify-end">
                            <Button
                                loading={inviting}
                                disabled={closed || parseUserIdList(inviteInput).length === 0}
                                onClick={() => void invite()}
                            >
                                <PaperPlaneRightIcon size={15} />
                                发送邀请
                            </Button>
                        </div>
                        {inviteResults.length > 0 && (
                            <div className="flex flex-col gap-1 rounded-[10px] bg-black/20 p-2">
                                {inviteResults.map((item) => (
                                    <div key={item.userId} className="flex items-center justify-between gap-2 text-xs">
                                        <span className="min-w-0 truncate text-white/70">{item.userId}</span>
                                        <span className={item.status === "invited" ? "text-emerald-300" : "text-amber-200"}>
                                            {RESULT_LABEL[item.status]}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </SectionCard>

                <SectionCard
                    title={
                        <span className="flex items-center gap-2">
                            <LinkIcon size={18} />
                            公开邀请链接
                        </span>
                    }
                    className={BETA_CARD_CLASS}
                >
                    <div className="flex flex-col gap-2 px-1.5 pb-1.5">
                        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                            <TextField.Root
                                value={linkMaxUses}
                                inputMode="numeric"
                                placeholder="可用次数（不限）"
                                disabled={closed || creatingLink}
                                onChange={(event) => setLinkMaxUses(event.target.value.replace(/\D/g, ""))}
                            />
                            <TextField.Root
                                value={linkDays}
                                inputMode="numeric"
                                placeholder="有效天数（永久）"
                                disabled={closed || creatingLink}
                                onChange={(event) => setLinkDays(event.target.value.replace(/\D/g, ""))}
                            />
                            <Button loading={creatingLink} disabled={closed} onClick={() => void createLink()}>
                                生成
                            </Button>
                        </div>
                        {activeLinks.map((link) => (
                            <div
                                key={link.code}
                                className="flex items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.03] px-2.5 py-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-mono text-sm tracking-wider text-white">{link.code}</p>
                                    <p className="text-[11px] text-white/45">
                                        已使用 {link.uses}
                                        {link.maxUses ? ` / ${link.maxUses}` : ""} 次 ·{" "}
                                        {link.expiresAt ? `${formatDateTime(link.expiresAt)} 过期` : "永久有效"}
                                    </p>
                                </div>
                                <Button size="1" variant="soft" color="gray" onClick={() => void copy(link.url, "邀请链接")}>
                                    <CopyIcon size={14} />
                                    复制链接
                                </Button>
                                <Button size="1" variant="ghost" color="red" onClick={() => void revokeLink(link.code)}>
                                    <XCircleIcon size={14} />
                                </Button>
                            </div>
                        ))}
                        {inactiveLinks.length > 0 && (
                            <Text size="1" color="gray" className="px-1">
                                另有 {inactiveLinks.length} 条已作废或过期的链接
                            </Text>
                        )}
                    </div>
                </SectionCard>
            </div>

            <SectionCard title={`测试者（${testers.length}）`} className={BETA_CARD_CLASS}>
                <div className="flex flex-col px-1 pb-1">
                    {testers.length === 0 && (
                        <Text size="2" color="gray" className="px-1.5 py-6 text-center">
                            暂无测试者
                        </Text>
                    )}
                    {testers.map((tester) => {
                        const status = STATUS_LABEL[tester.status];
                        const removable = tester.status === "active" || tester.status === "invited";
                        return (
                            <div
                                key={tester.userId}
                                className="flex items-center gap-3 border-b border-white/5 px-1.5 py-2.5 last:border-b-0"
                            >
                                <Avatar profile={tester} size={34} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium text-white">{displayNameOf(tester)}</span>
                                        <Badge color={status.color} variant="soft" size="1">
                                            {status.label}
                                        </Badge>
                                        <span className="text-[11px] text-white/40">{tester.source === "link" ? "链接加入" : "信箱邀请"}</span>
                                    </div>
                                    <p className="truncate text-[11px] text-white/45">
                                        {tester.userId}
                                        {tester.joinedAt ? ` · ${formatRelative(tester.joinedAt)}加入` : ""}
                                        {tester.lastDownloadedVersion
                                            ? ` · 最近安装 ${tester.lastDownloadedVersion}`
                                            : tester.status === "active"
                                              ? " · 尚未安装"
                                              : ""}
                                        {tester.feedbackCount > 0 ? ` · ${tester.feedbackCount} 条反馈` : ""}
                                    </p>
                                </div>
                                {removable && (
                                    <Button size="1" variant="ghost" color="red" onClick={() => setRemoving(tester)}>
                                        <UserMinusIcon size={15} />
                                        移出
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </SectionCard>

            <AlertDialog.Root open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
                <AlertDialog.Content maxWidth="420px">
                    <AlertDialog.Title>移出测试者</AlertDialog.Title>
                    <AlertDialog.Description size="2">
                        {removing ? displayNameOf(removing) : ""}
                    </AlertDialog.Description>
                    <div className="mt-4 flex justify-end gap-2">
                        <AlertDialog.Cancel>
                            <Button variant="soft" color="gray">
                                取消
                            </Button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action>
                            <Button color="red" onClick={() => void removeTester()}>
                                移出
                            </Button>
                        </AlertDialog.Action>
                    </div>
                </AlertDialog.Content>
            </AlertDialog.Root>
        </div>
    );
}
