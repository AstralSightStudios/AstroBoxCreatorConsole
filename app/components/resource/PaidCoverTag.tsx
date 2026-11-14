import styles from "./PaidCoverTag.module.css";

/**
 * 与 AstroBox 客户端资源列表封面右上角的付费标签保持一致。
 *
 * 客户端只在封面上标注 `paid` / `force_paid`，免费资源不展示任何标签；
 * 这里沿用同一套判定，避免 ABCC 预览出现客户端里不存在的付费标记。
 */
export type ResourcePaidType = "paid" | "force_paid";

const PAID_TYPE_LABELS: Record<ResourcePaidType, string> = {
  paid: "付费",
  force_paid: "强制付费",
};

export function normalizeResourcePaidType(
  value?: string | null,
): ResourcePaidType | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "paid" || normalized === "force_paid") return normalized;
  return null;
}

export default function PaidCoverTag({
  paidType,
}: {
  paidType?: string | null;
}) {
  const normalized = normalizeResourcePaidType(paidType);
  if (!normalized) return null;
  const label = PAID_TYPE_LABELS[normalized];

  return (
    <span className={styles.host}>
      <span
        className={styles.tag}
        title={label}
        aria-label={`付费类型：${label}`}
      >
        <span className={styles.text}>{label}</span>
      </span>
    </span>
  );
}
