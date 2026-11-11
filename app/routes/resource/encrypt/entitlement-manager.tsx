import {
  AlertDialog,
  Avatar,
  Badge,
  Button,
  Callout,
  Select,
  Spinner,
  Table,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  ProhibitIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pager, usePagination } from "~/components/pager";
import {
  listSellerEntitlements,
  restoreSellerEntitlement,
  revokeSellerEntitlement,
} from "~/api/astrobox/order";
import { formatEntitlementSource } from "~/logic/catalog/admin-labels";
import {
  ENTITLEMENT_LIST_LIMIT,
  MAX_REVOKE_REASON_LENGTH,
  buyerDisplayName,
  filterEntitlementGroups,
  groupSellerEntitlements,
  summarizeEntitlementGroups,
  type EntitlementGroup,
} from "~/logic/catalog/seller-entitlements";
import { loadDeviceNameMap, loadDeviceTokenResolver } from "~/logic/devices/catalog";
import { loadOwnedCatalogResourcesForCurrentUser } from "~/logic/publish/resources";
import { SectionCard } from "~/routes/resource/publish/components/shared";

type StatusFilter = "all" | "active" | "revoked";

function formatTime(value: string) {
  if (!value) return "--";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "--" : parsed.toLocaleString();
}

/** 已购用户管理：查看已获得安装权限的买家，吊销或恢复其权限。 */
export function EntitlementManager() {
  const queryClient = useQueryClient();
  const [resourceId, setResourceId] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [revoking, setRevoking] = useState<EntitlementGroup | null>(null);
  const [reason, setReason] = useState("");

  const {
    data: ownedResources = [],
    isLoading: resourcesLoading,
    error: resourcesErrorRaw,
  } = useQuery({
    queryKey: ["ownedCatalogResources"],
    queryFn: loadOwnedCatalogResourcesForCurrentUser,
  });
  const resourcesError = resourcesErrorRaw
    ? (resourcesErrorRaw as Error).message || "加载失败"
    : "";

  const { data: deviceNames } = useQuery({
    queryKey: ["deviceNameMap"],
    queryFn: loadDeviceNameMap,
    staleTime: 10 * 60 * 1000,
  });
  const { data: deviceResolver } = useQuery({
    queryKey: ["deviceTokenResolver"],
    queryFn: loadDeviceTokenResolver,
    staleTime: 10 * 60 * 1000,
  });
  const deviceLabel = (deviceId: string) => {
    const canonical = deviceResolver?.(deviceId) ?? deviceId;
    const name = deviceNames?.get(canonical);
    return name ? `${name}（${deviceId}）` : deviceId;
  };

  const selectedResource = useMemo(
    () => ownedResources.find((item) => item.entry.id === resourceId),
    [ownedResources, resourceId],
  );
  const deviceOptions = useMemo(() => {
    if (!selectedResource) return [] as string[];
    return selectedResource.entry.devices
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }, [selectedResource]);

  const listKey = ["sellerEntitlements", resourceId, deviceFilter] as const;
  const {
    data: records = [],
    isLoading,
    isFetching,
    error: recordsErrorRaw,
    refetch,
  } = useQuery({
    queryKey: listKey,
    // 状态在前端按「买家 × 设备」折叠后再过滤：服务端按单条记录过滤，
    // 会让「重新购买过、旧记录已吊销」的买家被错误地归到已吊销。
    queryFn: () =>
      listSellerEntitlements({
        resourceId,
        deviceId: deviceFilter === "all" ? undefined : deviceFilter,
        limit: ENTITLEMENT_LIST_LIMIT,
      }),
    enabled: Boolean(resourceId),
  });
  const recordsError = recordsErrorRaw
    ? (recordsErrorRaw as Error).message || "加载失败"
    : "";

  const groups = useMemo(() => groupSellerEntitlements(records), [records]);
  const summary = useMemo(() => summarizeEntitlementGroups(groups), [groups]);
  const visible = useMemo(() => {
    const byStatus = groups.filter((group) =>
      statusFilter === "all" ? true : statusFilter === "revoked" ? group.revoked : !group.revoked,
    );
    return filterEntitlementGroups(byStatus, keyword, deviceLabel);
    // deviceLabel 依赖设备目录，目录加载完成后需要重新过滤
  }, [groups, statusFilter, keyword, deviceNames, deviceResolver]);
  // 买家一多整页会拉得很长：表格分页，换资源 / 设备 / 状态 / 搜索词都回到第 1 页
  const {
    slice: page,
    setPage,
    setPageSize,
  } = usePagination(visible, {
    resetKey: [resourceId, deviceFilter, statusFilter, keyword].join("\u0000"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sellerEntitlements", resourceId] });

  const revokeMutation = useMutation({
    mutationFn: (input: { group: EntitlementGroup; reason: string }) =>
      revokeSellerEntitlement({
        resourceId: input.group.resourceId,
        deviceId: input.group.deviceId,
        buyerUserId: input.group.buyerUserId,
        reason: input.reason.trim() || undefined,
      }),
    onSuccess: (_result, input) => {
      toast.success(`已吊销 ${buyerDisplayName(input.group)} 的安装权限`);
      void refresh();
    },
    onError: (err) => toast.error((err as Error)?.message || "吊销失败"),
  });

  const restoreMutation = useMutation({
    mutationFn: (group: EntitlementGroup) =>
      restoreSellerEntitlement({
        resourceId: group.resourceId,
        deviceId: group.deviceId,
        buyerUserId: group.buyerUserId,
      }),
    onSuccess: (_result, group) => {
      toast.success(`已恢复 ${buyerDisplayName(group)} 的安装权限`);
      void refresh();
    },
    onError: (err) => toast.error((err as Error)?.message || "恢复失败"),
  });

  const pendingKey = revokeMutation.isPending
    ? revokeMutation.variables?.group.key
    : restoreMutation.isPending
      ? restoreMutation.variables?.key
      : undefined;

  const changeResource = (value: string) => {
    setResourceId(value);
    setDeviceFilter("all");
    setKeyword("");
  };

  const closeRevokeDialog = () => {
    setRevoking(null);
    setReason("");
  };

  const confirmRevoke = () => {
    if (!revoking) return;
    revokeMutation.mutate({ group: revoking, reason });
    closeRevokeDialog();
  };

  return (
    <SectionCard
      title="已购用户管理"
      description="查看已获得安装权限的买家，可吊销或恢复其权限；吊销后该用户无法再安装此款式，已装在设备上的不受影响"
    >
      <div className="flex flex-col gap-4">
        {resourcesError && (
          <Callout.Root color="red" variant="soft" className="bg-transparent! p-3!">
            <Callout.Icon>
              <WarningOctagonIcon size={16} weight="fill" />
            </Callout.Icon>
            <Callout.Text className="font-semibold">加载资源失败：{resourcesError}</Callout.Text>
          </Callout.Root>
        )}

        {resourcesLoading && (
          <div className="flex items-center gap-2 px-1 py-4 text-white/60">
            <Spinner size="2" />
            <span className="text-sm">正在加载资源列表...</span>
          </div>
        )}

        {!resourcesLoading && !resourcesError && ownedResources.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
            没有可管理的已发布资源（需先登录 GitHub 且有归属你的资源）。
          </div>
        )}

        {!resourcesLoading && ownedResources.length > 0 && (
          <>
            <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/55">资源</span>
                <Select.Root value={resourceId} onValueChange={changeResource}>
                  <Select.Trigger placeholder="选择资源" className="w-full" />
                  <Select.Content position="popper">
                    {ownedResources.map((item) => (
                      <Select.Item key={item.entry.id} value={item.entry.id}>
                        {item.entry.name || item.entry.id}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/55">设备</span>
                <Select.Root
                  value={deviceFilter}
                  onValueChange={setDeviceFilter}
                  disabled={!resourceId}
                >
                  <Select.Trigger className="w-full" />
                  <Select.Content position="popper">
                    <Select.Item value="all">全部设备</Select.Item>
                    {deviceOptions.map((device) => (
                      <Select.Item key={device} value={device}>
                        {deviceLabel(device)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/55">状态</span>
                <Select.Root
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                >
                  <Select.Trigger className="w-full" />
                  <Select.Content position="popper">
                    <Select.Item value="all">全部状态</Select.Item>
                    <Select.Item value="active">生效中</Select.Item>
                    <Select.Item value="revoked">已吊销</Select.Item>
                  </Select.Content>
                </Select.Root>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/55">搜索买家</span>
                <TextField.Root
                  size="2"
                  placeholder="昵称 / 用户 ID / 单号"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  radius="large"
                />
              </label>

              <Button
                size="2"
                variant="soft"
                color="gray"
                disabled={!resourceId || isFetching}
                onClick={() => void refetch()}
                className="max-md:mt-1"
              >
                {isFetching ? <Spinner size="2" /> : <ArrowsClockwiseIcon size={16} />}
                刷新
              </Button>
            </div>

            {!resourceId && (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
                选择资源后查看其买家。
              </div>
            )}

            {resourceId && recordsError && (
              <Callout.Root color="red" variant="soft" className="bg-transparent! p-3!">
                <Callout.Icon>
                  <WarningOctagonIcon size={16} weight="fill" />
                </Callout.Icon>
                <Callout.Text className="font-semibold">加载买家失败：{recordsError}</Callout.Text>
              </Callout.Root>
            )}

            {resourceId && isLoading && (
              <div className="flex items-center gap-2 px-1 py-4 text-white/60">
                <Spinner size="2" />
                <span className="text-sm">正在加载买家...</span>
              </div>
            )}

            {resourceId && !isLoading && !recordsError && groups.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
                该资源还没有买家获得权限。
              </div>
            )}

            {resourceId && !isLoading && !recordsError && groups.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                  <span>
                    共 {summary.total} 位 · 生效中 {summary.active} · 已吊销 {summary.revoked}
                  </span>
                  {records.length >= ENTITLEMENT_LIST_LIMIT && (
                    <span className="text-orange-300/90">
                      仅显示最近 {ENTITLEMENT_LIST_LIMIT} 条记录，可按设备筛选缩小范围
                    </span>
                  )}
                </div>

                {visible.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
                    没有符合条件的买家。
                  </div>
                ) : (
                  <div className="w-full overflow-x-auto">
                    <Table.Root className="w-full min-w-180">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>买家</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>设备</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>来源</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>获得时间</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell className="w-24">操作</Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {page.items.map((group) => {
                          const busy = pendingKey === group.key;
                          return (
                            <Table.Row key={group.key}>
                              <Table.Cell>
                                <div className="flex min-w-0 items-center gap-2">
                                  <Avatar
                                    size="1"
                                    radius="full"
                                    src={group.buyerAvatar || undefined}
                                    fallback={buyerDisplayName(group).slice(0, 1).toUpperCase()}
                                  />
                                  <div className="flex min-w-0 flex-col">
                                    <span className="max-w-48 truncate text-sm text-white/90">
                                      {group.buyerName.trim() || "账号已注销"}
                                    </span>
                                    <span className="max-w-48 truncate font-mono-sarasa text-[11px] text-white/45">
                                      {group.buyerUserId}
                                    </span>
                                  </div>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <span className="text-sm text-white/80">{deviceLabel(group.deviceId)}</span>
                              </Table.Cell>
                              <Table.Cell>
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex flex-wrap gap-1">
                                    {group.sources.map((source) => (
                                      <Badge
                                        key={source.sourceRef}
                                        color={source.revokedAt ? "gray" : "blue"}
                                        variant="soft"
                                        title={source.sourceRef}
                                      >
                                        {formatEntitlementSource(source.sourceType)}
                                      </Badge>
                                    ))}
                                  </div>
                                  <span className="max-w-52 truncate font-mono-sarasa text-[11px] text-white/40">
                                    {group.sources[0]!.sourceRef}
                                  </span>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <span className="text-sm text-white/70">{formatTime(group.firstGrantedAt)}</span>
                              </Table.Cell>
                              <Table.Cell>
                                {group.revoked ? (
                                  <div className="flex flex-col gap-0.5">
                                    <Badge color="red" variant="soft" className="w-fit">
                                      已吊销
                                    </Badge>
                                    <span className="text-[11px] text-white/45">
                                      {formatTime(group.revokedAt)}
                                    </span>
                                    {group.revokeReason && (
                                      <span className="max-w-48 truncate text-[11px] text-white/55" title={group.revokeReason}>
                                        {group.revokeReason}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <Badge color="green" variant="soft">
                                    生效中
                                  </Badge>
                                )}
                              </Table.Cell>
                              <Table.Cell>
                                {group.revoked ? (
                                  <Button
                                    size="1"
                                    variant="soft"
                                    disabled={busy}
                                    onClick={() => restoreMutation.mutate(group)}
                                  >
                                    {busy ? <Spinner size="1" /> : <ArrowCounterClockwiseIcon size={14} />}
                                    恢复
                                  </Button>
                                ) : (
                                  <Button
                                    size="1"
                                    variant="soft"
                                    color="red"
                                    disabled={busy}
                                    onClick={() => setRevoking(group)}
                                  >
                                    {busy ? <Spinner size="1" /> : <ProhibitIcon size={14} />}
                                    吊销
                                  </Button>
                                )}
                              </Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </div>
                )}

                <Pager slice={page} onPageChange={setPage} onPageSizeChange={setPageSize} />
              </>
            )}
          </>
        )}
      </div>

      <AlertDialog.Root
        open={Boolean(revoking)}
        onOpenChange={(open) => {
          if (!open) closeRevokeDialog();
        }}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>吊销安装权限</AlertDialog.Title>
          <AlertDialog.Description size="2">
            {revoking
              ? `${buyerDisplayName(revoking)} 将无法再安装「${deviceLabel(revoking.deviceId)}」，已装在设备上的不受影响，之后可随时恢复。`
              : ""}
          </AlertDialog.Description>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-xs text-white/55">原因（选填，对方可见）</span>
            <TextField.Root
              size="2"
              placeholder="例如：已退款"
              maxLength={MAX_REVOKE_REASON_LENGTH}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              radius="large"
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={confirmRevoke}>
                确认吊销
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </SectionCard>
  );
}
