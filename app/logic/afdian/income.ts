const AFDIAN_CREATOR_RATE = 0.94;

export function parseAfdianAmount(value?: string | null) {
  if (!value) return null;
  const amount = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function estimateAfdianMonthlyNet(
  currentMonthAmount: string | null | undefined,
  asOf: string,
) {
  const amount = parseAfdianAmount(currentMonthAmount);
  const date = new Date(asOf);
  if (amount === null || Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, Number(part.value)]),
  );
  const year = values.year;
  const month = values.month;
  const elapsedDays = values.day;
  if (!year || !month || !elapsedDays) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.round(
    ((amount / elapsedDays) * daysInMonth * AFDIAN_CREATOR_RATE + Number.EPSILON) *
      100,
  ) / 100;
}

export function formatAfdianCurrency(value?: number | string | null) {
  const amount =
    typeof value === "number" ? value : parseAfdianAmount(value ?? null);
  if (amount === null || !Number.isFinite(amount)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
