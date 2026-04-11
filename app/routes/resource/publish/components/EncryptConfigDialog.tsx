import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  TextField,
  Switch,
  Spinner,
  Callout,
} from "@radix-ui/themes";
import {
  PencilSimpleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
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

function parseAfdUrl(url: string): { productId?: string; skuId?: string } {
  try {
    const u = new URL(url);
    const planId = u.searchParams.get("plan_id");
    const skuRaw = u.searchParams.get("sku");
    if (!skuRaw) return {};
    const skuArr = JSON.parse(decodeURIComponent(skuRaw));
    const skuId = skuArr?.[0]?.sku_id;
    return { productId: planId || undefined, skuId: skuId || undefined };
  } catch {
    return {};
  }
}

interface PlatformFormState {
  externalProductId: string;
  externalSkuId: string;
  title: string;
  buyUrl: string;
  isPaid: boolean;
  enabled: boolean;
}

function buildInitialFormState(
  platform: CommercePlatform,
  product?: SellerResourceProduct,
  sku?: SellerResourceSku,
): PlatformFormState {
  return {
    externalProductId: product?.externalProductId || sku?.externalProductId || "",
    externalSkuId: sku?.externalSkuId || "",
    title: product?.title || sku?.title || "",
    buyUrl: product?.buyUrl || sku?.buyUrl || "",
    isPaid: sku?.isPaid ?? true,
    enabled: sku?.enabled ?? product?.enabled ?? true,
  };
}

interface EncryptConfigDialogProps {
  resourceId: string;
  deviceId: string;
  triggerDisabled?: boolean;
}

export function EncryptConfigDialog({
  resourceId,
  deviceId,
  triggerDisabled,
}: EncryptConfigDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [platformConfigs, setPlatformConfigs] = useState<SellerPlatformConfig[]>([]);
  const [products, setProducts] = useState<SellerResourceProduct[]>([]);
  const [skus, setSkus] = useState<SellerResourceSku[]>([]);
  const [savingMap, setSavingMap] = useState<Record<CommercePlatform, boolean>>({
    afd: false,
    cdk: false,
  });

  const [afdPasteUrl, setAfdPasteUrl] = useState("");
  const [formMap, setFormMap] = useState<Record<CommercePlatform, PlatformFormState>>({
    afd: buildInitialFormState("afd"),
    cdk: buildInitialFormState("cdk"),
  });

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
        setPlatformConfigs(platformData.filter((p) => p.enabled));
        setProducts(resourceData.products);
        setSkus(resourceData.skus);

        const nextFormMap: Record<CommercePlatform, PlatformFormState> = {
          afd: buildInitialFormState(
            "afd",
            resourceData.products.find((p) => p.platform === "afd"),
            resourceData.skus.find((s) => s.platform === "afd" && s.deviceId === deviceId),
          ),
          cdk: buildInitialFormState(
            "cdk",
            resourceData.products.find((p) => p.platform === "cdk"),
            resourceData.skus.find((s) => s.platform === "cdk" && s.deviceId === deviceId),
          ),
        };
        setFormMap(nextFormMap);
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

  const handleAfdPaste = (value: string) => {
    setAfdPasteUrl(value);
    const parsed = parseAfdUrl(value);
    if (parsed.productId || parsed.skuId) {
      setFormMap((prev) => ({
        ...prev,
        afd: {
          ...prev.afd,
          externalProductId: parsed.productId || prev.afd.externalProductId,
          externalSkuId: parsed.skuId || prev.afd.externalSkuId,
          buyUrl: value || prev.afd.buyUrl,
        },
      }));
      toast.success("已自动解析爱发电商品信息");
    }
  };

  const handleSave = async (platform: CommercePlatform) => {
    const form = formMap[platform];
    if (!form.externalProductId.trim() || !form.externalSkuId.trim()) {
      toast.error("商品ID 和 SKU ID 不能为空");
      return;
    }

    setSavingMap((prev) => ({ ...prev, [platform]: true }));
    try {
      await upsertResourceProduct({
        resourceId,
        platform,
        externalProductId: form.externalProductId.trim(),
        title: form.title.trim() || undefined,
        buyUrl: form.buyUrl.trim() || undefined,
        enabled: form.enabled,
      });
      await upsertResourceSku({
        resourceId,
        platform,
        externalProductId: form.externalProductId.trim(),
        externalSkuId: form.externalSkuId.trim(),
        deviceId,
        title: form.title.trim() || undefined,
        buyUrl: form.buyUrl.trim() || undefined,
        isPaid: form.isPaid,
        enabled: form.enabled,
      });
      toast.success(`${PLATFORM_META[platform].name} 配置已保存`);
    } catch (err) {
      const msg = getErrorMessage(err);
      if (/Resource not found/i.test(msg)) {
        toast.warning("资源暂未入库，请先完成发布后再保存平台配置。");
        return;
      }
      toast.error(`保存失败：${msg}`);
    } finally {
      setSavingMap((prev) => ({ ...prev, [platform]: false }));
    }
  };

  const updateForm = (
    platform: CommercePlatform,
    patch: Partial<PlatformFormState>,
  ) => {
    setFormMap((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], ...patch },
    }));
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
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>配置付费平台映射</Dialog.Title>
        <Dialog.Description size="2" className="mb-3">
          设备：{deviceId}
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
            .filter((p) => p.platform === "afd")
            .map((platformConfig) => {
            const platform = platformConfig.platform;
            const form = formMap[platform];
            return (
              <div
                key={platform}
                className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3"
              >
                <p className="mb-2 text-sm font-medium text-white">
                  {PLATFORM_META[platform].name}
                </p>

                {platform === "afd" && (
                  <div className="mb-3">
                    <TextField.Root
                      size="2"
                      placeholder="粘贴爱发电购买链接自动填充"
                      value={afdPasteUrl}
                      onChange={(e) => handleAfdPaste(e.target.value)}
                      radius="large"
                      className="w-full"
                    />
                  </div>
                )}

                <div className="mb-2 grid gap-2">
                  <TextField.Root
                    size="2"
                    placeholder="商品 ID"
                    value={form.externalProductId}
                    onChange={(e) =>
                      updateForm(platform, { externalProductId: e.target.value })
                    }
                    radius="large"
                  />
                  <TextField.Root
                    size="2"
                    placeholder="SKU ID"
                    value={form.externalSkuId}
                    onChange={(e) =>
                      updateForm(platform, { externalSkuId: e.target.value })
                    }
                    radius="large"
                  />
                  <TextField.Root
                    size="2"
                    placeholder="标题"
                    value={form.title}
                    onChange={(e) =>
                      updateForm(platform, { title: e.target.value })
                    }
                    radius="large"
                  />
                  <TextField.Root
                    size="2"
                    placeholder="购买链接"
                    value={form.buyUrl}
                    onChange={(e) =>
                      updateForm(platform, { buyUrl: e.target.value })
                    }
                    radius="large"
                  />
                </div>

                <div className="mb-3 flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <Switch
                      checked={form.isPaid}
                      onCheckedChange={(checked) =>
                        updateForm(platform, { isPaid: checked })
                      }
                    />
                    付费
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(checked) =>
                        updateForm(platform, { enabled: checked })
                      }
                    />
                    启用
                  </label>
                </div>

                <div className="flex justify-end">
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
                      "保存"
                    )}
                  </Button>
                </div>
              </div>
            );
          })}

        <div className="mt-4 flex justify-end">
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
