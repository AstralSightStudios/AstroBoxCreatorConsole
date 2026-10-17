import {
  ArrowSquareOutIcon,
  CopyIcon,
  DeviceMobileIcon,
  DownloadSimpleIcon,
  FingerprintIcon,
  GlobeHemisphereWestIcon,
  ImageSquareIcon,
  KeyIcon,
  LinkIcon,
  SealCheckIcon,
  StorefrontIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { Badge } from "@radix-ui/themes";
import { toast } from "sonner";
import { Panel, formatDateTime } from "~/components/admin/AdminPage";
import { AdminUserChip } from "~/components/admin/AdminUserChip";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import {
  formatCdkStatus,
  formatCommercePlatform,
  formatEntitlementSource,
  formatPublicOrderStatus,
  formatReportStatus,
  formatReportType,
  formatValidationStatus,
} from "~/logic/catalog/admin-labels";
import {
  formatIndexPaidType,
  formatIndexResourceType,
  indexItemAssetUrl,
  type IndexV2Entry,
} from "~/logic/catalog/index-v2";
import { normalizeBundledResources } from "~/logic/publish/manifest";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import {
  countLabel,
  EMPTY_DETAIL_SEARCH,
  filterItems,
  type DetailSearchContext,
} from "~/logic/catalog/detail-search";
import type {
  AdminPublicOrder,
  AdminResourceCommerceConfigs,
  AdminResourceEntitlement,
  ReportItem,
} from "~/api/astrobox/admin";
import { openExternal } from "./ResourceVisuals";

/* ------------------------------ 详情页上下文 ------------------------------ */

export type PanelContext = DetailSearchContext;

const DEFAULT_CONTEXT = EMPTY_DETAIL_SEARCH;

/* ------------------------------ 通用小组件 ------------------------------ */

function Hint({ text, tone = "muted" }: { text: string; tone?: "muted" | "error" }) {
  return (
    <p className={tone === "error" ? "text-sm text-red-200" : "text-sm text-white/45"}>
      {text}
    </p>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <dt className="shrink-0 text-xs text-white/45">{label}</dt>
      <dd className="min-w-0 text-sm text-white">{children}</dd>
    </div>
  );
}

/** 列表行里的一行「标签 + 值」，展示与搜索都走同一套文案。 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-xs text-white/40">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-white/85">{children}</span>
    </div>
  );
}

/** 行内字段网格：手机上单列，宽一点两列，避免长串挤成一行。 */
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-1.5 sm:grid-cols-2">{children}</div>;
}

function RowCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2.5">
      {children}
    </div>
  );
}

function RowHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
  );
}

/** 等宽值 + 一键复制。 */
export function Mono({ value }: { value?: string }) {
  const text = (value ?? "").trim();
  if (!text) return <span className="text-white/35">--</span>;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span className="min-w-0 break-all font-mono-sarasa text-xs">{text}</span>
      <button
        type="button"
        aria-label="复制"
        title="复制"
        className="shrink-0 rounded-md p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => toast.success("已复制"),
            () => toast.error("复制失败"),
          );
        }}
      >
        <CopyIcon size={13} />
      </button>
    </span>
  );
}

function TokenList({ tokens }: { tokens: readonly string[] }) {
  const values = tokens.filter(Boolean);
  if (values.length === 0) return <span className="text-white/35">--</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((token) => (
        <Badge key={token} size="1" variant="soft" color="gray">
          {token}
        </Badge>
      ))}
    </span>
  );
}

/** 设备标签：把 xmb10 之类显示成「设备名（id）」。 */
function DeviceTag({
  deviceId,
  context,
}: {
  deviceId?: string | null;
  context: PanelContext;
}) {
  const raw = (deviceId ?? "").trim();
  if (!raw) return <span className="text-white/35">--</span>;
  const label = context.deviceLabel(raw);
  return (
    <Badge size="1" variant="soft" color="cyan" title={raw}>
      <DeviceMobileIcon size={11} className="mr-1 inline-block align-[-1px]" />
      {label || raw}
    </Badge>
  );
}

