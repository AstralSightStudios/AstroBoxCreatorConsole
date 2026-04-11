import {
  FingerprintSimpleIcon,
  WarningOctagonIcon,
  CrownIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Callout,
  Switch,
  TextField,
  DropdownMenu,
  Spinner,
  AlertDialog,
  Table,
} from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  type CommercePlatform,
  type SellerPlatformConfig,
  type SellerResourceFileKey,
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
      encryptedFileHash: string;
    }) => deleteSellerResourceFileKey(variables),
    onSuccess: (_, variables) => {
      queryClient.setQueryData(
        ["encryptedResources"],
        (
          old: { resource: ResourceCatalogContext; items: SellerResourceFileKey[] }[] | undefined,
        ) => {
          if (!old) return old;
          return old
            .map((group) => ({
              ...group,
              items: group.items.filter(
                (item) => item.encryptedFileHash !== variables.encryptedFileHash,
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

  const handleDeleteFileKey = (resourceId: string, encryptedFileHash: string) => {
    deleteMutation.mutate({ resourceId, encryptedFileHash });
  };

  return (
    <Page>
      <div className="mx-auto max-w-5xl px-1 lg:px-3.5 w-full pt-1.5 pb-6 flex flex-col gap-4">
        <div className="flex flex-col px-3 py-3.5">
          <div className="flex items-center gap-2 mb-2">
            <FingerprintSimpleIcon size={24} className="text-blue-500" />
            <p className="text-lg font-semibold">资源加解密与激活</p>
          </div>
          <p className="text-sm text-white/70">配置付费平台与资源激活方式</p>
        </div>

        <SectionCard
          title="付费平台设置"
          description="管理你的资源售卖与激活渠道"
        >
          {!isVip && (
            <div className="relative rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-6 flex flex-col items-center gap-3 text-center">
              <CrownIcon size={40} weight="fill" className="text-amber-300" />
              <p className="text-base font-semibold text-amber-100">
                CreatorPlus VIP 专属功能
              </p>
              <p className="text-sm text-amber-200/80 max-w-md">
                付费平台设置需要 CreatorPlus
                或更高级别的会员。升级后即可开启爱发电与 CDK 激活功能。
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
                  <Table.Root className="w-full min-w-[600px]">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell className="w-[140px]">
                          平台
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell className="w-[90px]">
                          状态
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>
                          购买引导链接
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell className="w-[150px]">
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

          {isVip && !encryptedLoading && !encryptedError && encryptedResources.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
              还没有已保存密钥映射的加密资源。
            </div>
          )}

          {isVip && !encryptedLoading && !encryptedError && encryptedResources.length > 0 && (
            <div className="w-full overflow-x-auto">
              <Table.Root className="w-full min-w-[600px]">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>资源名称</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>设备</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>文件哈希</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>创建时间</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="w-[90px]">操作</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {encryptedResources.flatMap((group) =>
                    group.items.map((item) => (
                      <Table.Row key={`${item.resourceId}-${item.encryptedFileHash}`}>
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
                                disabled={deleteMutation.isPending && deleteMutation.variables?.encryptedFileHash === item.encryptedFileHash}
                              >
                                {deleteMutation.isPending && deleteMutation.variables?.encryptedFileHash === item.encryptedFileHash ? (
                                  <Spinner size="2" />
                                ) : (
                                  <TrashIcon size={16} />
                                )}
                              </Button>
                            </AlertDialog.Trigger>
                            <AlertDialog.Content maxWidth="420px">
                              <AlertDialog.Title>删除密钥映射</AlertDialog.Title>
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
      </div>
    </Page>
  );
}
