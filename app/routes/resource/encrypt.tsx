import {
  FingerprintSimpleIcon,
  WarningOctagonIcon,
  LockKeyIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
  TicketIcon,
  CopyIcon,
  DownloadSimpleIcon,
  ArrowsClockwiseIcon,
} from "@phosphor-icons/react";
import CreatorPlusLogo from "~/assets/sponsorIcons/creator-plus-logo.svg?react";
import {
  Button,
  Callout,
  Switch,
  TextField,
  DropdownMenu,
  Spinner,
  AlertDialog,
  Table,
  Select,
  Badge,
  Checkbox,
} from "~/components/ScaleAwareThemes";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchAfdianOrders,
  filterAfdianOrdersBySku,
  type AfdianOrder,
} from "~/api/afdian";
import PageHeader from "~/components/page-header";
import Page from "~/layout/page";
import { SectionCard } from "./publish/components/shared";
import { useDisplayAccount } from "~/logic/account/store";
import { hasCreatorPlusOrAbove } from "~/logic/account/permissions";
import {
  listSellerPlatformConfigs,
  upsertSellerPlatformConfig,
  deleteSellerPlatformConfig,
  listSellerResourceFileKeys,
  deleteSellerResourceFileKey,
  createCdkBatch,
  listSellerCdks,
  listSellerResourceConfigs,
  reconcileAfdianOrders,
  reissueAfdianOrders,
  type AfdianReissueCandidate,
  type CommercePlatform,
  type SellerPlatformConfig,
  type SellerResourceFileKey,
  type CdkStatus,
} from "~/api/astrobox/order";
import {
  loadOwnedCatalogResourcesForCurrentUser,
  type ResourceCatalogContext,
} from "~/logic/publish/resources";

const PLATFORM_META: Record<
  CommercePlatform,
  { name: string; description: string }
> = {
  afd: {
    name: "爱发电",
    description: "通过爱发电进行资源付费售卖",
  },
  cdk: {
    name: "CDK 激活",
    description: "通过 CDK 兑换码进行资源激活",
  },
};

const ALL_PLATFORMS: CommercePlatform[] = ["afd", "cdk"];

async function fetchEncryptedResources() {
  const ownedResources = await loadOwnedCatalogResourcesForCurrentUser().catch(
    () => [] as ResourceCatalogContext[],
  );
  if (ownedResources.length === 0) return [];

  const results = await Promise.allSettled(
    ownedResources.map(async (resource) => {
      const items = await listSellerResourceFileKeys({
        resourceId: resource.entry.id,
        limit: 200,
      });
      return { resource, items };
    }),
  );

  return results
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<{
        resource: ResourceCatalogContext;
        items: SellerResourceFileKey[];
      }> => r.status === "fulfilled",
    )
    .map((r) => r.value)
    .filter((group) => group.items.length > 0);
}

