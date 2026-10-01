import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Checkbox,
  Spinner,
  Table,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  ArrowsClockwiseIcon,
  CheckIcon,
  TicketIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchAfdianOrders,
  filterAfdianOrdersBySku,
  type AfdianOrder,
} from "~/api/afdian";
import {
  listSellerResourceConfigs,
  reconcileAfdianOrders,
  reissueAfdianOrders,
  type AfdianReissueCandidate,
} from "~/api/astrobox/order";
import { loadOwnedCatalogResourcesForCurrentUser } from "~/logic/publish/resources";
import { SectionCard } from "~/routes/resource/publish/components/shared";

function afdianReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    missing_webhook: "疑似漏单",
    order_granted_but_entitlement_missing: "订单已记录但权益缺失",
    already_granted: "已拥有权益",
    buyer_not_bound: "买家尚未绑定 AstroBox",
    seller_inactive: "卖家当前不可接新单",
    sku_mapping_invalid: "SKU 映射已失效",
    invalid_order: "订单数据无效",
    reissued: "已补发",
    server_error: "服务端处理失败",
  };
  return labels[reason] || reason;
}

function formatAfdianTime(value: string) {
  if (!value) return "未提供购买时间";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "未提供购买时间"
    : date.toLocaleString();
}

/** 爱发电补发：核对订单与权益差异并批量补发。 */
export function AfdianReissueManager() {
const queryClient = useQueryClient();
const [afdianUserId, setAfdianUserId] = useState("");
const [afdianToken, setAfdianToken] = useState("");
const [afdianStartDate, setAfdianStartDate] = useState("");
const [syncProgress, setSyncProgress] = useState("");
const [ordersById, setOrdersById] = useState<Map<string, AfdianOrder>>(
  new Map(),
);
const [candidates, setCandidates] = useState<AfdianReissueCandidate[]>([]);
const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
const [syncing, setSyncing] = useState(false);
const [reissuing, setReissuing] = useState(false);
const [error, setError] = useState("");
const [candidateSearch, setCandidateSearch] = useState("");
const [candidatePage, setCandidatePage] = useState(1);

const { data: resourceConfigs } = useQuery({
  queryKey: ["sellerResourceConfigsForAfdianReissue"],
  queryFn: () => listSellerResourceConfigs(),
});

const { data: ownedResources = [] } = useQuery({
  queryKey: ["ownedCatalogResourcesForAfdianReissue"],
  queryFn: loadOwnedCatalogResourcesForCurrentUser,
});

const resourceNameMap = useMemo(
  () => new Map(ownedResources.map((item) => [item.entry.id, item.entry.name || item.entry.id])),
  [ownedResources],
);

const afdianSkus = useMemo(
  () =>
    (resourceConfigs?.skus || []).filter(
      (sku) =>
        sku.platform === "afd" &&
        sku.enabled &&
        sku.isPaid &&
        sku.validationStatus === "active",
    ),
  [resourceConfigs],
);

const selectableCandidates = useMemo(
  () => candidates.filter((candidate) => candidate.canReissue),
  [candidates],
);
const selectedCandidates = useMemo(
  () => selectableCandidates.filter((candidate) => selectedKeys.has(candidate.key)),
  [selectableCandidates, selectedKeys],
);
const filteredCandidates = useMemo(() => {
  const query = candidateSearch.trim().toLowerCase();
  if (!query) return candidates;

  return candidates.filter((candidate) =>
    [
      resourceNameMap.get(candidate.resourceId),
      candidate.resourceId,
      candidate.deviceId,
      candidate.buyerUserId,
      candidate.buyerPlatformUserId,
      candidate.externalOrderId,
      candidate.externalProductId,
      candidate.externalSkuId,
      afdianReasonLabel(candidate.reason),
    ].some((value) => value?.toLowerCase().includes(query)),
  );
}, [candidateSearch, candidates, resourceNameMap]);
const filteredSelectableCandidates = useMemo(
  () => filteredCandidates.filter((candidate) => candidate.canReissue),
  [filteredCandidates],
);
const candidatePageSize = 50;
const candidatePageCount = Math.max(
  1,
  Math.ceil(filteredCandidates.length / candidatePageSize),
);
const visibleCandidates = useMemo(
  () =>
    filteredCandidates.slice(
      (candidatePage - 1) * candidatePageSize,
      candidatePage * candidatePageSize,
    ),
  [candidatePage, filteredCandidates],
);

useEffect(() => {
  setCandidatePage(1);
}, [candidateSearch, candidates]);

useEffect(() => {
  setCandidatePage((previous) => Math.min(previous, candidatePageCount));
}, [candidatePageCount]);

const toggleSelected = (key: string, checked: boolean) => {
  setSelectedKeys((previous) => {
    const next = new Set(previous);
    if (checked) next.add(key);
    else next.delete(key);
    return next;
  });
};

const selectAll = (checked: boolean) => {
  setSelectedKeys((previous) => {
    const next = new Set(previous);
    filteredSelectableCandidates.forEach((candidate) => {
      if (checked) next.add(candidate.key);
      else next.delete(candidate.key);
    });
    return next;
  });
};

const handleSync = async () => {
  if (!afdianSkus.length) {
    toast.error("请先在资源发布配置中登记爱发电付费 SKU");
    return;
  }
  if (!afdianUserId.trim() || !afdianToken.trim()) {
    toast.error("请输入爱发电 user_id 和 API token");
    return;
  }

  setSyncing(true);
  setError("");
  setSyncProgress("正在准备拉取订单...");
  setCandidates([]);
  setSelectedKeys(new Set());
  try {
    const orders = await fetchAfdianOrders(afdianUserId, afdianToken, {
      startDate: afdianStartDate || undefined,
      onProgress: ({ page, totalPages, fetchedOrders, totalOrders }) => {
        setSyncProgress(
          `正在拉取订单：第 ${page}/${totalPages} 页，已读取 ${fetchedOrders}${totalOrders ? `/${totalOrders}` : ""} 笔`,
        );
      },
    });
    const relevantOrders = filterAfdianOrdersBySku(orders, afdianSkus);
    const orderMap = new Map(
      relevantOrders.map((order) => [order.out_trade_no, order]),
    );
    setOrdersById(orderMap);

    const reconciled: AfdianReissueCandidate[] = [];
    let skippedOrders = 0;
    let matchedItems = 0;
    for (let index = 0; index < relevantOrders.length; index += 500) {
      const batch = relevantOrders.slice(index, index + 500);
      setSyncProgress(
        `正在校对订单：${Math.min(index + batch.length, relevantOrders.length)}/${relevantOrders.length} 笔`,
      );
      const response = await reconcileAfdianOrders({
        orders: batch,
      });
      reconciled.push(...response.candidates);
      skippedOrders += response.skippedOrders;
      matchedItems += response.matchedItems;
    }
    setCandidates(reconciled);
    setSelectedKeys(
      new Set(
        reconciled
          .filter((candidate) => candidate.canReissue)
          .map((candidate) => candidate.key),
      ),
    );
    toast.success(
      `校对完成：${matchedItems} 个已登记 SKU，发现 ${reconciled.filter((candidate) => candidate.canReissue).length} 个可补发项${skippedOrders ? `，跳过 ${skippedOrders} 笔订单` : ""}`,
    );
  } catch (err) {
    const message = (err as Error)?.message || "订单校对失败";
    setError(message);
    toast.error(message);
  } finally {
    setAfdianToken("");
    setSyncing(false);
  }
};

const handleReissue = async () => {
  if (selectedCandidates.length === 0) {
    toast.error("请先选择可补发项");
    return;
  }

  setReissuing(true);
  setError("");
  try {
    const allResults = [] as Awaited<ReturnType<typeof reissueAfdianOrders>>["results"];
    for (let index = 0; index < selectedCandidates.length; index += 500) {
      setSyncProgress(
        `正在补发订单：${Math.min(index + 500, selectedCandidates.length)}/${selectedCandidates.length} 项`,
      );
      const items = selectedCandidates.slice(index, index + 500).flatMap((candidate) => {
        const order = ordersById.get(candidate.externalOrderId);
        return order
          ? [{
              order,
              externalSkuId: candidate.externalSkuId,
              resourceId: candidate.resourceId,
              deviceId: candidate.deviceId,
            }]
          : [];
      });
      if (items.length > 0) {
        const response = await reissueAfdianOrders({ items });
        allResults.push(...response.results);
      }
    }

    const resultByKey = new Map(allResults.map((result) => [result.key, result]));
    setCandidates((previous) =>
      previous.map((candidate) => {
        const result = resultByKey.get(candidate.key);
        return result
          ? {
              ...candidate,
              canReissue: false,
              buyerUserId: result.buyerUserId || candidate.buyerUserId,
              reason: result.reason,
            }
          : candidate;
      }),
    );
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      allResults.filter((result) => result.ok).forEach((result) => next.delete(result.key));
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ["encryptedResources"] });
    const succeeded = allResults.filter((result) => result.status === "granted").length;
    const skipped = allResults.filter((result) => result.status === "skipped").length;
    const failed = allResults.filter((result) => !result.ok).length;
    if (failed > 0) {
      toast.warning(`补发完成：成功 ${succeeded} 项，已跳过 ${skipped} 项，失败 ${failed} 项`);
    } else {
      toast.success(`补发完成：成功 ${succeeded} 项，已跳过 ${skipped} 项`);
    }
  } catch (err) {
    const message = (err as Error)?.message || "补发失败";
    setError(message);
    toast.error(message);
  } finally {
    setReissuing(false);
  }
};

