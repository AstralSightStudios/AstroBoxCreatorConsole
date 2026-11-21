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

/**
 * 向下取整到分：3.1490 → 3.14。
 *
 * 到手金额宁可少算一分，也不把用户能拿到的钱算多，因此与爱发电口径一致用 FLOOR
 * 而不是四舍五入。先 `toFixed(6)` 消掉 `40.419999999999995` 这类二进制误差，
 * 再乘 100 取整——直接用 `Number.EPSILON` 补偿是无效的，它是绝对量级（2.2e-16），
 * 对千元级金额的小数误差毫无作用。
 */
function floorCurrency(value: number) {
  const cents = Number((value * 100).toFixed(6));
  return Math.floor(cents) / 100;
}

export function parseAfdianAmount(value?: string | null) {
  if (!value) return null;
  const amount = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function calculateAfdianNet(amountValue: string | null | undefined) {
  const amount = parseAfdianAmount(amountValue);
  return amount === null ? null : floorCurrency(amount * AFDIAN_CREATOR_RATE);
}

export function getAfdianIncomeMonthLabel(asOf: string) {
  const dateParts = getShanghaiDateParts(asOf);
  return dateParts ? `${dateParts.month}月收入` : "本月收入";
}

/**
 * 是否处于结算期（自然月已翻篇、上月收入还没结算进余额）。
 *
 * 两个来源任一生效即为 true，与爱发电 App 的 `WithdrawalSchedule.calculate` 同构：
 * - 本地时钟落在每月 1 日 0:00–10:00；
 * - 服务端 `dashboard.balance` 返回「结算中」文案。
 *
 * 服务端信号没有时间戳，只在 1 号当天认它：如果进程从 1 号一直挂到 5 号都没刷新成功，
 * 不加日期保护就会把 5 号误判成结算期。
 */
export function isAfdianSettlementWindow(input: {
  asOf: string;
  isBalanceSettling?: boolean;
}) {
  const dateParts = getShanghaiDateParts(input.asOf);
  if (!dateParts) return false;
  const isFirstDay = dateParts.day === 1;
  const isLocalWindow = isFirstDay && dateParts.hour < 10;
  const isServerSettling = isFirstDay && input.isBalanceSettling === true;
  return isLocalWindow || isServerSettling;
}

export interface AfdianSettlementDisplay {
  /** 是否处于结算期（决定卡片切「上月」口径）。 */
  isSettlementWindow: boolean;
  /** 卡片标题：结算期是「上月收入」，其余是「N月收入」。 */
  label: string;
  /** 右列副标题：可提现 / 预计到手。 */
  secondaryLabel: string;
  /** 左列金额：结算期取待结算金额，其余取本月收入。 */
  income: number | null;
  /** 右列金额：可提现余额优先，否则按 94% 估算到手。 */
  afterFee: number | null;
}

/**
 * 首页收入卡的展示口径。
 *
 * 结算期内 dashboard 的「本月」已经翻篇成新月份（通常是 0.00），用户关心的是正在结算的
 * 上月收入，因此左列改用 `summary.unconfirmed_amount`、标题改「上月收入」。
 * 刻意不回退到「上月收入」卡的金额：那是订单聚合口径，结算期里往往还是空的或滞后一轮，
 * 只有 unconfirmed_amount 是结算流程本身给出的数字。取不到时返回 null（UI 显示 "--"），
 * 不用 0 冒充。
 */
export function resolveAfdianSettlementDisplay(input: {
  currentMonth?: string | null;
  unconfirmedAmount?: string | null;
  withdrawable?: string | null;
  asOf: string;
  isBalanceSettling?: boolean;
}): AfdianSettlementDisplay {
  const isSettlementWindow = isAfdianSettlementWindow(input);
  const withdrawable = parseAfdianAmount(input.withdrawable);
  const canWithdraw = withdrawable !== null && withdrawable > 0;
  const primaryAmount = isSettlementWindow
    ? input.unconfirmedAmount
    : input.currentMonth;
  const income = parseAfdianAmount(primaryAmount);

  return {
    isSettlementWindow,
    label: isSettlementWindow
      ? "上月收入"
      : getAfdianIncomeMonthLabel(input.asOf),
    secondaryLabel: canWithdraw ? "可提现" : "预计到手 · 扣除 6%",
    income,
    afterFee: canWithdraw ? withdrawable : calculateAfdianNet(primaryAmount),
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
