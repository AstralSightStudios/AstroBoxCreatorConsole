import {
  AlertDialog,
  Button,
  Callout,
  DropdownMenu,
  Spinner,
  Switch,
  Table,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  CheckIcon,
  LockKeyIcon,
  PlusIcon,
  TrashIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import CreatorPlusLogo from "~/assets/sponsorIcons/creator-plus-logo.svg?react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  deleteSellerPlatformConfig,
  listSellerPlatformConfigs,
  upsertSellerPlatformConfig,
  type CommercePlatform,
  type SellerPlatformConfig,
} from "~/api/astrobox/order";
import { SectionCard } from "~/routes/resource/publish/components/shared";

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

/** 付费平台设置：管理爱发电 / CDK 的售卖与激活渠道。 */
export function PlatformSettingsCard({ isVip }: { isVip: boolean }) {
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

  return (
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
  );
}
