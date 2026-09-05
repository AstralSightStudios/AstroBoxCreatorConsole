import AnimatedNumber from "~/components/animated-number";
import DataCard from "~/components/cards/datacard";
import {
  getAfdianIncomeMonthLabel,
  parseAfdianAmount,
  resolveAfdianSettlementDisplay,
} from "~/logic/afdian/income";

const CURRENCY_FORMAT: Intl.NumberFormatOptions = {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

function renderCurrency(value?: number | string | null, loading?: boolean) {
  if (loading) return "...";
  const amount =
    typeof value === "number"
      ? value
      : parseAfdianAmount(value == null ? null : String(value));
  if (amount === null) return "--";

  return (
    <AnimatedNumber
      value={amount}
      initial
      locales="zh-CN"
      format={CURRENCY_FORMAT}
      className="font-mono-sarasa"
    />
  );
}

export default function AfdianMonthlyIncomeCard({
  currentMonth,
  previousMonth,
  withdrawable,
  asOf,
  loading,
}: {
  currentMonth?: string | null;
  previousMonth?: string | null;
  withdrawable?: string | null;
  asOf: string;
  loading?: boolean;
}) {
  const settlement = resolveAfdianSettlementDisplay({
    currentMonth,
    previousMonth,
    withdrawable,
    asOf,
  });

  return (
    <DataCard
      label={getAfdianIncomeMonthLabel(asOf)}
      secondaryLabel={
        settlement.label === "可提现" ? "可提现" : "预计到手 · 扣除 6%"
      }
    >
      <div className="flex items-end justify-between gap-3">
        <p className="card-num">{renderCurrency(currentMonth, loading)}</p>
        <p className="card-num text-right">
          {renderCurrency(settlement.amount, loading)}
        </p>
      </div>
    </DataCard>
  );
}
