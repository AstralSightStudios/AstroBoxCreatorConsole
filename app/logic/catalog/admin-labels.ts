/**
 * AstroBox 后台接口返回的枚举值 → 中文标签。
 *
 * 这些值直接展示会是 `afd` / `pending_binding` / `redeemed` 这种原始枚举，
 * 在只读详情页里很难读，所以统一在这里翻译。未知值原样返回，避免丢信息。
 */

const COMMERCE_PLATFORM_LABELS: Record<string, string> = {
  afd: "爱发电",
  cdk: "CDK 兑换",
};

const PUBLIC_ORDER_STATUS_LABELS: Record<string, string> = {
  pending_binding: "待绑定账号",
  granted: "已发放",
  rejected_seller_inactive: "卖家未启用已拒绝",
  ignored_unmapped_sku: "SKU 未映射已忽略",
};

const ENTITLEMENT_SOURCE_LABELS: Record<string, string> = {
  order: "订单",
  cdk: "CDK",
};

const CDK_STATUS_LABELS: Record<string, string> = {
  available: "未使用",
  redeemed: "已兑换",
};

const REPORT_STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  resolved: "已处理",
  dismissed: "已忽略",
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  comment: "评论",
  resource: "资源",
};

const VALIDATION_STATUS_LABELS: Record<string, string> = {
  active: "有效",
  invalid: "失效",
  pending: "待校验",
  failed: "校验失败",
};

function labelOf(map: Record<string, string>, value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return "--";
  return map[raw] ?? raw;
}

export function formatCommercePlatform(value?: string | null) {
  return labelOf(COMMERCE_PLATFORM_LABELS, value);
}

export function formatPublicOrderStatus(value?: string | null) {
  return labelOf(PUBLIC_ORDER_STATUS_LABELS, value);
}

export function formatEntitlementSource(value?: string | null) {
  return labelOf(ENTITLEMENT_SOURCE_LABELS, value);
}

export function formatCdkStatus(value?: string | null) {
  return labelOf(CDK_STATUS_LABELS, value);
}

export function formatReportStatus(value?: string | null) {
  return labelOf(REPORT_STATUS_LABELS, value);
}

export function formatReportType(value?: string | null) {
  return labelOf(REPORT_TYPE_LABELS, value);
}

export function formatValidationStatus(value?: string | null) {
  return labelOf(VALIDATION_STATUS_LABELS, value);
}
