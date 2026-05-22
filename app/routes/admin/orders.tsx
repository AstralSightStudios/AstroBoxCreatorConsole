import { Button, Dialog, Spinner } from "@radix-ui/themes";
import { CopyIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminApi,
  type AdminPublicOrder,
  type AdminResourceCommerceConfigs,
  type AdminResourceEntitlement,
  type CdkStatus,
  type CommercePlatform,
  type EntitlementSourceType,
  type PublicOrderStatus,
} from "~/api/astrobox/admin";
import {
  AdminPage,
  Field,
  Panel,
  formatDateTime,
  inputClass,
  textareaClass,
} from "~/components/admin/AdminPage";

const PAGE_SIZE = 100;
const ORDER_STATUSES: PublicOrderStatus[] = [
  "pending_binding",
  "granted",
  "rejected_seller_inactive",
  "ignored_unmapped_sku",
];
const PLATFORMS: CommercePlatform[] = ["afd", "cdk"];
const SOURCE_TYPES: EntitlementSourceType[] = ["order", "cdk"];
const CDK_STATUSES: CdkStatus[] = ["available", "redeemed"];

type TabKey = "orders" | "entitlements" | "configs";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed);
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("已复制");
  } catch (err) {
    toast.error("复制失败：" + getErrorMessage(err));
  }
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="inline-flex rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white"
      onClick={(event) => {
        event.stopPropagation();
        void copyText(value);
      }}
    >
      <CopyIcon size={13} />
    </button>
  );
}

function MonoValue({ value }: { value?: string }) {
  if (!value) return <span className="text-white/35">--</span>;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span className="min-w-0 truncate font-mono-sarasa">{value}</span>
      <CopyButton value={value} />
    </span>
  );
}

