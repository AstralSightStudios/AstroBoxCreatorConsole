const AFDIAN_CREATOR_RATE = 0.94;

function getShanghaiDateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, Number(part.value)]),
  );
  if (!values.year || !values.month || !values.day) return null;

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour ?? 0,
  };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseAfdianAmount(value?: string | null) {
  if (!value) return null;
  const amount = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function calculateAfdianNet(amountValue: string | null | undefined) {
  const amount = parseAfdianAmount(amountValue);
  return amount === null ? null : roundCurrency(amount * AFDIAN_CREATOR_RATE);
}

export function getAfdianIncomeMonthLabel(asOf: string) {
  const dateParts = getShanghaiDateParts(asOf);
  return dateParts ? `${dateParts.month}月收入` : "本月收入";
}

export function resolveAfdianSettlementDisplay(input: {
  currentMonth?: string | null;
  previousMonth?: string | null;
  withdrawable?: string | null;
  asOf: string;
}) {
  const withdrawable = parseAfdianAmount(input.withdrawable);
  if (withdrawable !== null && withdrawable > 0) {
    return { label: "可提现" as const, amount: withdrawable };
  }

  const dateParts = getShanghaiDateParts(input.asOf);
  if (!dateParts) {
    return { label: "预计到手" as const, amount: null };
  }
  if (dateParts.day === 1 && dateParts.hour < 10) {
    const previousMonth = parseAfdianAmount(input.previousMonth);
    return {
      label: "预计到手" as const,
      amount:
        previousMonth === null
          ? null
          : roundCurrency(previousMonth * AFDIAN_CREATOR_RATE),
    };
  }

  return {
    label: "预计到手" as const,
    amount: calculateAfdianNet(input.currentMonth),
  };
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
