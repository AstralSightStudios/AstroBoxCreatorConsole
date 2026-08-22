import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Spinner,
  Switch,
  TextField,
} from "@radix-ui/themes";
import {
  LinkSimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { parseAfdUrl } from "~/logic/publish/afdian-url";
import { reportFailure } from "~/logic/logging/feedback";
import {
  deleteResourceSku,
  listSellerPlatformConfigs,
  listSellerResourceConfigs,
  upsertResourceProduct,
  upsertResourceSku,
  type CommercePlatform,
  type SellerPlatformConfig,
  type SellerResourceProduct,
  type SellerResourceSku,
} from "~/api/astrobox/order";

const PLATFORM_META: Record<CommercePlatform, { name: string }> = {
  afd: { name: "爱发电" },
  cdk: { name: "CDK 激活" },
};

let nextMappingRowId = 0;

function createMappingRowId() {
  nextMappingRowId += 1;
  return `mapping-${nextMappingRowId}`;
}

function getErrorMessage(err: unknown) {
  const responseData = (err as any)?.response?.data;
  if (typeof responseData === "string" && responseData.trim()) {
    return responseData;
  }
  if (responseData?.message) {
    return responseData.message as string;
  }
  return (err as Error)?.message || "请求失败";
}

interface PlatformMappingRow {
  rowId: string;
  externalProductId: string;
  externalSkuId: string;
  title: string;
  buyUrl: string;
  isPaid: boolean;
  enabled: boolean;
  productType?: number;
}

type PlatformRows = Record<CommercePlatform, PlatformMappingRow[]>;

function createEmptyRow(platform: CommercePlatform): PlatformMappingRow {
  return {
    rowId: createMappingRowId(),
    externalProductId: "",
    externalSkuId: "",
    title: "",
    buyUrl: "",
    isPaid: platform === "afd",
    enabled: true,
  };
}

function buildMappingRow(
  platform: CommercePlatform,
  product?: SellerResourceProduct,
  sku?: SellerResourceSku,
): PlatformMappingRow {
  const buyUrl = sku?.buyUrl || product?.buyUrl || "";
  return {
    rowId: createMappingRowId(),
    externalProductId: sku?.externalProductId || product?.externalProductId || "",
    externalSkuId: sku?.externalSkuId || "",
    title: sku?.title || product?.title || "",
    buyUrl,
    isPaid: sku?.isPaid ?? platform === "afd",
    enabled: sku?.enabled ?? product?.enabled ?? true,
    productType: buyUrl ? parseAfdUrl(buyUrl).productType : undefined,
  };
}

function buildPlatformRows(
  platform: CommercePlatform,
  deviceId: string,
  products: SellerResourceProduct[],
  skus: SellerResourceSku[],
) {
  const rows = skus
    .filter((sku) => sku.platform === platform && sku.deviceId === deviceId)
    .map((sku) =>
      buildMappingRow(
        platform,
        products.find(
          (product) =>
            product.platform === platform &&
            product.externalProductId === sku.externalProductId,
        ),
        sku,
      ),
    );

  return rows.length > 0 ? rows : [createEmptyRow(platform)];
}

function mappingKey(productId: string, skuId: string) {
  return JSON.stringify([productId.trim(), skuId.trim()]);
}

function getMappingTypeLabel(row: PlatformMappingRow) {
  if (row.productType === 2) return "捆绑包";
  if (row.productType === 1) return "普通商品";
  return "手动映射";
}

interface EncryptConfigDialogProps {
  resourceId: string;
  deviceId: string;
  deviceName?: string;
  triggerDisabled?: boolean;
  allDeviceIds?: string[];
  onBatchSaved?: () => void;
}

export function EncryptConfigDialog({
  resourceId,
  deviceId,
  deviceName,
  triggerDisabled,
  allDeviceIds,
  onBatchSaved,
}: EncryptConfigDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [platformConfigs, setPlatformConfigs] = useState<SellerPlatformConfig[]>([]);
  const [persistedSkus, setPersistedSkus] = useState<SellerResourceSku[]>([]);
  const [savingMap, setSavingMap] = useState<Record<CommercePlatform, boolean>>({
    afd: false,
    cdk: false,
  });
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [afdPasteUrl, setAfdPasteUrl] = useState("");
  const [formMap, setFormMap] = useState<PlatformRows>({
    afd: [createEmptyRow("afd")],
    cdk: [createEmptyRow("cdk")],
  });

  const loadResourceConfigs = async () => {
    const resourceData = await listSellerResourceConfigs({ resourceId });
    setPersistedSkus(resourceData.skus);
    setFormMap({
      afd: buildPlatformRows(
        "afd",
        deviceId,
        resourceData.products,
        resourceData.skus,
      ),
      cdk: buildPlatformRows(
        "cdk",
        deviceId,
        resourceData.products,
        resourceData.skus,
      ),
    });
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    const run = async () => {
      setLoading(true);
      setError("");
      setAfdPasteUrl("");
      try {
        const [platformData, resourceData] = await Promise.all([
          listSellerPlatformConfigs(),
          listSellerResourceConfigs({ resourceId }),
        ]);
        if (!active) return;
        setPlatformConfigs(platformData.filter((platform) => platform.enabled));
        setPersistedSkus(resourceData.skus);
        setFormMap({
          afd: buildPlatformRows(
            "afd",
            deviceId,
            resourceData.products,
            resourceData.skus,
          ),
          cdk: buildPlatformRows(
            "cdk",
            deviceId,
            resourceData.products,
            resourceData.skus,
          ),
        });
      } catch (err) {
        if (active) setError((err as Error).message || "加载失败");
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [open, resourceId, deviceId]);

  const updateRow = (
    platform: CommercePlatform,
    rowId: string,
    patch: Partial<PlatformMappingRow>,
  ) => {
    setFormMap((previous) => ({
      ...previous,
      [platform]: previous[platform].map((row) =>
        row.rowId === rowId ? { ...row, ...patch } : row,
      ),
    }));
  };

  const addEmptyRow = (platform: CommercePlatform) => {
    setFormMap((previous) => ({
      ...previous,
      [platform]: [...previous[platform], createEmptyRow(platform)],
    }));
  };

  const removeRow = (platform: CommercePlatform, rowId: string) => {
    setFormMap((previous) => ({
      ...previous,
      [platform]: previous[platform].filter((row) => row.rowId !== rowId),
    }));
  };

  const handleAfdPaste = () => {
    const value = afdPasteUrl.trim();
    const parsed = parseAfdUrl(value);
    if (!parsed.productId || parsed.skuIds.length === 0) {
      toast.error("未能从链接中解析商品 ID 和 SKU ID");
      return;
    }

    setFormMap((previous) => {
      const existingKeys = new Set(
        previous.afd.map((row) =>
          mappingKey(row.externalProductId, row.externalSkuId),
        ),
      );
      const appendedRows = parsed.skuIds
        .filter(
          (skuId) => !existingKeys.has(mappingKey(parsed.productId!, skuId)),
        )
        .map((skuId) => ({
          ...createEmptyRow("afd"),
          externalProductId: parsed.productId!,
          externalSkuId: skuId,
          buyUrl: value,
          productType: parsed.productType,
        }));

      const emptyOnly =
        previous.afd.length === 1 &&
        !previous.afd[0].externalProductId.trim() &&
        !previous.afd[0].externalSkuId.trim();
      return {
        ...previous,
        afd: [
          ...(emptyOnly ? [] : previous.afd),
          ...appendedRows,
        ],
      };
    });
    setAfdPasteUrl("");
    toast.success(
      parsed.productType === 2
        ? `已添加 ${parsed.skuIds.length} 条捆绑包映射`
        : `已添加 ${parsed.skuIds.length} 条商品映射`,
    );
  };

  const validateRows = (rows: PlatformMappingRow[]) => {
    const normalizedRows = rows.filter(
      (row) => row.externalProductId.trim() || row.externalSkuId.trim(),
    );
    if (
      normalizedRows.some(
        (row) =>
          !row.externalProductId.trim() || !row.externalSkuId.trim(),
      )
    ) {
      return { error: "每条映射都必须填写商品 ID 和 SKU ID", rows: [] };
    }

    const keys = normalizedRows.map((row) =>
      mappingKey(row.externalProductId, row.externalSkuId),
    );
    if (new Set(keys).size !== keys.length) {
      return { error: "同一商品 ID 和 SKU ID 不能重复添加", rows: [] };
    }
    return { error: "", rows: normalizedRows };
  };

  const saveRowsForDevice = async (
    platform: CommercePlatform,
    rows: PlatformMappingRow[],
    targetDeviceId: string,
    deleteMissing: boolean,
  ) => {
    const productRows = new Map<string, PlatformMappingRow>();
    for (const row of rows) {
      const productId = row.externalProductId.trim();
      if (!productRows.has(productId)) productRows.set(productId, row);
    }

    for (const [externalProductId, row] of productRows) {
      await upsertResourceProduct({
        resourceId,
        platform,
        externalProductId,
        title: row.title.trim() || undefined,
        buyUrl: row.buyUrl.trim() || undefined,
        enabled: row.enabled,
      });
    }

    for (const row of rows) {
      await upsertResourceSku({
        resourceId,
        platform,
        externalProductId: row.externalProductId.trim(),
        externalSkuId: row.externalSkuId.trim(),
        deviceId: targetDeviceId,
        title: row.title.trim() || undefined,
        buyUrl: row.buyUrl.trim() || undefined,
        isPaid: row.isPaid,
        enabled: row.enabled,
      });
    }

    if (!deleteMissing) return;
    const currentKeys = new Set(
      rows.map((row) =>
        mappingKey(row.externalProductId, row.externalSkuId),
      ),
    );
    const removedSkus = persistedSkus.filter(
      (sku) =>
        sku.platform === platform &&
        sku.deviceId === targetDeviceId &&
        !currentKeys.has(mappingKey(sku.externalProductId, sku.externalSkuId)),
    );
    for (const sku of removedSkus) {
      await deleteResourceSku({
        resourceId,
        platform,
        externalProductId: sku.externalProductId,
        externalSkuId: sku.externalSkuId,
        deviceId: targetDeviceId,
      });
    }
  };

  const handleSave = async (platform: CommercePlatform) => {
    const validated = validateRows(formMap[platform]);
    if (validated.error) {
      toast.error(validated.error);
      return;
    }

    setSavingMap((previous) => ({ ...previous, [platform]: true }));
    try {
      await saveRowsForDevice(platform, validated.rows, deviceId, true);
      await loadResourceConfigs();
      toast.success(
        validated.rows.length > 0
          ? `${PLATFORM_META[platform].name}的 ${validated.rows.length} 条映射已保存`
          : `${PLATFORM_META[platform].name}映射已清空`,
      );
    } catch (err) {
      const message = getErrorMessage(err);
      if (/Resource not found/i.test(message)) {
        toast.warning("资源暂未入库，请先完成发布后再保存平台配置。");
        return;
      }
      toast.error(`保存失败：${message}`);
    } finally {
      setSavingMap((previous) => ({ ...previous, [platform]: false }));
    }
  };

  const handleBatchApply = async () => {
    if (!allDeviceIds || allDeviceIds.length === 0) return;
    const targetDeviceIds = allDeviceIds.filter((id) => id !== deviceId);
    if (targetDeviceIds.length === 0) {
      toast.info("没有其他设备需要应用");
      return;
    }

    const validated = validateRows(formMap.afd);
    if (validated.error) {
      toast.error(validated.error);
      return;
    }
    if (validated.rows.length === 0) {
      toast.info("没有可应用的爱发电映射");
      return;
    }

    setBatchSaving(true);
    setBatchProgress({ done: 0, total: targetDeviceIds.length });
    let successCount = 0;
    for (let index = 0; index < targetDeviceIds.length; index += 1) {
      const targetDeviceId = targetDeviceIds[index];
      setBatchProgress({ done: index, total: targetDeviceIds.length });
      try {
        await saveRowsForDevice("afd", validated.rows, targetDeviceId, false);
        successCount += 1;
      } catch (error) {
        // 单个设备失败不中断整体应用，但必须有可见反馈与日志。
        reportFailure(
          "encrypt/batch",
          `应用到设备 ${targetDeviceId} 失败：${(error as Error).message ?? "未知错误"}`,
          error,
        );
      }
    }

    setBatchProgress({ done: targetDeviceIds.length, total: targetDeviceIds.length });
    setBatchSaving(false);
    if (successCount === 0) {
      toast.error("全部设备应用失败，请检查网络后重试");
    } else {
      toast.success(`已将全部映射应用到 ${successCount}/${targetDeviceIds.length} 个设备`);
    }
    onBatchSaved?.();
  };

  const hasPlatforms = platformConfigs.length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button
          size="1"
          variant="soft"
          color="blue"
          disabled={triggerDisabled}
          className="ml-2"
        >
          <PencilSimpleIcon size={14} />
          配置付费平台映射
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="720px">
        <Dialog.Title>配置付费商品映射</Dialog.Title>
        <Dialog.Description size="2" className="mb-3">
          设备：{deviceName || deviceId}。一个设备可以关联多个普通商品或捆绑包。
        </Dialog.Description>

        {loading && (
          <div className="flex items-center gap-2 py-4 text-white/60">
            <Spinner size="2" />
            <span className="text-sm">正在加载平台配置...</span>
          </div>
        )}

        {!loading && error && (
          <Callout.Root color="red" variant="soft" className="mb-3">
            <Callout.Icon>
              <WarningOctagonIcon size={16} weight="fill" />
            </Callout.Icon>
            <Callout.Text>加载失败：{error}</Callout.Text>
          </Callout.Root>
        )}

        {!loading && !error && !hasPlatforms && (
          <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
            未找到已启用的付费平台，请先前往「资源加解密与激活」页面配置。
          </div>
        )}

        {!loading &&
          !error &&
          hasPlatforms &&
          platformConfigs
            .filter((config) => config.platform === "afd")
            .map((platformConfig) => {
              const platform = platformConfig.platform;
              const rows = formMap[platform];
              return (
                <div key={platform} className="space-y-3">
                  <div className="rounded-xl border border-blue-400/20 bg-blue-400/[0.06] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">
                          从爱发电链接添加
                        </p>
                        <p className="mt-0.5 text-xs text-white/50">
                          自动识别普通商品、捆绑包及链接中的全部 SKU
                        </p>
                      </div>
                      <LinkSimpleIcon size={20} className="text-blue-300" />
                    </div>
                    <div className="flex gap-2">
                      <TextField.Root
                        size="2"
                        placeholder="粘贴爱发电购买链接"
                        value={afdPasteUrl}
                        onChange={(event) => setAfdPasteUrl(event.target.value)}
                        radius="large"
                        className="min-w-0 flex-1"
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleAfdPaste();
                        }}
                      />
                      <Button
                        size="2"
                        variant="soft"
                        color="blue"
                        onClick={handleAfdPaste}
                      >
                        添加
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
                    {rows.length === 0 && (
                      <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/55">
                        当前设备没有商品映射。点击下方按钮添加，保存后即可接收对应商品的权益。
                      </div>
                    )}
                    {rows.map((row, index) => (
                      <div
                        key={row.rowId}
                        className="rounded-xl border border-white/10 bg-white/[0.04] p-3"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-white/45">
                              商品映射 {index + 1}
                            </span>
                            <Badge
                              color={row.productType === 2 ? "violet" : "blue"}
                              variant="soft"
                            >
                              {getMappingTypeLabel(row)}
                            </Badge>
                          </div>
                          <Button
                            size="1"
                            variant="ghost"
                            color="red"
                            onClick={() => removeRow(platform, row.rowId)}
                            aria-label={`删除第 ${index + 1} 条映射`}
                          >
                            <TrashIcon size={15} />
                            删除
                          </Button>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <TextField.Root
                            size="2"
                            placeholder="商品 ID / plan_id"
                            value={row.externalProductId}
                            onChange={(event) =>
                              updateRow(platform, row.rowId, {
                                externalProductId: event.target.value,
                              })
                            }
                            radius="large"
                          />
                          <TextField.Root
                            size="2"
                            placeholder="SKU ID / sku_id"
                            value={row.externalSkuId}
                            onChange={(event) =>
                              updateRow(platform, row.rowId, {
                                externalSkuId: event.target.value,
                              })
                            }
                            radius="large"
                          />
                          <TextField.Root
                            size="2"
                            placeholder="显示标题（可选）"
                            value={row.title}
                            onChange={(event) =>
                              updateRow(platform, row.rowId, {
                                title: event.target.value,
                              })
                            }
                            radius="large"
                          />
                          <TextField.Root
                            size="2"
                            placeholder="购买链接（可选）"
                            value={row.buyUrl}
                            onChange={(event) => {
                              const buyUrl = event.target.value;
                              updateRow(platform, row.rowId, {
                                buyUrl,
                                productType: parseAfdUrl(buyUrl).productType,
                              });
                            }}
                            radius="large"
                          />
                        </div>

                        <div className="mt-3 flex items-center gap-4">
                          <label className="flex items-center gap-2 text-sm text-white/80">
                            <Switch
                              checked={row.isPaid}
                              onCheckedChange={(checked) =>
                                updateRow(platform, row.rowId, { isPaid: checked })
                              }
                            />
                            付费
                          </label>
                          <label className="flex items-center gap-2 text-sm text-white/80">
                            <Switch
                              checked={row.enabled}
                              onCheckedChange={(checked) =>
                                updateRow(platform, row.rowId, { enabled: checked })
                              }
                            />
                            启用
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      size="2"
                      variant="soft"
                      color="gray"
                      onClick={() => addEmptyRow(platform)}
                    >
                      <PlusIcon size={15} />
                      添加一条映射
                    </Button>
                    <Button
                      size="2"
                      variant="soft"
                      color="green"
                      onClick={() => handleSave(platform)}
                      disabled={savingMap[platform]}
                    >
                      {savingMap[platform] ? (
                        <Spinner size="2" />
                      ) : (
                        `保存全部${rows.length > 0 ? `（${rows.length}）` : ""}`
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}

        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
          <div>
            {allDeviceIds && allDeviceIds.length > 1 && (
              <Button
                size="2"
                variant="soft"
                color="blue"
                onClick={handleBatchApply}
                disabled={batchSaving}
              >
                {batchSaving ? (
                  <>
                    <Spinner size="2" />
                    应用中 {batchProgress.done}/{batchProgress.total}
                  </>
                ) : (
                  `将全部映射应用到其他 ${allDeviceIds.length - 1} 个设备`
                )}
              </Button>
            )}
          </div>
          <Dialog.Close>
            <Button variant="soft" color="gray">
              关闭
            </Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