export default function AdminOrdersPage() {
  const [tab, setTab] = useState<TabKey>("orders");
  const [search, setSearch] = useState("");
  const [sellerUserId, setSellerUserId] = useState("");
  const [buyerUserId, setBuyerUserId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [platform, setPlatform] = useState<CommercePlatform | "">("");
  const [status, setStatus] = useState<PublicOrderStatus | "">("");
  const [sourceType, setSourceType] = useState<EntitlementSourceType | "">("");
  const [cdkStatus, setCdkStatus] = useState<CdkStatus | "">("");

  const [orders, setOrders] = useState<AdminPublicOrder[]>([]);
  const [entitlements, setEntitlements] = useState<AdminResourceEntitlement[]>([]);
  const [configs, setConfigs] = useState<AdminResourceCommerceConfigs | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [grantForm, setGrantForm] = useState({
    buyerUserId: "",
    sellerUserId: "",
    resourceId: "",
    deviceId: "",
    sourceType: "cdk" as EntitlementSourceType,
    sourcePlatform: "cdk" as CommercePlatform,
    sourceRef: "",
    metaText: "",
  });
  const [orderForm, setOrderForm] = useState({
    sellerUserId: "",
    platform: "afd" as CommercePlatform,
    externalOrderId: "",
    externalProductId: "",
    externalSkuId: "",
    buyerPlatformUserId: "",
    buyerUserId: "",
    resourceId: "",
    deviceId: "",
    status: "pending_binding" as PublicOrderStatus,
    rawPayloadText: "",
  });

  const openOrder = useMemo(
    () => orders.find((item) => item.id === openOrderId) || null,
    [openOrderId, orders],
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      if (tab === "orders") {
        const res = await AdminApi.orders.publicOrders({
          search,
          sellerUserId,
          buyerUserId,
          resourceId,
          deviceId,
          platform: platform || undefined,
          status: status || undefined,
          limit: PAGE_SIZE,
        });
        setOrders(res.items);
      } else if (tab === "entitlements") {
        const res = await AdminApi.orders.entitlements({
          search,
          sellerUserId,
          buyerUserId,
          resourceId,
          deviceId,
          sourceType: sourceType || undefined,
          sourcePlatform: platform || undefined,
          limit: PAGE_SIZE,
        });
        setEntitlements(res.items);
      } else {
        const res = await AdminApi.orders.resourceConfigs({
          sellerUserId,
          resourceId,
          deviceId,
          platform: platform || undefined,
          cdkStatus: cdkStatus || undefined,
          limit: PAGE_SIZE,
        });
        setConfigs(res);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [tab]);

  const grantEntitlement = async () => {
    try {
      const meta = parseJsonText(grantForm.metaText);
      await AdminApi.orders.upsertEntitlement({
        buyerUserId: grantForm.buyerUserId.trim(),
        sellerUserId: grantForm.sellerUserId.trim(),
        resourceId: grantForm.resourceId.trim(),
        deviceId: grantForm.deviceId.trim(),
        sourceType: grantForm.sourceType,
        sourcePlatform: grantForm.sourcePlatform,
        sourceRef: grantForm.sourceRef.trim() || `manual:${Date.now()}`,
        meta,
      });
      toast.success("权益已授予");
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const upsertOrder = async () => {
    try {
      const rawPayload = parseJsonText(orderForm.rawPayloadText);
      await AdminApi.orders.upsertPublicOrder({
        sellerUserId: orderForm.sellerUserId.trim(),
        platform: orderForm.platform,
        externalOrderId: orderForm.externalOrderId.trim(),
        externalProductId: orderForm.externalProductId.trim(),
        externalSkuId: orderForm.externalSkuId.trim(),
        buyerPlatformUserId: orderForm.buyerPlatformUserId.trim(),
        buyerUserId: orderForm.buyerUserId.trim(),
        resourceId: orderForm.resourceId.trim(),
        deviceId: orderForm.deviceId.trim(),
        status: orderForm.status,
        rawPayload: rawPayload ?? {},
      });
      toast.success("订单已写入");
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const deleteEntitlement = async (item: AdminResourceEntitlement) => {
    if (!window.confirm(`撤销 ${item.buyerUserId} 对 ${item.resourceId}/${item.deviceId} 的权益？`)) return;
    try {
      await AdminApi.orders.deleteEntitlement(item.id);
      toast.success("权益已撤销");
      setEntitlements((current) => current.filter((entry) => entry.id !== item.id));
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <AdminPage
      title="订单与权益管理"
      description="跨卖家管理第三方接入订单、付费资源权益、商品/SKU 映射、CDK 和加密文件键。"
      loading={loading && orders.length === 0 && entitlements.length === 0 && !configs}
      error={error}
      onRetry={load}
    >
      <Panel title="筛选">
        <div className="mb-3 flex flex-wrap gap-2">
          {(["orders", "entitlements", "configs"] as TabKey[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-xl px-3 py-2 text-sm transition ${
                tab === item
                  ? "bg-white/15 text-white"
                  : "bg-black/20 text-white/60 hover:bg-white/10"
              }`}
            >
              {item === "orders" ? "第三方订单" : item === "entitlements" ? "资源权益" : "售卖配置"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          {tab !== "configs" && (
            <input
              className={inputClass}
              placeholder="搜索订单/用户/资源"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load();
              }}
            />
          )}
          <input className={inputClass} placeholder="sellerUserId" value={sellerUserId} onChange={(e) => setSellerUserId(e.target.value)} />
          {tab !== "configs" && (
            <input className={inputClass} placeholder="buyerUserId" value={buyerUserId} onChange={(e) => setBuyerUserId(e.target.value)} />
          )}
          <input className={inputClass} placeholder="resourceId" value={resourceId} onChange={(e) => setResourceId(e.target.value)} />
          <input className={inputClass} placeholder="deviceId" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
          <select className={inputClass} value={platform} onChange={(e) => setPlatform(e.target.value as CommercePlatform | "")}>
            <option value="">全部平台</option>
            {PLATFORMS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          {tab === "orders" && (
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as PublicOrderStatus | "")}>
              <option value="">全部订单状态</option>
              {ORDER_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}
          {tab === "entitlements" && (
            <select className={inputClass} value={sourceType} onChange={(e) => setSourceType(e.target.value as EntitlementSourceType | "")}>
              <option value="">全部来源</option>
              {SOURCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}
          {tab === "configs" && (
            <select className={inputClass} value={cdkStatus} onChange={(e) => setCdkStatus(e.target.value as CdkStatus | "")}>
              <option value="">全部 CDK 状态</option>
              {CDK_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}
          <Button onClick={load} disabled={loading}>
            {loading ? <Spinner size="1" /> : "查询"}
          </Button>
        </div>
      </Panel>

      {tab === "orders" && (
        <>
          <Panel title="手动写入 / 覆盖订单">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
              <input className={inputClass} placeholder="sellerUserId" value={orderForm.sellerUserId} onChange={(e) => setOrderForm((v) => ({ ...v, sellerUserId: e.target.value }))} />
              <select className={inputClass} value={orderForm.platform} onChange={(e) => setOrderForm((v) => ({ ...v, platform: e.target.value as CommercePlatform }))}>
                {PLATFORMS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <input className={inputClass} placeholder="externalOrderId" value={orderForm.externalOrderId} onChange={(e) => setOrderForm((v) => ({ ...v, externalOrderId: e.target.value }))} />
              <input className={inputClass} placeholder="externalProductId" value={orderForm.externalProductId} onChange={(e) => setOrderForm((v) => ({ ...v, externalProductId: e.target.value }))} />
              <input className={inputClass} placeholder="externalSkuId" value={orderForm.externalSkuId} onChange={(e) => setOrderForm((v) => ({ ...v, externalSkuId: e.target.value }))} />
              <input className={inputClass} placeholder="buyerPlatformUserId" value={orderForm.buyerPlatformUserId} onChange={(e) => setOrderForm((v) => ({ ...v, buyerPlatformUserId: e.target.value }))} />
              <input className={inputClass} placeholder="buyerUserId" value={orderForm.buyerUserId} onChange={(e) => setOrderForm((v) => ({ ...v, buyerUserId: e.target.value }))} />
              <input className={inputClass} placeholder="resourceId" value={orderForm.resourceId} onChange={(e) => setOrderForm((v) => ({ ...v, resourceId: e.target.value }))} />
              <input className={inputClass} placeholder="deviceId" value={orderForm.deviceId} onChange={(e) => setOrderForm((v) => ({ ...v, deviceId: e.target.value }))} />
              <select className={inputClass} value={orderForm.status} onChange={(e) => setOrderForm((v) => ({ ...v, status: e.target.value as PublicOrderStatus }))}>
                {ORDER_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <textarea
              className={`${textareaClass} mt-2 min-h-20`}
              placeholder="rawPayload JSON，留空写入 {}"
              value={orderForm.rawPayloadText}
              onChange={(e) => setOrderForm((v) => ({ ...v, rawPayloadText: e.target.value }))}
            />
            <Button className="mt-2" onClick={upsertOrder}>写入 / 覆盖订单</Button>
          </Panel>
          <Panel title={`第三方订单 (${orders.length})`}>
            <div className="grid gap-2 xl:grid-cols-2">
              {orders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setOpenOrderId(order.id)}
                  className="min-w-0 rounded-xl border border-white/10 bg-black/15 p-3 text-left transition hover:border-white/25 hover:bg-white/[0.04]"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-white/10 px-2 py-0.5 text-white/70">{order.platform}</span>
                    <span className="rounded bg-blue-500/15 px-2 py-0.5 text-blue-100">{order.status}</span>
                    <span className="text-white/40">{formatDateTime(order.updatedAt)}</span>
                  </div>
                  <p className="truncate text-sm text-white">
                    <MonoValue value={order.externalOrderId} /> · {order.resourceId}/{order.deviceId}
                  </p>
                  <p className="mt-1 truncate text-xs text-white/50">
                    买家 <MonoValue value={order.buyerUserId || order.buyerPlatformUserId} /> · 卖家 <MonoValue value={order.sellerUserId} />
                  </p>
                </button>
              ))}
              {orders.length === 0 && <Empty text="没有匹配订单" />}
            </div>
          </Panel>
        </>
      )}

      {tab === "entitlements" && (
        <>
          <Panel title="手动授予权益">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
              <input className={inputClass} placeholder="buyerUserId" value={grantForm.buyerUserId} onChange={(e) => setGrantForm((v) => ({ ...v, buyerUserId: e.target.value }))} />
              <input className={inputClass} placeholder="sellerUserId" value={grantForm.sellerUserId} onChange={(e) => setGrantForm((v) => ({ ...v, sellerUserId: e.target.value }))} />
              <input className={inputClass} placeholder="resourceId" value={grantForm.resourceId} onChange={(e) => setGrantForm((v) => ({ ...v, resourceId: e.target.value }))} />
              <input className={inputClass} placeholder="deviceId" value={grantForm.deviceId} onChange={(e) => setGrantForm((v) => ({ ...v, deviceId: e.target.value }))} />
              <select className={inputClass} value={grantForm.sourceType} onChange={(e) => setGrantForm((v) => ({ ...v, sourceType: e.target.value as EntitlementSourceType }))}>
                {SOURCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={inputClass} value={grantForm.sourcePlatform} onChange={(e) => setGrantForm((v) => ({ ...v, sourcePlatform: e.target.value as CommercePlatform }))}>
                {PLATFORMS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <input className={inputClass} placeholder="sourceRef，留空自动生成" value={grantForm.sourceRef} onChange={(e) => setGrantForm((v) => ({ ...v, sourceRef: e.target.value }))} />
            </div>
            <textarea
              className={`${textareaClass} mt-2 min-h-20`}
              placeholder='meta JSON，例如 {"reason":"manual grant"}'
              value={grantForm.metaText}
              onChange={(e) => setGrantForm((v) => ({ ...v, metaText: e.target.value }))}
            />
            <Button className="mt-2" onClick={grantEntitlement}>授予 / 覆盖权益</Button>
          </Panel>
          <Panel title={`资源权益 (${entitlements.length})`}>
            <div className="grid gap-2 xl:grid-cols-2">
              {entitlements.map((item) => (
                <div key={item.id} className="min-w-0 rounded-xl border border-white/10 bg-black/15 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-white/10 px-2 py-0.5 text-white/70">{item.sourcePlatform}</span>
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-100">{item.sourceType}</span>
                    <span className="text-white/40">{formatDateTime(item.updatedAt)}</span>
                    <button className="ml-auto text-red-200 hover:text-red-100" onClick={() => void deleteEntitlement(item)}>
                      <TrashIcon size={15} />
                    </button>
                  </div>
                  <p className="truncate text-sm text-white">
                    <MonoValue value={item.buyerUserId} /> 拥有 {item.resourceId}/{item.deviceId}
                  </p>
                  <p className="mt-1 truncate text-xs text-white/50">
                    卖家 <MonoValue value={item.sellerUserId} /> · <MonoValue value={item.sourceRef} />
                  </p>
                </div>
              ))}
              {entitlements.length === 0 && <Empty text="没有匹配权益" />}
            </div>
          </Panel>
        </>
      )}

      {tab === "configs" && configs && (
        <ConfigsView configs={configs} />
      )}

      <Dialog.Root open={openOrderId !== null} onOpenChange={(open) => !open && setOpenOrderId(null)}>
        <Dialog.Content maxWidth="100vw" className="!w-[min(96vw,900px)] !max-w-none">
          {openOrder && (
            <OrderDialog
              order={openOrder}
              onSaved={(next) => {
                setOrders((current) => current.map((item) => item.id === next.id ? next : item));
                setOpenOrderId(null);
              }}
              onDeleted={(id) => {
                setOrders((current) => current.filter((item) => item.id !== id));
                setOpenOrderId(null);
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>
    </AdminPage>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="col-span-full py-10 text-center text-sm text-white/45">{text}</div>;
}

function OrderDialog({
  order,
  onSaved,
  onDeleted,
}: {
  order: AdminPublicOrder;
  onSaved: (order: AdminPublicOrder) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState({
    platform: order.platform,
    externalOrderId: order.externalOrderId,
    status: order.status,
    buyerUserId: order.buyerUserId,
    buyerPlatformUserId: order.buyerPlatformUserId,
    resourceId: order.resourceId,
    deviceId: order.deviceId,
    externalProductId: order.externalProductId,
    externalSkuId: order.externalSkuId,
    rawPayloadText: JSON.stringify(order.rawPayload ?? {}, null, 2),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const next = await AdminApi.orders.patchPublicOrder(order.id, {
        platform: form.platform,
        externalOrderId: form.externalOrderId,
        status: form.status,
        buyerUserId: form.buyerUserId,
        buyerPlatformUserId: form.buyerPlatformUserId,
        resourceId: form.resourceId,
        deviceId: form.deviceId,
        externalProductId: form.externalProductId,
        externalSkuId: form.externalSkuId,
        rawPayload: parseJsonText(form.rawPayloadText) ?? {},
      });
      toast.success("订单已更新");
      onSaved(next);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`删除订单 ${order.externalOrderId}？`)) return;
    setSaving(true);
    try {
      await AdminApi.orders.deletePublicOrder(order.id);
      toast.success("订单已删除");
      onDeleted(order.id);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog.Title>第三方订单 · {order.externalOrderId}</Dialog.Title>
      <Dialog.Description size="2" className="mb-3">
        {order.platform} · 卖家 {order.sellerUserId} · 创建于 {formatDateTime(order.createdAt)}
      </Dialog.Description>
      <div className="grid max-h-[72vh] gap-3 overflow-y-auto md:grid-cols-2">
        <Field label="平台">
          <select className={inputClass} value={form.platform} onChange={(e) => setForm((v) => ({ ...v, platform: e.target.value as CommercePlatform }))}>
            {PLATFORMS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="订单 ID">
          <input className={inputClass} value={form.externalOrderId} onChange={(e) => setForm((v) => ({ ...v, externalOrderId: e.target.value }))} />
        </Field>
        <Field label="状态">
          <select className={inputClass} value={form.status} onChange={(e) => setForm((v) => ({ ...v, status: e.target.value as PublicOrderStatus }))}>
            {ORDER_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="买家 AstroBox ID">
          <input className={inputClass} value={form.buyerUserId} onChange={(e) => setForm((v) => ({ ...v, buyerUserId: e.target.value }))} />
        </Field>
        <Field label="买家平台 ID">
          <input className={inputClass} value={form.buyerPlatformUserId} onChange={(e) => setForm((v) => ({ ...v, buyerPlatformUserId: e.target.value }))} />
        </Field>
        <Field label="资源 ID">
          <input className={inputClass} value={form.resourceId} onChange={(e) => setForm((v) => ({ ...v, resourceId: e.target.value }))} />
        </Field>
        <Field label="设备 ID">
          <input className={inputClass} value={form.deviceId} onChange={(e) => setForm((v) => ({ ...v, deviceId: e.target.value }))} />
        </Field>
        <Field label="商品 ID">
          <input className={inputClass} value={form.externalProductId} onChange={(e) => setForm((v) => ({ ...v, externalProductId: e.target.value }))} />
        </Field>
        <Field label="SKU ID">
          <input className={inputClass} value={form.externalSkuId} onChange={(e) => setForm((v) => ({ ...v, externalSkuId: e.target.value }))} />
        </Field>
        <Field label="原始 payload JSON">
          <textarea className={textareaClass} value={form.rawPayloadText} onChange={(e) => setForm((v) => ({ ...v, rawPayloadText: e.target.value }))} />
        </Field>
      </div>
      <div className="mt-4 flex justify-between gap-2">
        <Button color="red" variant="soft" disabled={saving} onClick={remove}>删除订单</Button>
        <div className="flex gap-2">
          <Dialog.Close>
            <Button variant="soft">取消</Button>
          </Dialog.Close>
          <Button disabled={saving} onClick={save}>{saving ? <Spinner size="1" /> : "保存"}</Button>
        </div>
      </div>
    </>
  );
}

function ConfigsView({ configs }: { configs: AdminResourceCommerceConfigs }) {
  return (
    <div className="grid gap-4">
      <Panel title={`SKU 映射 (${configs.skus.length})`}>
        <SimpleRows
          items={configs.skus}
          render={(item) => (
            <>
              <span className="text-white">{item.resourceId}/{item.deviceId}</span>
              <span className="text-white/45">{item.platform} · {item.externalProductId}/{item.externalSkuId}</span>
              <span className={item.enabled ? "text-emerald-200" : "text-red-200"}>{item.enabled ? "enabled" : "disabled"} · {item.validationStatus}</span>
            </>
          )}
        />
      </Panel>
      <Panel title={`商品映射 (${configs.products.length})`}>
        <SimpleRows
          items={configs.products}
          render={(item) => (
            <>
              <span className="text-white">{item.resourceId}</span>
              <span className="text-white/45">{item.platform} · {item.externalProductId}</span>
              <span className={item.enabled ? "text-emerald-200" : "text-red-200"}>{item.enabled ? "enabled" : "disabled"} · {item.validationStatus}</span>
            </>
          )}
        />
      </Panel>
      <Panel title={`CDK (${configs.cdkCodes.length})`}>
        <SimpleRows
          items={configs.cdkCodes}
          render={(item) => (
            <>
              <MonoValue value={item.code} />
              <span className="text-white/45">{item.resourceId}/{item.deviceId}</span>
              <span className={item.status === "available" ? "text-emerald-200" : "text-blue-200"}>{item.status} · {item.redeemedByUserId || "--"}</span>
            </>
          )}
        />
      </Panel>
      <Panel title={`加密文件键 (${configs.fileKeys.length})`}>
        <SimpleRows
          items={configs.fileKeys}
          render={(item) => (
            <>
              <span className="text-white">{item.resourceId}/{item.deviceId}</span>
              <MonoValue value={item.encryptedFileHash} />
              <span className="text-white/45">firstOwner: {item.firstOwnerId || "--"}</span>
            </>
          )}
        />
      </Panel>
      <Panel title={`平台配置 (${configs.platformConfigs.length})`}>
        <SimpleRows
          items={configs.platformConfigs}
          render={(item) => (
            <>
              <span className="text-white">{item.sellerUserId}</span>
              <span className="text-white/45">{item.platform} · {item.buyGuideUrl || "--"}</span>
              <span className={item.enabled ? "text-emerald-200" : "text-red-200"}>{item.enabled ? "enabled" : "disabled"}</span>
            </>
          )}
        />
      </Panel>
    </div>
  );
}

function SimpleRows<T extends { id: string }>({
  items,
  render,
}: {
  items: T[];
  render: (item: T) => React.ReactNode;
}) {
  if (items.length === 0) return <Empty text="没有匹配记录" />;
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.id} className="grid min-w-0 gap-1 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-sm md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
          {render(item)}
        </div>
      ))}
    </div>
  );
}
