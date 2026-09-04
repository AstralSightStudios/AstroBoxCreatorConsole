import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "@radix-ui/themes";
import { useNavigate } from "react-router";
import {
  AFDIAN_INCOME_QUERY_KEY,
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianErrorMessage,
  getAfdianIncomeOverview,
  getAfdianSessionStatus,
  isAfdianNativeAvailable,
} from "~/api/afdian-account";
import DataCard from "~/components/cards/datacard";
import AnimatedNumber from "~/components/animated-number";
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

function renderCurrency(
  value?: number | string | null,
  loading?: boolean,
) {
  if (loading) return "...";
  const amount = parseAfdianAmount(value == null ? null : String(value));
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

function formatUpdatedAt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export default function AfdianIncomeOverview() {
  const navigate = useNavigate();
  const nativeAvailable = isAfdianNativeAvailable();
  const sessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: nativeAvailable,
    staleTime: 30_000,
    retry: false,
  });
  const incomeQuery = useQuery({
    queryKey: AFDIAN_INCOME_QUERY_KEY,
    queryFn: getAfdianIncomeOverview,
    enabled: nativeAvailable && sessionQuery.data?.connected === true,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  if (!nativeAvailable) return null;

  const loading = sessionQuery.isLoading || incomeQuery.isLoading;
  const incomeMonthLabel = getAfdianIncomeMonthLabel(
    incomeQuery.data?.asOf ?? "",
  );
  const settlement = incomeQuery.data
    ? resolveAfdianSettlementDisplay(incomeQuery.data)
    : { label: "预计到手" as const, amount: null };
  const cards = [
    {
      label: "今日收入",
      value: incomeQuery.data?.today,
    },
    {
      label: "昨日收入",
      value: incomeQuery.data?.yesterday,
    },
  ];

  return (
    <section>
      <div className="flex items-center px-1.5 pt-3">
        <p className="font-[520] text-size-large">爱发电收入</p>
        {incomeQuery.data?.asOf && (
          <p className="ml-auto text-size-small text-white/40">
            更新于 {formatUpdatedAt(incomeQuery.data.asOf)}
          </p>
        )}
      </div>

      {sessionQuery.isError ? (
        <div className="px-1.5 py-3 text-size-small text-white/55">
          {getAfdianErrorMessage(
            sessionQuery.error,
            "无法读取爱发电登录状态",
          )}
        </div>
      ) : !sessionQuery.isLoading && !sessionQuery.data?.connected ? (
        <div className="flex items-center justify-between gap-3 px-1.5 py-3">
          <p className="text-size-small text-white/55">
            登录爱发电后即可查看收入数据。
          </p>
          <Button variant="soft" onClick={() => navigate("/settings")}>
            前往设置
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 py-1.5 lg:grid-cols-4">
            <div className="col-span-2">
              <DataCard
                label={incomeMonthLabel}
                secondaryLabel={
                  settlement.label === "可提现"
                    ? "可提现"
                    : "预计到手 · 扣除 6%"
                }
              >
                <div className="flex items-end justify-between gap-3">
                  <p className="card-num">
                    {renderCurrency(incomeQuery.data?.currentMonth, loading)}
                  </p>
                  <p className="card-num text-right">
                    {renderCurrency(settlement.amount, loading)}
                  </p>
                </div>
              </DataCard>
            </div>
            {cards.map(({ label, value }) => (
              <DataCard key={label} label={label}>
                <p className="card-num">{renderCurrency(value, loading)}</p>
              </DataCard>
            ))}
          </div>
          {incomeQuery.isError && (
            <div className="flex items-center gap-2 px-1.5 pb-2 text-size-small text-white/55">
              <span>
                {getAfdianErrorMessage(
                  incomeQuery.error,
                  "爱发电收入暂时无法加载",
                )}
              </span>
              <Button variant="ghost" onClick={() => void incomeQuery.refetch()}>
                {incomeQuery.isFetching ? <Spinner size="1" /> : "重试"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