export default function ResourceEncrypt() {
  const displayAccount = useDisplayAccount();
  const isVip = hasCreatorPlusOrAbove(displayAccount.plan);
  const queryClient = useQueryClient();

  const [configs, setConfigs] = useState<SellerPlatformConfig[]>([]);
  const [persistedPlatforms, setPersistedPlatforms] = useState<
    Set<CommercePlatform>
  >(new Set());
  const [loading, setLoading] = useState(true);
  const [savingMap, setSavingMap] = useState<Record<CommercePlatform, boolean>>(
    {
      afd: false,
      cdk: false,
    },
  );
  const [loadError, setLoadError] = useState("");
  const [saveErrorMap, setSaveErrorMap] = useState<
    Record<CommercePlatform, string>
  >({
    afd: "",
    cdk: "",
  });

  const {
    data: encryptedResources = [],
    isLoading: encryptedLoading,
    error: encryptedErrorRaw,
  } = useQuery({
    queryKey: ["encryptedResources"],
    queryFn: fetchEncryptedResources,
    enabled: isVip,
  });

  const encryptedError = encryptedErrorRaw
    ? (encryptedErrorRaw as Error).message || "加载失败"
    : "";

  const deleteMutation = useMutation({
    mutationFn: (variables: {
      resourceId: string;
      deviceId: string;
      encryptedFileHash: string;
    }) => deleteSellerResourceFileKey(variables),
    onSuccess: (_, variables) => {
      queryClient.setQueryData(
        ["encryptedResources"],
        (
          old:
            | {
                resource: ResourceCatalogContext;
                items: SellerResourceFileKey[];
              }[]
            | undefined,
        ) => {
          if (!old) return old;
          return old
            .map((group) => ({
              ...group,
              items: group.items.filter(
                (item) =>
                  item.resourceId !== variables.resourceId ||
                  item.deviceId !== variables.deviceId ||
                  item.encryptedFileHash !== variables.encryptedFileHash,
              ),
            }))
            .filter((group) => group.items.length > 0);
        },
      );
      toast.success("密钥映射已删除");
    },
    onError: (err) => {
      toast.error(
        (err as any)?.response?.data?.message ||
          (err as Error)?.message ||
          "删除失败",
      );
    },
  });

  useEffect(() => {
    if (!isVip) {
      setLoading(false);
      return;
    }

    let active = true;
    const run = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const data = await listSellerPlatformConfigs();
        if (!active) return;
        setConfigs(data);
        setPersistedPlatforms(new Set(data.map((item) => item.platform)));
      } catch (err) {
        if (active) {
          setLoadError((err as Error).message || "加载失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [isVip]);

  const configuredPlatforms = useMemo(
    () => new Set(configs.map((c) => c.platform)),
    [configs],
  );

  const availablePlatforms = useMemo(
    () => ALL_PLATFORMS.filter((p) => !configuredPlatforms.has(p)),
    [configuredPlatforms],
  );

  const updateConfig = (
    platform: CommercePlatform,
    patch: Partial<SellerPlatformConfig>,
  ) => {
    setConfigs((prev) =>
      prev.map((c) => (c.platform === platform ? { ...c, ...patch } : c)),
    );
  };

  const handleAddPlatform = (platform: CommercePlatform) => {
    setConfigs((prev) => [
      ...prev,
      { platform, enabled: true, buyGuideUrl: "" },
    ]);
  };

  const handleRemove = async (platform: CommercePlatform) => {
    const isPersisted = persistedPlatforms.has(platform);

    if (!isPersisted) {
      setConfigs((prev) => prev.filter((c) => c.platform !== platform));
      return;
    }

    setSavingMap((prev) => ({ ...prev, [platform]: true }));
    setSaveErrorMap((prev) => ({ ...prev, [platform]: "" }));

    const deletePromise = deleteSellerPlatformConfig({ platform });

    toast.promise(deletePromise, {
      loading: (
        <span className="inline-flex items-center gap-2">
          <Spinner size="1" />
          正在删除 {PLATFORM_META[platform].name} 配置...
        </span>
      ),
      success: `${PLATFORM_META[platform].name} 配置已删除`,
      error: (err) =>
        (err as any)?.response?.data?.message ||
        (err as Error)?.message ||
        `${PLATFORM_META[platform].name} 删除失败`,
    });

    try {
      await deletePromise;
      setConfigs((prev) => prev.filter((c) => c.platform !== platform));
      setPersistedPlatforms((prev) => {
        const next = new Set(prev);
        next.delete(platform);
        return next;
      });
    } catch (err) {
      const msg =
        (err as any)?.response?.data?.message ||
        (err as Error).message ||
        "删除失败";
      setSaveErrorMap((prev) => ({ ...prev, [platform]: msg }));
    } finally {
      setSavingMap((prev) => ({ ...prev, [platform]: false }));
    }
  };

  const handleSave = async (platform: CommercePlatform) => {
    if (!isVip) return;
    setSavingMap((prev) => ({ ...prev, [platform]: true }));
    setSaveErrorMap((prev) => ({ ...prev, [platform]: "" }));

    const config = configs.find((c) => c.platform === platform);
    if (!config) {
      setSavingMap((prev) => ({ ...prev, [platform]: false }));
      setSaveErrorMap((prev) => ({ ...prev, [platform]: "配置不存在" }));
      return;
    }

    const savePromise = upsertSellerPlatformConfig({
      platform,
      enabled: config.enabled,
      buyGuideUrl: config.buyGuideUrl?.trim() || undefined,
    });

    toast.promise(savePromise, {
      loading: (
        <span className="inline-flex items-center gap-2">
          <Spinner size="1" />
          正在保存 {PLATFORM_META[platform].name} 配置...
        </span>
      ),
      success: `${PLATFORM_META[platform].name} 配置已保存`,
      error: (err) =>
        (err as any)?.response?.data?.message ||
        (err as Error)?.message ||
        `${PLATFORM_META[platform].name} 保存失败`,
    });

    try {
      await savePromise;
      setPersistedPlatforms((prev) => new Set([...prev, platform]));
    } catch (err) {
      const msg =
        (err as any)?.response?.data?.message ||
        (err as Error).message ||
        "保存失败";
      setSaveErrorMap((prev) => ({ ...prev, [platform]: msg }));
    } finally {
      setSavingMap((prev) => ({ ...prev, [platform]: false }));
    }
  };

  const handleDeleteFileKey = (
    resourceId: string,
    deviceId: string,
    encryptedFileHash: string,
  ) => {
    deleteMutation.mutate({ resourceId, deviceId, encryptedFileHash });
  };

  return (
    <Page>
      <div className="mx-auto max-w-6xl px-2 w-full pt-1.5 pb-6 flex flex-col gap-4">
        <div className="px-3 py-3.5">
          <PageHeader
            title="资源加解密与激活"
            description="配置付费平台与资源激活方式"
            icon={<FingerprintSimpleIcon size={25} className="text-purple-300" />}
          />
        </div>

        <SectionCard
          title="付费平台设置"
          description="管理你的资源售卖与激活渠道"
        >
          {!isVip && (
            <div className="relative flex flex-col items-center gap-4 rounded-xl border border-white/10 bg-white/3 px-6 py-9 text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium tracking-wide text-white/55">
                <LockKeyIcon size={12} weight="fill" />
                会员专属
              </span>
              <CreatorPlusLogo className="h-7 w-auto text-white/90" />
              <p className="max-w-md text-sm leading-relaxed text-white/55">
                升级到 CreatorPlus 或更高档位，即可配置爱发电与 CDK 激活渠道。
              </p>
            </div>
          )}

          {isVip && loadError && (
            <Callout.Root
              color="red"
              variant="soft"
              className="bg-transparent! p-3!"
            >
              <Callout.Icon>
                <WarningOctagonIcon size={16} weight="fill" />
              </Callout.Icon>
              <Callout.Text className="font-semibold">
                加载失败：{loadError}
              </Callout.Text>
            </Callout.Root>
          )}

          {isVip && (
            <div className="flex flex-col gap-4">
              {loading && (
                <div className="flex items-center gap-2 px-1 py-4 text-white/60">
                  <Spinner size="2" />
                  <span className="text-sm">正在加载配置...</span>
                </div>
              )}

              {!loading && configs.length > 0 && (
                <div className="w-full overflow-x-auto">
                  <Table.Root className="w-full min-w-150">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell className="w-35">
                          平台
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell className="w-22.5">
                          状态
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>
                          购买引导链接
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell className="w-37.5">
                          操作
                        </Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {configs.map((config) => (
                        <Table.Row key={config.platform}>
                          <Table.Cell className="align-middle">
                            <span className="text-sm font-medium text-white">
                              {PLATFORM_META[config.platform].name}
                            </span>
                          </Table.Cell>
                          <Table.Cell className="align-middle">
                            <Switch
                              checked={config.enabled}
                              onCheckedChange={(checked) =>
                                updateConfig(config.platform, {
                                  enabled: checked,
                                })
                              }
                              disabled={savingMap[config.platform]}
                            />
                          </Table.Cell>
                          <Table.Cell className="align-middle">
                            <TextField.Root
                              size="2"
                              placeholder="https://..."
                              value={config.buyGuideUrl}
                              onChange={(e) =>
                                updateConfig(config.platform, {
                                  buyGuideUrl: e.target.value,
                                })
                              }
                              radius="large"
                              disabled={savingMap[config.platform]}
                              className="w-full"
                            />
                          </Table.Cell>
                          <Table.Cell className="align-middle">
                            <div className="flex items-center gap-2">
                              <Button
                                size="2"
                                variant="soft"
                                color="green"
                                onClick={() => handleSave(config.platform)}
                                disabled={savingMap[config.platform]}
                              >
                                {savingMap[config.platform] ? (
                                  <Spinner size="2" />
                                ) : (
                                  <CheckIcon size={16} />
                                )}
                              </Button>
                              <AlertDialog.Root>
                                <AlertDialog.Trigger>
                                  <Button
                                    size="2"
                                    variant="soft"
                                    color="red"
                                    disabled={savingMap[config.platform]}
                                  >
                                    <TrashIcon size={16} />
                                  </Button>
                                </AlertDialog.Trigger>
                                <AlertDialog.Content maxWidth="420px">
                                  <AlertDialog.Title>
                                    删除平台配置
                                  </AlertDialog.Title>
                                  <AlertDialog.Description size="2">
                                    确定要删除「
                                    {PLATFORM_META[config.platform].name}
                                    」平台配置吗？删除后可重新添加。
                                  </AlertDialog.Description>
                                  <div className="mt-4 flex justify-end gap-2">
                                    <AlertDialog.Cancel>
                                      <Button variant="soft" color="gray">
                                        取消
                                      </Button>
                                    </AlertDialog.Cancel>
                                    <AlertDialog.Action>
                                      <Button
                                        color="red"
                                        onClick={() =>
                                          void handleRemove(config.platform)
                                        }
                                      >
                                        确认删除
                                      </Button>
                                    </AlertDialog.Action>
                                  </div>
                                </AlertDialog.Content>
                              </AlertDialog.Root>
                            </div>
                            {saveErrorMap[config.platform] && (
                              <span className="mt-1 block text-xs text-red-400">
                                {saveErrorMap[config.platform]}
                              </span>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                </div>
              )}

              {!loading && configs.length === 0 && (
                <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
                  还没有配置任何付费平台，点击下方按钮添加
                </div>
              )}

              {availablePlatforms.length > 0 && (
                <div className="flex justify-start pt-1">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <Button
                        size="2"
                        variant="soft"
                        radius="large"
                        className="max-lg:min-h-12!"
                      >
                        <PlusIcon size={16} />
                        添加平台
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      {availablePlatforms.map((p) => (
                        <DropdownMenu.Item
                          key={p}
                          onClick={() => handleAddPlatform(p)}
                        >
                          {PLATFORM_META[p].name}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="加密了的资源"
          description="查看已启用加密上传并已保存密钥映射的资源"
        >
          {isVip && encryptedLoading && (
            <div className="flex items-center gap-2 px-1 py-4 text-white/60">
              <Spinner size="2" />
              <span className="text-sm">正在加载加密资源...</span>
            </div>
          )}

          {isVip && encryptedError && (
            <Callout.Root
              color="red"
              variant="soft"
              className="bg-transparent! p-3!"
            >
              <Callout.Icon>
                <WarningOctagonIcon size={16} weight="fill" />
              </Callout.Icon>
              <Callout.Text className="font-semibold">
                加载失败：{encryptedError}
              </Callout.Text>
            </Callout.Root>
          )}

          {isVip &&
            !encryptedLoading &&
            !encryptedError &&
            encryptedResources.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
                还没有已保存密钥映射的加密资源。
              </div>
            )}

          {isVip &&
            !encryptedLoading &&
            !encryptedError &&
            encryptedResources.length > 0 && (
              <div className="w-full overflow-x-auto">
                <Table.Root className="w-full min-w-150">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>资源名称</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>设备</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>文件哈希</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>创建时间</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell className="w-22.5">
                        操作
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {encryptedResources.flatMap((group) =>
                      group.items.map((item) => (
                        <Table.Row
                          key={`${item.resourceId}-${item.deviceId}-${item.encryptedFileHash}`}
                        >
                          <Table.Cell>
                            <span className="text-sm font-medium text-white">
                              {group.resource.entry.name}
                            </span>
                            <span className="ml-2 text-xs text-white/50">
                              {group.resource.entry.id}
                            </span>
                          </Table.Cell>
                          <Table.Cell>{item.deviceId}</Table.Cell>
                          <Table.Cell>
                            <code className="text-xs text-white/80 bg-white/10 px-1.5 py-0.5 rounded">
                              {item.encryptedFileHash.slice(0, 16)}…
                            </code>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-sm text-white/70">
                              {new Date(item.createdAt).toLocaleString()}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            <AlertDialog.Root>
                              <AlertDialog.Trigger>
                                <Button
                                  size="2"
                                  variant="soft"
                                  color="red"
                                  disabled={
                                    deleteMutation.isPending &&
                                    deleteMutation.variables?.resourceId ===
                                      item.resourceId &&
                                    deleteMutation.variables?.deviceId ===
                                      item.deviceId &&
                                    deleteMutation.variables
                                      ?.encryptedFileHash ===
                                      item.encryptedFileHash
                                  }
                                >
                                  {deleteMutation.isPending &&
                                  deleteMutation.variables?.resourceId ===
                                    item.resourceId &&
                                  deleteMutation.variables?.deviceId ===
                                    item.deviceId &&
                                  deleteMutation.variables
                                    ?.encryptedFileHash ===
                                    item.encryptedFileHash ? (
                                    <Spinner size="2" />
                                  ) : (
                                    <TrashIcon size={16} />
                                  )}
                                </Button>
                              </AlertDialog.Trigger>
                              <AlertDialog.Content maxWidth="420px">
                                <AlertDialog.Title>
                                  删除密钥映射
                                </AlertDialog.Title>
                                <AlertDialog.Description size="2">
                                  确定要删除该加密文件的密钥映射吗？删除后已购买用户将无法解密该文件。
                                </AlertDialog.Description>
                                <div className="mt-4 flex justify-end gap-2">
                                  <AlertDialog.Cancel>
                                    <Button variant="soft" color="gray">
                                      取消
                                    </Button>
                                  </AlertDialog.Cancel>
                                  <AlertDialog.Action>
                                    <Button
                                      color="red"
                                      onClick={() =>
                                        void handleDeleteFileKey(
                                          item.resourceId,
                                          item.deviceId,
                                          item.encryptedFileHash,
                                        )
                                      }
                                    >
                                      确认删除
                                    </Button>
                                  </AlertDialog.Action>
                                </div>
                              </AlertDialog.Content>
                            </AlertDialog.Root>
                          </Table.Cell>
                        </Table.Row>
                      )),
                    )}
                  </Table.Body>
                </Table.Root>
              </div>
            )}
        </SectionCard>

        {isVip && <AfdianReissueManager />}

        {isVip && <CdkManager />}
      </div>
    </Page>
  );
}

async function copyToClipboard(text: string, successMessage = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch (err) {
    toast.error("复制失败：" + ((err as Error)?.message || "未知错误"));
  }
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const CDK_STATUS_META: Record<CdkStatus, { label: string; color: "green" | "blue" }> =
  {
    available: { label: "未使用", color: "green" },
    redeemed: { label: "已兑换", color: "blue" },
  };

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

function AfdianReissueManager() {
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

function CdkManager() {
  const queryClient = useQueryClient();
  const [resourceId, setResourceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [statusFilter, setStatusFilter] = useState<"all" | CdkStatus>("all");
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);

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

  // 切换资源后，把设备选择重置到该资源的第一个可用设备
  useEffect(() => {
    setDeviceId((prev) =>
      deviceOptions.includes(prev) ? prev : deviceOptions[0] ?? "",
    );
    setGeneratedCodes([]);
  }, [resourceId, deviceOptions]);

  const {
    data: cdks = [],
    isLoading: cdksLoading,
    error: cdksErrorRaw,
    refetch: refetchCdks,
    isFetching: cdksFetching,
  } = useQuery({
    queryKey: ["sellerCdks", resourceId, statusFilter],
    queryFn: () =>
      listSellerCdks({
        resourceId: resourceId || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 500,
      }),
    enabled: Boolean(resourceId),
  });

  const cdksError = cdksErrorRaw
    ? (cdksErrorRaw as Error).message || "加载失败"
    : "";

  const generateMutation = useMutation({
    mutationFn: (body: {
      resourceId: string;
      deviceId: string;
      quantity: number;
    }) => createCdkBatch(body),
    onSuccess: (res) => {
      setGeneratedCodes(res.codes);
      toast.success(`已生成 ${res.codes.length} 个 CDK`);
      queryClient.invalidateQueries({ queryKey: ["sellerCdks", resourceId] });
    },
    onError: (err) => {
      toast.error((err as Error)?.message || "生成失败");
    },
  });

  const handleGenerate = () => {
    if (!resourceId) {
      toast.error("请先选择资源");
      return;
    }
    if (!deviceId) {
      toast.error("请选择或填写设备");
      return;
    }
    const qty = Number.parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error("数量需为不小于 1 的整数");
      return;
    }
    if (qty > 200) {
      toast.error("单次最多生成 200 个");
      return;
    }
    generateMutation.mutate({ resourceId, deviceId, quantity: qty });
  };

  const availableCodes = useMemo(
    () => cdks.filter((item) => item.status === "available").map((item) => item.code),
    [cdks],
  );

  return (
    <SectionCard
      title="CDK 激活码管理"
      description="为单个资源的指定设备批量生成 CDK，用户可在 AstroBox 客户端兑换解锁"
    >
      <div className="flex flex-col gap-4">
        {resourcesError && (
          <Callout.Root color="red" variant="soft" className="bg-transparent! p-3!">
            <Callout.Icon>
              <WarningOctagonIcon size={16} weight="fill" />
            </Callout.Icon>
            <Callout.Text className="font-semibold">
              加载资源失败：{resourcesError}
            </Callout.Text>
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
            <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)_auto] md:items-end">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/55">资源</span>
                <Select.Root value={resourceId} onValueChange={setResourceId}>
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
                {deviceOptions.length > 0 ? (
                  <Select.Root value={deviceId} onValueChange={setDeviceId}>
                    <Select.Trigger placeholder="选择设备" className="w-full" />
                    <Select.Content position="popper">
                      {deviceOptions.map((device) => (
                        <Select.Item key={device} value={device}>
                          {device}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                ) : (
                  <TextField.Root
                    size="2"
                    placeholder="设备 ID"
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    radius="large"
                  />
                )}
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/55">数量（1-200）</span>
                <TextField.Root
                  size="2"
                  type="number"
                  min={1}
                  max={200}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  radius="large"
                />
              </label>

              <Button
                size="2"
                onClick={handleGenerate}
                disabled={generateMutation.isPending || !resourceId}
                className="max-md:mt-1"
              >
                {generateMutation.isPending ? (
                  <Spinner size="2" />
                ) : (
                  <>
                    <TicketIcon size={16} />
                    批量生成
                  </>
                )}
              </Button>
            </div>

            {generatedCodes.length > 0 && (
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">
                    本次生成 {generatedCodes.length} 个 CDK
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="1"
                      variant="soft"
                      onClick={() =>
                        void copyToClipboard(
                          generatedCodes.join("\n"),
                          "已复制全部 CDK",
                        )
                      }
                    >
                      <CopyIcon size={14} />
                      复制全部
                    </Button>
                    <Button
                      size="1"
                      variant="soft"
                      onClick={() =>
                        downloadTextFile(
                          `cdk-${resourceId}-${deviceId}-${Date.now()}.txt`,
                          generatedCodes.join("\n"),
                        )
                      }
                    >
                      <DownloadSimpleIcon size={14} />
                      导出
                    </Button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg bg-black/30 p-2 font-mono-sarasa text-xs leading-6 text-white/80">
                  {generatedCodes.map((code) => (
                    <div key={code} className="break-all">
                      {code}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-white/80">已生成的 CDK</span>
              <Select.Root
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(value as "all" | CdkStatus)
                }
              >
                <Select.Trigger />
                <Select.Content position="popper">
                  <Select.Item value="all">全部状态</Select.Item>
                  <Select.Item value="available">未使用</Select.Item>
                  <Select.Item value="redeemed">已兑换</Select.Item>
                </Select.Content>
              </Select.Root>
              <Button
                size="1"
                variant="soft"
                color="gray"
                disabled={!resourceId || cdksFetching}
                onClick={() => void refetchCdks()}
              >
                {cdksFetching ? <Spinner size="1" /> : <ArrowsClockwiseIcon size={14} />}
                刷新
              </Button>
              {availableCodes.length > 0 && (
                <Button
                  size="1"
                  variant="soft"
                  onClick={() =>
                    void copyToClipboard(
                      availableCodes.join("\n"),
                      `已复制 ${availableCodes.length} 个未使用 CDK`,
                    )
                  }
                >
                  <CopyIcon size={14} />
                  复制未使用
                </Button>
              )}
            </div>

            {!resourceId && (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
                选择资源后查看其 CDK。
              </div>
            )}

            {resourceId && cdksError && (
              <Callout.Root
                color="red"
                variant="soft"
                className="bg-transparent! p-3!"
              >
                <Callout.Icon>
                  <WarningOctagonIcon size={16} weight="fill" />
                </Callout.Icon>
                <Callout.Text className="font-semibold">
                  加载 CDK 失败：{cdksError}
                </Callout.Text>
              </Callout.Root>
            )}

            {resourceId && cdksLoading && (
              <div className="flex items-center gap-2 px-1 py-4 text-white/60">
                <Spinner size="2" />
                <span className="text-sm">正在加载 CDK...</span>
              </div>
            )}

            {resourceId && !cdksLoading && !cdksError && cdks.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
                该资源还没有 CDK，使用上方表单生成。
              </div>
            )}

            {resourceId && !cdksLoading && !cdksError && cdks.length > 0 && (
              <div className="w-full overflow-x-auto">
                <Table.Root className="w-full min-w-150">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>CDK</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>设备</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>兑换者</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>创建时间</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell className="w-16">
                        操作
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {cdks.map((item) => (
                      <Table.Row key={item.code}>
                        <Table.Cell>
                          <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono-sarasa text-xs text-white/85">
                            {item.code}
                          </code>
                        </Table.Cell>
                        <Table.Cell>{item.deviceId}</Table.Cell>
                        <Table.Cell>
                          <Badge color={CDK_STATUS_META[item.status].color} variant="soft">
                            {CDK_STATUS_META[item.status].label}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-xs text-white/60">
                            {item.redeemedByUserId || "--"}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-sm text-white/70">
                            {item.createdAt
                              ? new Date(item.createdAt).toLocaleString()
                              : "--"}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <Button
                            size="1"
                            variant="ghost"
                            onClick={() => void copyToClipboard(item.code)}
                          >
                            <CopyIcon size={14} />
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </div>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
