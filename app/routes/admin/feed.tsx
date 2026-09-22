import { Badge, Button, Code, Dialog, Select, Spinner, TextField } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FeedAdminApi, type FeedFeature, type FeedItem, type FeedJob, type FeedStatus } from "~/api/astrobox/feed";
import { AdminPage, Panel, formatDateTime, inputClass } from "~/components/admin/AdminPage";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatCount(value: number | undefined) {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

function stateCount(status: FeedStatus | null, kind: string, state: string) {
  return status?.jobs.find((row) => row._id.kind === kind && row._id.state === state)?.count ?? 0;
}

function sourceCount(status: FeedStatus | null, source: string) {
  return status?.sources.filter((row) => row._id.source === source).reduce((sum, row) => sum + row.count, 0) ?? 0;
}

function featureLabel(tag: string) {
  const [, value] = tag.split(":");
  return value || tag;
}

function FeatureList({ features, empty = "暂无" }: { features?: FeedFeature[] | null; empty?: string }) {
  if (!features?.length) return <span className="text-white/35">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {features.map((feature) => (
        <span key={`${feature.tag}:${feature.source}`} className="rounded-md bg-white/10 px-2 py-1 text-xs text-white/80" title={feature.evidence}>
          {featureLabel(feature.tag)} <span className="text-white/40">{Math.round(feature.confidence * 100)}%</span>
        </span>
      ))}
    </div>
  );
}

function StatCard({ label, value, hint, tone = "text-white" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
      <div className="text-xs text-white/50">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-white/40">{hint}</div>}
    </div>
  );
}