/** 外链文本。 */
function ExternalLink({ url, label = "打开" }: { url?: string | null; label?: string }) {
  const target = (url ?? "").trim();
  if (!target) return <span className="text-white/35">--</span>;
  return (
    <button
      type="button"
      title={target}
      className="inline-flex max-w-full min-w-0 items-center gap-1 text-left text-blue-300 hover:underline"
      onClick={() => openExternal(target)}
    >
      <span className="min-w-0 truncate">{label}</span>
      <ArrowSquareOutIcon size={12} className="shrink-0" />
    </button>
  );
}

/** 经鉴权代理加载的图片，加载失败时退回占位图标。 */
export function ProxiedImage({
  url,
  className = "h-28 w-full object-cover",
  alt = "",
}: {
  url: string;
  className?: string;
  alt?: string;
}) {
  const resolved = useProxiedMediaUrl(url);
  if (!url || !resolved) {
    return (
      <span className={`grid place-items-center bg-white/5 ${className}`}>
        <ImageSquareIcon size={20} className="text-white/25" />
      </span>
    );
  }
  return <img src={resolved} alt={alt} className={className} />;
}

function SubTitle({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-white/55">
      {icon}
      {text}
    </p>
  );
}

/* ------------------------------ 搜索 ------------------------------ */

function Section<T>({
  icon,
  title,
  items,
  context,
  extras,
  empty,
  render,
}: {
  icon?: React.ReactNode;
  title: string;
  items: readonly T[];
  context: PanelContext;
  extras: (item: T) => Array<string | null | undefined>;
  empty: string;
  render: (item: T) => React.ReactNode;
}) {
  const visible = filterItems(items, context, extras);
  return (
    <div>
      <SubTitle icon={icon} text={`${title}（${countLabel(visible.length, items.length, context)}）`} />
      {visible.length === 0 ? (
        <Hint
          text={
            context.keyword.trim()
              ? `没有匹配的内容（共 ${items.length} 条）`
              : empty
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((item, index) => (
            <RowCard key={index}>{render(item)}</RowCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ 资源信息（目录） ------------------------------ */

export function ResourceInfoPanel({ entry }: { entry: IndexV2Entry }) {
  const repoUrl = `https://github.com/${entry.repo_owner}/${entry.repo_name}`;
  return (
    <Panel title="资源信息">
      <dl className="flex flex-col gap-2.5">
        <DetailRow label="资源 ID">
          <Mono value={entry.id} />
        </DetailRow>
        <DetailRow label="资源类型">
          {formatIndexResourceType(entry.restype)}
        </DetailRow>
        <DetailRow label="付费类型">
          {formatIndexPaidType(entry.paid_type)}
        </DetailRow>
        <DetailRow label="标签">
          <TokenList tokens={entry.tags} />
        </DetailRow>
        <DetailRow label="设备厂商">
          <TokenList tokens={entry.device_vendors} />
        </DetailRow>
        <DetailRow label="设备">
          <TokenList tokens={entry.devices} />
        </DetailRow>
        <DetailRow label="仓库">
          <button
            type="button"
            className="inline-flex items-center gap-1 break-all text-left text-blue-300 hover:underline"
            onClick={() => openExternal(repoUrl)}
          >
            <span className="break-all font-mono-sarasa text-xs">
              {entry.repo_owner}/{entry.repo_name}
            </span>
            <ArrowSquareOutIcon size={13} className="shrink-0" />
          </button>
        </DetailRow>
        <DetailRow label="Commit">
          <Mono value={entry.repo_commit_hash} />
        </DetailRow>
        <DetailRow label="图标路径">
          <Mono value={entry.icon} />
        </DetailRow>
        <DetailRow label="封面路径">
          <Mono value={entry.cover} />
        </DetailRow>
      </dl>
    </Panel>
  );
}

/* ------------------------------ 仓库 manifest ------------------------------ */

interface ManifestPanelProps {
  entry: IndexV2Entry;
  manifest: ManifestV2 | null;
  loading: boolean;
  error: string;
  context?: PanelContext;
}

export function ManifestPanel({
  entry,
  manifest,
  loading,
  error,
  context = DEFAULT_CONTEXT,
}: ManifestPanelProps) {
  if (loading) {
    return (
      <Panel title="资源仓库信息">
        <Hint text="正在读取 manifest_v2.json..." />
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title="资源仓库信息">
        <Hint text={`读取 manifest_v2.json 失败：${error}`} tone="error" />
      </Panel>
    );
  }
  if (!manifest) {
    return (
      <Panel title="资源仓库信息">
        <Hint text="未读取到 manifest_v2.json。" />
      </Panel>
    );
  }

  const item = manifest.item;
  const authors = item.author ?? [];
  const links = (manifest.links ?? []).filter((link) => link.url || link.title);
  const downloads = Object.entries(manifest.downloads ?? {});
  const trialDownloads = Object.entries(manifest.ext?.trialDownloads ?? {});
  const bundled = normalizeBundledResources(manifest.ext?.bundledResources);
  const previews = (item.preview ?? []).filter(Boolean);
  const encrypted = Boolean(manifest.ext?.enableAstroBoxCreatorFeatures);

  return (
    <Panel title="资源仓库信息">
      <dl className="flex flex-col gap-2.5">
        <DetailRow label="资源描述">
          {item.description?.trim() || <span className="text-white/35">--</span>}
        </DetailRow>
        <DetailRow label="作者">
          {authors.length === 0 ? (
            <span className="text-white/35">--</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {authors.map((author) => (
                <Badge
                  key={author.name}
                  size="1"
                  variant="soft"
                  color={author.bindABAccount ? "green" : "gray"}
                >
                  {author.name}
                  {author.bindABAccount ? " · 已绑定" : ""}
                </Badge>
              ))}
            </span>
          )}
        </DetailRow>
        <DetailRow label="AstroBoxCreator 加密">
          <Badge size="1" variant="soft" color={encrypted ? "green" : "gray"}>
            {encrypted ? "开启" : "关闭"}
          </Badge>
        </DetailRow>
      </dl>

      <div className="mt-4 border-t border-white/5 pt-4">
        <Section
          icon={<DownloadSimpleIcon size={14} weight="duotone" />}
          title="包体"
          items={downloads}
          context={context}
          empty="manifest 未声明 downloads。"
          extras={([device, info]) => [
            context.deviceLabel(device),
            info.version,
            info.file_name,
            typeof info.versionCode === "number" ? String(info.versionCode) : "",
          ]}
          render={([device, info]) => (
            <>
              <RowHead>
                <DeviceTag deviceId={device} context={context} />
                <Badge size="1" variant="soft" color="gray">
                  版本 {info.version || "--"}
                </Badge>
                {typeof info.versionCode === "number" ? (
                  <span className="text-xs text-white/45">
                    versionCode {info.versionCode}
                  </span>
                ) : null}
              </RowHead>
              <FieldGrid>
                <Field label="包体文件">
                  <Mono value={info.file_name} />
                </Field>
              </FieldGrid>
            </>
          )}
        />
      </div>

      {trialDownloads.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <Section
            icon={<FingerprintIcon size={14} weight="duotone" />}
            title="试用包体"
            items={trialDownloads}
            context={context}
            empty="--"
            extras={([device, info]) => [
              context.deviceLabel(device),
              info.version,
              info.file_name,
            ]}
            render={([device, info]) => (
              <>
                <RowHead>
                  <DeviceTag deviceId={device} context={context} />
                  <Badge size="1" variant="soft" color="gray">
                    版本 {info.version || "--"}
                  </Badge>
                </RowHead>
                <FieldGrid>
                  <Field label="包体文件">
                    <Mono value={info.file_name} />
                  </Field>
                </FieldGrid>
              </>
            )}
          />
        </div>
      )}

      {bundled.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <Section
            icon={<LinkIcon size={14} weight="duotone" />}
            title="关联资源"
            items={bundled}
            context={context}
            empty="--"
            extras={(item2) => [item2.id, item2.name]}
            render={(item2) => (
              <RowHead>
                <Badge
                  size="1"
                  variant="soft"
                  color={item2.mode === "required" ? "red" : "gray"}
                >
                  {item2.mode === "required" ? "必需" : "推荐"}
                </Badge>
                <Badge size="1" variant="outline" color="gray">
                  {item2.type === "plugin" ? "插件" : "资源"}
                </Badge>
                <span className="font-mono-sarasa text-xs text-white/80">
                  {item2.id}
                </span>
                {item2.name && item2.name !== item2.id ? (
                  <span className="text-white/45">{item2.name}</span>
                ) : null}
              </RowHead>
            )}
          />
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <Section
            icon={<LinkIcon size={14} weight="duotone" />}
            title="链接"
            items={links}
            context={context}
            empty="--"
            extras={(link) => [link.title, link.url]}
            render={(link) => (
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-1.5 text-left text-blue-300 hover:underline"
                onClick={() => openExternal(link.url)}
              >
                <LinkIcon size={13} className="shrink-0" />
                <span className="min-w-0 break-all">{link.title || link.url}</span>
              </button>
            )}
          />
        </div>
      )}

      {previews.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <SubTitle
            icon={<ImageSquareIcon size={14} weight="duotone" />}
            text={`预览图（${previews.length}）`}
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {previews.map((path) => {
              const url = indexItemAssetUrl(entry, path);
              return (
                <button
                  key={path}
                  type="button"
                  title={path}
                  className="overflow-hidden rounded-lg border border-white/10 bg-black/20 transition-colors hover:border-white/25"
                  onClick={() => openExternal(url)}
                >
                  <ProxiedImage url={url} alt={path} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------ AstroBox 后台数据 ------------------------------ */

export function CommercePanel({
  configs,
  loading,
  error,
  permissionDenied,
  context = DEFAULT_CONTEXT,
}: {
  configs: AdminResourceCommerceConfigs | null;
  loading?: boolean;
  error?: string;
  permissionDenied?: boolean;
  context?: PanelContext;
}) {
  if (permissionDenied) {
    return (
      <Panel title="售卖配置">
        <Hint text="需要 admin 权限" />
      </Panel>
    );
  }
  if (loading) {
    return (
      <Panel title="售卖配置">
        <Hint text="正在读取售卖配置..." />
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title="售卖配置">
        <Hint text={`读取售卖配置失败：${error}`} tone="error" />
      </Panel>
    );
  }
  if (!configs) {
    return (
      <Panel title="售卖配置">
        <Hint text="没有售卖配置数据。" />
      </Panel>
    );
  }

  const externalAuthorizations = configs.externalAuthorizations ?? [];

  return (
    <Panel title="售卖配置">
      <div className="flex flex-col gap-4">
        <Section
          icon={<GlobeHemisphereWestIcon size={14} weight="duotone" />}
          title="平台配置"
          items={configs.platformConfigs}
          context={context}
          empty="没有平台配置。"
          extras={(item) => [
            formatCommercePlatform(item.platform),
            context.userName(item.sellerUserId),
            item.enabled ? "启用" : "停用",
          ]}
          render={(item) => (
            <>
              <RowHead>
                <Badge size="1" variant="soft" color="blue">
                  {formatCommercePlatform(item.platform)}
                </Badge>
                <Badge
                  size="1"
                  variant="soft"
                  color={item.enabled ? "green" : "red"}
                >
                  {item.enabled ? "启用" : "停用"}
                </Badge>
              </RowHead>
              <FieldGrid>
                <Field label="卖家">
                  <AdminUserChip userId={item.sellerUserId} />
                </Field>
                <Field label="购买指引">
                  <ExternalLink url={item.buyGuideUrl} label="打开购买指引" />
                </Field>
                <Field label="更新于">{formatDateTime(item.updatedAt)}</Field>
              </FieldGrid>
            </>
          )}
        />

        <Section
          icon={<StorefrontIcon size={14} weight="duotone" />}
          title="商品映射"
          items={configs.products}
          context={context}
          empty="没有商品映射。"
          extras={(item) => [
            formatCommercePlatform(item.platform),
            context.userName(item.sellerUserId),
            item.title,
            item.enabled ? "启用" : "停用",
            formatValidationStatus(item.validationStatus),
          ]}
          render={(item) => (
            <>
              <RowHead>
                <span className="text-sm font-medium text-white">
                  {item.title || "未命名商品"}
                </span>
                <Badge size="1" variant="soft" color="blue">
                  {formatCommercePlatform(item.platform)}
                </Badge>
                <Badge
                  size="1"
                  variant="soft"
                  color={item.enabled ? "green" : "red"}
                >
                  {item.enabled ? "启用" : "停用"}
                </Badge>
                <Badge size="1" variant="soft" color="gray">
                  校验：{formatValidationStatus(item.validationStatus)}
                </Badge>
              </RowHead>
              <FieldGrid>
                <Field label="卖家">
                  <AdminUserChip userId={item.sellerUserId} />
                </Field>
                <Field label="商品 ID">
                  <Mono value={item.externalProductId} />
                </Field>
                <Field label="购买链接">
                  <ExternalLink url={item.buyUrl} label={item.buyUrl || "打开"} />
                </Field>
                <Field label="更新于">{formatDateTime(item.updatedAt)}</Field>
              </FieldGrid>
            </>
          )}
        />

        <Section
          icon={<TagIcon size={14} weight="duotone" />}
          title="SKU 映射"
          items={configs.skus}
          context={context}
          empty="没有 SKU 映射。"
          extras={(item) => [
            formatCommercePlatform(item.platform),
            context.userName(item.sellerUserId),
            context.deviceLabel(item.deviceId),
            item.title,
            item.isPaid ? "付费" : "免费",
            item.enabled ? "启用" : "停用",
          ]}
          render={(item) => (
            <>
              <RowHead>
                <DeviceTag deviceId={item.deviceId} context={context} />
                <Badge size="1" variant="soft" color={item.isPaid ? "amber" : "gray"}>
                  {item.isPaid ? "付费" : "免费"}
                </Badge>
                <Badge
                  size="1"
                  variant="soft"
                  color={item.enabled ? "green" : "red"}
                >
                  {item.enabled ? "启用" : "停用"}
                </Badge>
                {item.title ? (
                  <span className="text-sm text-white/80">{item.title}</span>
                ) : null}
              </RowHead>
              <FieldGrid>
                <Field label="平台">{formatCommercePlatform(item.platform)}</Field>
                <Field label="卖家">
                  <AdminUserChip userId={item.sellerUserId} />
                </Field>
                <Field label="商品 ID">
                  <Mono value={item.externalProductId} />
                </Field>
                <Field label="SKU ID">
                  <Mono value={item.externalSkuId} />
                </Field>
                <Field label="购买链接">
                  <ExternalLink url={item.buyUrl} label={item.buyUrl || "打开"} />
                </Field>
                <Field label="校验">
                  {formatValidationStatus(item.validationStatus)}
                </Field>
              </FieldGrid>
            </>
          )}
        />

        <Section
          icon={<KeyIcon size={14} weight="duotone" />}
          title="CDK"
          items={configs.cdkCodes}
          context={context}
          empty="没有 CDK。"
          extras={(item) => [
            context.deviceLabel(item.deviceId),
            formatCdkStatus(item.status),
            context.userName(item.sellerUserId),
            context.userName(item.redeemedByUserId),
            item.batchId,
          ]}
          render={(item) => (
            <>
              <RowHead>
                <Badge
                  size="1"
                  variant="soft"
                  color={item.status === "available" ? "green" : "blue"}
                >
                  {formatCdkStatus(item.status)}
                </Badge>
                <DeviceTag deviceId={item.deviceId} context={context} />
              </RowHead>
              <FieldGrid>
                <Field label="兑换码">
                  <Mono value={item.code} />
                </Field>
                <Field label="批次">
                  <Mono value={item.batchId} />
                </Field>
                <Field label="卖家">
                  <AdminUserChip userId={item.sellerUserId} />
                </Field>
                <Field label="兑换人">
                  {item.redeemedByUserId ? (
                    <AdminUserChip userId={item.redeemedByUserId} />
                  ) : (
                    <span className="text-white/35">未兑换</span>
                  )}
                </Field>
                <Field label="创建于">{formatDateTime(item.createdAt)}</Field>
              </FieldGrid>
            </>
          )}
        />

        <Section
          icon={<FingerprintIcon size={14} weight="duotone" />}
          title="加密文件键"
          items={configs.fileKeys}
          context={context}
          empty="没有加密文件键。"
          extras={(item) => [
            context.deviceLabel(item.deviceId),
            context.userName(item.firstOwnerId),
            item.encryptedFileHash,
          ]}
          render={(item) => (
            <>
              <RowHead>
                <DeviceTag deviceId={item.deviceId} context={context} />
              </RowHead>
              <FieldGrid>
                <Field label="文件哈希">
                  <Mono value={item.encryptedFileHash} />
                </Field>
                <Field label="首位持有者">
                  {item.firstOwnerId ? (
                    <AdminUserChip userId={item.firstOwnerId} />
                  ) : (
                    <span className="text-white/35">--</span>
                  )}
                </Field>
                <Field label="创建于">{formatDateTime(item.createdAt)}</Field>
              </FieldGrid>
            </>
          )}
        />

        {externalAuthorizations.length > 0 && (
          <Section
            icon={<SealCheckIcon size={14} weight="duotone" />}
            title="自有网站授权"
            items={externalAuthorizations}
            context={context}
            empty="--"
            extras={(item) => [
              item.displayName,
              context.deviceLabel(item.deviceId),
              context.userName(item.sellerUserId),
              item.issuer,
              item.kid,
              String(item.revision),
            ]}
            render={(item) => (
              <>
                <RowHead>
                  <span className="text-sm font-medium text-white">
                    {item.displayName || "未命名授权"}
                  </span>
                  <DeviceTag deviceId={item.deviceId} context={context} />
                  <Badge size="1" variant="soft" color="gray">
                    rev {item.revision}
                  </Badge>
                  <Badge
                    size="1"
                    variant="soft"
                    color={item.enabled ? "green" : "red"}
                  >
                    {item.enabled ? "启用" : "停用"}
                  </Badge>
                </RowHead>
                <FieldGrid>
                  <Field label="卖家">
                    <AdminUserChip userId={item.sellerUserId} />
                  </Field>
                  <Field label="签发者">
                    <Mono value={item.issuer} />
                  </Field>
                  <Field label="密钥 ID">
                    <Mono value={item.kid} />
                  </Field>
                  <Field label="购买链接">
                    <ExternalLink url={item.buyUrl} label={item.buyUrl || "打开"} />
                  </Field>
                  <Field label="授权地址">
                    <ExternalLink
                      url={item.authorizationUrl}
                      label={item.authorizationUrl || "打开"}
                    />
                  </Field>
                  <Field label="更新于">{formatDateTime(item.updatedAt)}</Field>
                </FieldGrid>
              </>
            )}
          />
        )}
      </div>
    </Panel>
  );
}

export function EntitlementsPanel({
  items,
  loading,
  error,
  permissionDenied,
  context = DEFAULT_CONTEXT,
}: {
  items: readonly AdminResourceEntitlement[];
  loading?: boolean;
  error?: string;
  permissionDenied?: boolean;
  context?: PanelContext;
}) {
  if (permissionDenied) {
    return (
      <Panel title="资源权益">
        <Hint text="需要 admin 权限" />
      </Panel>
    );
  }
  const visible = filterItems(items, context, (item) => [
    context.userName(item.buyerUserId),
    context.userName(item.sellerUserId),
    context.deviceLabel(item.deviceId),
    formatEntitlementSource(item.sourceType),
    formatCommercePlatform(item.sourcePlatform),
    item.sourceRef,
  ]);
  return (
    <Panel title={`资源权益（${countLabel(visible.length, items.length, context)}）`}>
      {loading ? (
        <Hint text="正在读取权益..." />
      ) : error ? (
        <Hint text={`读取权益失败：${error}`} tone="error" />
      ) : visible.length === 0 ? (
        <Hint
          text={
            context.keyword.trim()
              ? `没有匹配的内容（共 ${items.length} 条）`
              : "没有权益记录。"
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((item, index) => (
            <RowCard key={index}>
              <RowHead>
                <DeviceTag deviceId={item.deviceId} context={context} />
                <Badge size="1" variant="soft" color="jade">
                  {formatEntitlementSource(item.sourceType)}
                </Badge>
                <Badge size="1" variant="soft" color="blue">
                  {formatCommercePlatform(item.sourcePlatform)}
                </Badge>
                <span className="text-xs text-white/45">
                  {formatDateTime(item.createdAt)}
                </span>
              </RowHead>
              <FieldGrid>
                <Field label="买家">
                  <AdminUserChip userId={item.buyerUserId} />
                </Field>
                <Field label="卖家">
                  <AdminUserChip userId={item.sellerUserId} />
                </Field>
                <Field label="来源单号">
                  <Mono value={item.sourceRef} />
                </Field>
              </FieldGrid>
            </RowCard>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function OrdersPanel({
  items,
  loading,
  error,
  permissionDenied,
  context = DEFAULT_CONTEXT,
}: {
  items: readonly AdminPublicOrder[];
  loading?: boolean;
  error?: string;
  permissionDenied?: boolean;
  context?: PanelContext;
}) {
  if (permissionDenied) {
    return (
      <Panel title="第三方订单">
        <Hint text="需要 admin 权限" />
      </Panel>
    );
  }
  const visible = filterItems(items, context, (item) => [
    context.userName(item.buyerUserId),
    context.userName(item.sellerUserId),
    context.deviceLabel(item.deviceId),
    formatCommercePlatform(item.platform),
    formatPublicOrderStatus(item.status),
    item.externalOrderId,
    item.externalProductId,
    item.externalSkuId,
  ]);
  return (
    <Panel title={`第三方订单（${countLabel(visible.length, items.length, context)}）`}>
      {loading ? (
        <Hint text="正在读取订单..." />
      ) : error ? (
        <Hint text={`读取订单失败：${error}`} tone="error" />
      ) : visible.length === 0 ? (
        <Hint
          text={
            context.keyword.trim()
              ? `没有匹配的内容（共 ${items.length} 条）`
              : "没有订单记录。"
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((item, index) => (
            <RowCard key={index}>
              <RowHead>
                <Badge size="1" variant="soft" color="blue">
                  {formatCommercePlatform(item.platform)}
                </Badge>
                <Badge
                  size="1"
                  variant="soft"
                  color={item.status === "granted" ? "green" : "gray"}
                >
                  {formatPublicOrderStatus(item.status)}
                </Badge>
                <DeviceTag deviceId={item.deviceId} context={context} />
                <span className="text-xs text-white/45">
                  {formatDateTime(item.createdAt)}
                </span>
              </RowHead>
              <FieldGrid>
                <Field label="订单号">
                  <Mono value={item.externalOrderId} />
                </Field>
                <Field label="买家">
                  {item.buyerUserId ? (
                    <AdminUserChip userId={item.buyerUserId} />
                  ) : (
                    <Mono value={item.buyerPlatformUserId} />
                  )}
                </Field>
                <Field label="卖家">
                  <AdminUserChip userId={item.sellerUserId} />
                </Field>
                {!item.buyerUserId && item.buyerPlatformUserId ? (
                  <Field label="平台买家 ID">
                    <Mono value={item.buyerPlatformUserId} />
                  </Field>
                ) : null}
                <Field label="商品 ID">
                  <Mono value={item.externalProductId} />
                </Field>
                <Field label="SKU ID">
                  <Mono value={item.externalSkuId} />
                </Field>
                <Field label="更新时间">{formatDateTime(item.updatedAt)}</Field>
              </FieldGrid>
            </RowCard>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function ReportsPanel({
  items,
  loading,
  error,
  permissionDenied,
  context = DEFAULT_CONTEXT,
}: {
  items: readonly ReportItem[];
  loading?: boolean;
  error?: string;
  permissionDenied?: boolean;
  context?: PanelContext;
}) {
  if (permissionDenied) {
    return (
      <Panel title="举报记录">
        <Hint text="需要 admin 权限" />
      </Panel>
    );
  }
  const visible = filterItems(items, context, (item) => [
    context.userName(item.senderId),
    context.userName(item.handledBy),
    formatReportStatus(item.status),
    formatReportType(item.reportType),
    item.reasonCategory,
    item.reason,
  ]);
  return (
    <Panel title={`举报记录（${countLabel(visible.length, items.length, context)}）`}>
      {loading ? (
        <Hint text="正在读取举报..." />
      ) : error ? (
        <Hint text={`读取举报失败：${error}`} tone="error" />
      ) : visible.length === 0 ? (
        <Hint
          text={
            context.keyword.trim()
              ? `没有匹配的内容（共 ${items.length} 条）`
              : "没有举报记录。"
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((item, index) => (
            <RowCard key={index}>
              <RowHead>
                <Badge
                  size="1"
                  variant="soft"
                  color={item.status === "pending" ? "amber" : "gray"}
                >
                  {formatReportStatus(item.status)}
                </Badge>
                <Badge size="1" variant="soft" color="gray">
                  {formatReportType(item.reportType)}
                </Badge>
                {item.reasonCategory ? (
                  <span className="text-sm text-white/80">{item.reasonCategory}</span>
                ) : null}
                <span className="text-xs text-white/45">
                  {formatDateTime(item.createdAt)}
                </span>
              </RowHead>
              {item.reason ? (
                <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-white/70">
                  {item.reason}
                </p>
              ) : null}
              {item.evidence.filter(Boolean).length > 0 ? (
                <FieldGrid>
                  <Field label="证据">
                    <span className="flex flex-wrap gap-1.5">
                      {item.evidence.filter(Boolean).map((url) => (
                        <ExternalLink key={url} url={url} label="证据链接" />
                      ))}
                    </span>
                  </Field>
                </FieldGrid>
              ) : null}
              <FieldGrid>
                <Field label="举报人">
                  <AdminUserChip userId={item.senderId} />
                </Field>
                <Field label="处理人">
                  {item.handledBy ? (
                    <AdminUserChip userId={item.handledBy} />
                  ) : (
                    <span className="text-white/35">未处理</span>
                  )}
                </Field>
                {item.handledAt ? (
                  <Field label="处理时间">{formatDateTime(item.handledAt)}</Field>
                ) : null}
                {item.resolution ? (
                  <Field label="处理说明">{item.resolution}</Field>
                ) : null}
              </FieldGrid>
            </RowCard>
          ))}
        </div>
      )}
    </Panel>
  );
}