return (
  <SectionCard
    title="爱发电订单自助补发"
    description="从爱发电历史订单中校对 Webhook 漏单，仅处理已登记的付费 SKU"
  >
    <div className="flex flex-col gap-4">
      <Callout.Root color="blue" variant="soft" className="bg-transparent! p-3!">
        <Callout.Text className="text-xs leading-relaxed text-white/70">
          API token 仅在本次同步期间使用，不会上传 AstroBox 服务端或保存到本地。请从爱发电开发者后台复制 user_id 和 API token。
        </Callout.Text>
      </Callout.Root>

      {!resourceConfigs && (
        <div className="flex items-center gap-2 text-sm text-white/60">
          <Spinner size="2" /> 正在加载已登记 SKU...
        </div>
      )}
      {resourceConfigs && afdianSkus.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-5 text-center text-sm text-white/60">
          还没有登记爱发电付费 SKU，请先在资源发布时配置商品和 SKU 映射。
        </div>
      )}
      {afdianSkus.length > 0 && (
        <>
          <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3.5 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)_auto] md:items-end">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">爱发电 user_id</span>
              <TextField.Root
                size="2"
                value={afdianUserId}
                onChange={(event) => setAfdianUserId(event.target.value)}
                placeholder="开发者后台的 user_id"
                radius="large"
                disabled={syncing || reissuing}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">API token（本次使用）</span>
              <TextField.Root
                size="2"
                type="password"
                value={afdianToken}
                onChange={(event) => setAfdianToken(event.target.value)}
                placeholder="不会保存或上传到本站"
                radius="large"
                disabled={syncing || reissuing}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">最早订单日期（可选）</span>
              <TextField.Root
                size="2"
                type="date"
                value={afdianStartDate}
                onChange={(event) => setAfdianStartDate(event.target.value)}
                disabled={syncing || reissuing}
                radius="large"
              />
            </label>
            <Button size="2" onClick={() => void handleSync()} disabled={syncing || reissuing}>
              {syncing ? <Spinner size="2" /> : <ArrowsClockwiseIcon size={16} />}
              {syncing ? (syncProgress || "正在校对...") : "拉取并校对"}
            </Button>
          </div>

          {(syncing || reissuing) && syncProgress && (
            <div className="flex items-center gap-2 text-sm text-white/65">
              <Spinner size="1" />
              <span>{syncProgress}</span>
            </div>
          )}

          {error && (
            <Callout.Root color="red" variant="soft" className="bg-transparent! p-3!">
              <Callout.Icon><WarningOctagonIcon size={16} weight="fill" /></Callout.Icon>
              <Callout.Text className="font-semibold">{error}</Callout.Text>
            </Callout.Root>
          )}

          {candidates.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-white/75">
                  <Checkbox
                    checked={filteredSelectableCandidates.length > 0 && filteredSelectableCandidates.every((candidate) => selectedKeys.has(candidate.key))}
                    onCheckedChange={(value) => selectAll(value === true)}
                    disabled={reissuing || filteredSelectableCandidates.length === 0}
                  />
                  <span>可补发 {selectableCandidates.length} 项，已选择 {selectedCandidates.length} 项</span>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <TextField.Root
                    size="2"
                    value={candidateSearch}
                    onChange={(event) => setCandidateSearch(event.target.value)}
                    placeholder="搜索资源、设备、买家、订单或 SKU"
                    radius="large"
                    disabled={reissuing}
                  />
                  <Button size="2" onClick={() => void handleReissue()} disabled={reissuing || selectedCandidates.length === 0}>
                    {reissuing ? <Spinner size="2" /> : <CheckIcon size={16} />}
                    {reissuing ? (syncProgress || "正在补发...") : `补发已选（${selectedCandidates.length}）`}
                  </Button>
                </div>
              </div>
              {candidateSearch.trim() && (
                <div className="text-xs text-white/50">
                  当前搜索匹配 {filteredCandidates.length} 项
                </div>
              )}
              <div className="w-full overflow-x-auto">
                <Table.Root className="w-full min-w-220">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell className="w-10">选择</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>资源 / 设备</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>买家</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>订单</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>购买时间</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {visibleCandidates.map((candidate) => (
                      <Table.Row key={candidate.key}>
                        <Table.Cell>
                          <Checkbox
                            checked={selectedKeys.has(candidate.key)}
                            onCheckedChange={(value) => toggleSelected(candidate.key, value === true)}
                            disabled={!candidate.canReissue || reissuing}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium text-white">{resourceNameMap.get(candidate.resourceId) || candidate.resourceId}</span>
                            <span className="text-xs text-white/55">{candidate.resourceId} · {candidate.deviceId}</span>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm text-white/80">{candidate.buyerUserId || "未绑定 AstroBox"}</span>
                            <span className="font-mono-sarasa text-xs text-white/45">{candidate.buyerPlatformUserId}</span>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono-sarasa text-xs text-white/80">{candidate.externalOrderId}</span>
                            <span className="text-xs text-white/45">SKU {candidate.externalSkuId}</span>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm text-white/70">{formatAfdianTime(candidate.purchaseTime)}</span>
                            {candidate.amount && <span className="text-xs text-white/45">¥{candidate.amount}</span>}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge color={candidate.canReissue ? "orange" : candidate.reason === "already_granted" || candidate.reason === "reissued" ? "green" : "gray"} variant="soft">
                            {afdianReasonLabel(candidate.reason)}
                          </Badge>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </div>
              {filteredCandidates.length === 0 && (
                <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-5 text-center text-sm text-white/60">
                  没有匹配当前搜索条件的订单。
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/55">
                <span>
                  显示 {filteredCandidates.length === 0 ? 0 : (candidatePage - 1) * candidatePageSize + 1}–{Math.min(candidatePage * candidatePageSize, filteredCandidates.length)} / {filteredCandidates.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() => setCandidatePage((previous) => Math.max(1, previous - 1))}
                    disabled={candidatePage <= 1 || reissuing}
                  >
                    上一页
                  </Button>
                  <span>第 {candidatePage} / {candidatePageCount} 页</span>
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() => setCandidatePage((previous) => Math.min(candidatePageCount, previous + 1))}
                    disabled={candidatePage >= candidatePageCount || reissuing}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
          {candidates.length === 0 && !syncing && (
            <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-5 text-center text-sm text-white/60">
              输入凭据后点击“拉取并校对”，查看是否存在 Webhook 漏单。
            </div>
          )}
        </>
      )}
    </div>
  </SectionCard>
);
}