function ItemDetail({ item, onClose, onRefresh }: { item: FeedItem; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(item.hidden);
  const [canonical, setCanonical] = useState(item.canonicalGroupId ?? "");
  const save = async () => {
    setSaving(true);
    try {
      await FeedAdminApi.patchItem(item.key, { hidden, canonicalGroupId: canonical.trim() });
      toast.success("资源修订已保存");
      await onRefresh();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setSaving(false); }
  };
  const enrich = async () => {
    setBusy(true);
    try { await FeedAdminApi.enrich(item.key); toast.success("已加入详情与 AI 标注队列"); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content maxWidth="760px">
        <Dialog.Title className="break-all">{item.title || item.key}</Dialog.Title>
        <Dialog.Description className="break-all text-white/50">{item.key}</Dialog.Description>
        <div className="mt-4 grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="来源" value={item.source} />
            <StatCard label="类型" value={item.resourceType || "--"} />
            <StatCard label="状态" value={item.hidden ? "已隐藏" : item.status} />
            <StatCard label="版本" value={item.version || "--"} />
          </div>
          <Panel title="AI 标注">
            <FeatureList features={item.aiFeatures} />
            {item.aiFeatures?.length > 0 && <div className="mt-3 grid gap-2">{item.aiFeatures.map((feature) => <div key={feature.tag} className="rounded-lg bg-black/20 p-2 text-xs text-white/65"><b className="text-white/85">{featureLabel(feature.tag)}</b> · {Math.round(feature.confidence * 100)}% · {feature.evidence}</div>)}</div>}
            <div className="mt-3 text-xs text-white/40">模型：{item.ai?.model || "--"}　标注时间：{formatDateTime(item.ai?.generatedAt)}</div>
          </Panel>
          <Panel title="标签与兼容性">
            <div className="grid gap-3 text-sm"><div><span className="text-white/45">来源标签：</span>{item.sourceTags?.join("、") || "暂无"}</div><div><span className="text-white/45">规则标签：</span><FeatureList features={item.ruleFeatures} /></div><div><span className="text-white/45">确认设备：</span>{item.manualCompatibility?.verifiedDeviceIds?.join(", ") || item.compatibility?.verifiedDeviceIds?.join(", ") || "暂无"}</div><div><span className="text-white/45">可能设备：</span>{item.manualCompatibility?.possibleDeviceIds?.join(", ") || item.compatibility?.possibleDeviceIds?.join(", ") || "暂无"}</div></div>
          </Panel>
          <Panel title="管理员修订">
            <div className="grid gap-3"><label className="flex items-center gap-2 text-sm text-white/75"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> 隐藏此资源</label><label className="grid gap-1 text-sm text-white/70">跨来源作品分组 ID<TextField.Root value={canonical} onChange={(e) => setCanonical(e.target.value)} placeholder="可选，例如 work:2048" /></label></div>
          </Panel>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="soft" onClick={onClose}>关闭</Button><Button variant="soft" onClick={() => void enrich()} disabled={busy}>{busy ? <Spinner /> : "重新标注"}</Button><Button onClick={() => void save()} disabled={saving}>{saving ? <Spinner /> : "保存修订"}</Button></div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export default function AdminFeedPage() {
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const [source, setSource] = useState("");
  const [itemStatus, setItemStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [nextStatus, nextItems, nextJobs] = await Promise.all([FeedAdminApi.status(), FeedAdminApi.items({ source: source || undefined, status: itemStatus || undefined, limit: 100 }), FeedAdminApi.jobs()]);
      setStatus(nextStatus); setItems(nextItems.items); setJobs(nextJobs.items);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [source, itemStatus]);
  useEffect(() => { void load(); }, [load]);

  const filteredItems = useMemo(() => {
    const value = search.trim().toLowerCase();
    return value ? items.filter((item) => `${item.key} ${item.title} ${item.sourceTags?.join(" ")}`.toLowerCase().includes(value)) : items;
  }, [items, search]);
  const aiUsed = status?.states.find((state) => state._id.startsWith("ai-budget:"))?.data?.used as number | undefined;
  const aiPending = stateCount(status, "enrich", "pending") + stateCount(status, "reviews", "pending");
  const run = async (task: "official" | "devices" | "bandbbs" | "enrichment" | "stats" | "profiles") => {
    setAction(task);
    try { await FeedAdminApi.run(task); toast.success("任务已加入队列"); await load(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setAction(""); }
  };
  const retry = async (job: FeedJob) => {
    setAction(job._id);
    try { await FeedAdminApi.retryJob(job._id); toast.success("任务已重新排队"); await load(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setAction(""); }
  };
  return (
    <AdminPage title="Feed 管理" description="仅 admin 可访问。查看目录、AI 标注、同步进度和画像后台任务。" requiredRoles={["admin"]} loading={loading} error={error} onRetry={() => void load()}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="目录资源" value={formatCount(status ? sourceCount(status, "astrobox") + sourceCount(status, "bandbbs") : 0)} hint={`官方 ${formatCount(sourceCount(status, "astrobox"))} · BandBBS ${formatCount(sourceCount(status, "bandbbs"))}`} /><StatCard label="AI 标注" value={formatCount(stateCount(status, "enrich", "done"))} hint={`今日 ${formatCount(aiUsed)} / ${formatCount(status?.aiDailyLimit)}`} tone="text-cyan-200" /><StatCard label="AI 待处理" value={formatCount(aiPending)} hint={`失败 ${formatCount(stateCount(status, "enrich", "failed") + stateCount(status, "reviews", "failed"))}`} tone={aiPending ? "text-amber-200" : "text-emerald-200"} /><StatCard label="待重建画像" value={formatCount(status?.pendingProfiles)} hint={`事件失败 ${formatCount(status?.tracking.failedSinceStart)}`} /></div>
      <Panel title="后台操作" action={<Button size="1" variant="soft" onClick={() => void load()}>刷新</Button>}>
        <div className="flex flex-wrap gap-2">{([ ["bandbbs", "继续 BandBBS 同步"], ["enrichment", "扫描 AI 标注"], ["official", "同步官方目录"], ["stats", "刷新统计"], ["profiles", "重建画像"] ] as const).map(([task, label]) => <Button key={task} size="2" variant="soft" onClick={() => void run(task)} disabled={!!action}>{action === task ? <Spinner /> : label}</Button>)}</div>
        <div className="mt-3 text-xs text-white/45">BandBBS：{status?.bandbbsConfigured ? "已配置" : "未配置"} · worker：{status?.workerEnabled ? "运行中" : "关闭"} · 算法：{status?.algorithmVersion}</div>
      </Panel>
      <Panel title="资源目录" action={<div className="flex flex-wrap gap-2"><TextField.Root placeholder="搜索 key / 标题 / 标签" value={search} onChange={(e) => setSearch(e.target.value)} /><Select.Root value={source || "all"} onValueChange={(v) => setSource(v === "all" ? "" : v)}><Select.Trigger placeholder="来源" /><Select.Content><Select.Item value="all">全部来源</Select.Item><Select.Item value="astrobox">官方</Select.Item><Select.Item value="bandbbs">BandBBS</Select.Item></Select.Content></Select.Root><Select.Root value={itemStatus || "all"} onValueChange={(v) => setItemStatus(v === "all" ? "" : v)}><Select.Trigger placeholder="状态" /><Select.Content><Select.Item value="all">全部状态</Select.Item><Select.Item value="active">active</Select.Item><Select.Item value="stale">stale</Select.Item><Select.Item value="unavailable">unavailable</Select.Item></Select.Content></Select.Root></div>}>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs text-white/45"><tr><th className="px-2 py-2">资源</th><th className="px-2 py-2">来源</th><th className="px-2 py-2">AI 标签</th><th className="px-2 py-2">兼容设备</th><th className="px-2 py-2">状态</th><th /></tr></thead><tbody>{filteredItems.map((item) => <tr key={item.key} className="border-t border-white/5"><td className="max-w-[280px] px-2 py-3"><div className="truncate text-white">{item.title || item.key}</div><Code variant="ghost" className="max-w-full truncate">{item.key}</Code></td><td className="px-2 py-3"><Badge color={item.source === "bandbbs" ? "orange" : "blue"}>{item.source}</Badge></td><td className="max-w-[260px] px-2 py-3"><FeatureList features={item.aiFeatures} /></td><td className="px-2 py-3 text-xs text-white/60">{item.compatibility?.verifiedDeviceIds?.join(", ") || item.compatibility?.possibleDeviceIds?.join(", ") || "--"}</td><td className="px-2 py-3 text-xs text-white/60">{item.hidden ? "hidden" : item.status}</td><td className="px-2 py-3 text-right"><Button size="1" variant="soft" onClick={async () => { try { setSelected(await FeedAdminApi.item(item.key)); } catch (err) { toast.error(errorMessage(err)); } }}>详情</Button></td></tr>)}</tbody></table>{!filteredItems.length && <div className="py-12 text-center text-sm text-white/40">没有匹配资源</div>}</div>
      </Panel>
      <Panel title="失败 / 待处理任务"><div className="grid gap-2">{jobs.filter((job) => job.state === "failed" || job.kind === "enrich").slice(0, 20).map((job) => <div key={job._id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/15 px-3 py-2 text-xs"><span className="font-mono text-white/70">{job.kind} · {job.state} · {job.lastError || "等待处理"}</span>{job.state === "failed" && <Button size="1" variant="soft" onClick={() => void retry(job)} disabled={!!action}>{action === job._id ? <Spinner /> : "重试"}</Button>}</div>)}{!jobs.some((job) => job.state === "failed" || job.kind === "enrich") && <div className="text-sm text-white/40">暂无异常任务</div>}</div></Panel>
      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} onRefresh={async () => { await load(); setSelected(await FeedAdminApi.item(selected.key)); }} />}
    </AdminPage>
  );
}
