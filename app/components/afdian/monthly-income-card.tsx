import AnimatedNumber from "~/components/animated-number";
import DataCard from "~/components/cards/datacard";
import {
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
  unconfirmedAmount,
  withdrawable,
  asOf,
  isBalanceSettling,
  loading,
}: {
  currentMonth?: string | null;
  unconfirmedAmount?: string | null;
  withdrawable?: string | null;
  asOf: string;
  isBalanceSettling?: boolean;
  loading?: boolean;
}) {
  const settlement = resolveAfdianSettlementDisplay({
    currentMonth,
    unconfirmedAmount,
    withdrawable,
    asOf,
    isBalanceSettling,
  });

  return (
    <DataCard label={settlement.label} secondaryLabel={settlement.secondaryLabel}>
      <div className="flex items-end justify-between gap-3">
        <p className="card-num">{renderCurrency(settlement.income, loading)}</p>
        <p className="card-num text-right">
          {renderCurrency(settlement.afterFee, loading)}
        </p>
      </div>
    </DataCard>
  );
}
