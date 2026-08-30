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
import {
  estimateAfdianMonthlyNet,
  formatAfdianCurrency,
} from "~/logic/afdian/income";

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
  const projectedNet = incomeQuery.data
    ? estimateAfdianMonthlyNet(
        incomeQuery.data.currentMonth,
        incomeQuery.data.asOf,
      )
    : null;
  const cards = [
    {
      label: "本月收入",
      value: formatAfdianCurrency(incomeQuery.data?.currentMonth),
    },
    {
      label: "今日收入",
      value: formatAfdianCurrency(incomeQuery.data?.today),
    },
    {
      label: "昨日收入",
      value: formatAfdianCurrency(incomeQuery.data?.yesterday),
    },
    {
      label: "预计本月到手",
      secondaryLabel: "扣除 6%",
      value: formatAfdianCurrency(projectedNet),
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
            {cards.map(({ label, secondaryLabel, value }) => (
              <DataCard
                key={label}
                label={label}
                secondaryLabel={secondaryLabel}
              >
                <p className="card-num">{loading ? "..." : value}</p>
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
