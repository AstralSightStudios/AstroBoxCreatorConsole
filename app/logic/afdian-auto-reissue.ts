import type {
  AfdianAutoReissueStats,
  AfdianAutoReissueStatus,
} from "~/api/astrobox/order";

/**
 * 爱发电「自动补单」的展示与输入校验（服务端托管凭据，每 15 分钟补一次）。
 * 输入规则与服务端 AfdianAutoReissueModel.saveBody 保持一致：
 * user_id 8–64 位、token 8–128 位，只允许字母数字、下划线与连字符。
 */

const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateAutoReissueInput(afdianUserId: string, token: string): string | null {
  const userId = afdianUserId.trim();
  const secret = token.trim();
  if (!userId || !secret) return "请输入爱发电 user_id 和 API token";
  if (userId.length < 8 || userId.length > 64 || !CREDENTIAL_PATTERN.test(userId)) {
    return "user_id 格式不对，请从爱发电开发者后台复制";
  }
  if (secret.length < 8 || secret.length > 128 || !CREDENTIAL_PATTERN.test(secret)) {
    return "API token 格式不对，请从爱发电开发者后台复制";
  }
  return null;
}

export type AutoReissueTone = "green" | "orange" | "red" | "gray";

export interface AutoReissueStateView {
  tone: AutoReissueTone;
  label: string;
  /** 补充说明（一行），没有就为空。 */
  detail: string;
}

/** 服务端因凭据问题停用（`lastStatus === "disabled"`）时，从 lastError 看是哪种。 */
function disabledDetail(lastError: string) {
  if (lastError.startsWith("credentials_unreadable")) return "已存的凭据无法读取，请重新填写";
  if (lastError.startsWith("rejected")) return "爱发电多次拒绝了这组凭据，请确认后重新填写";
  return "请重新填写凭据后开启";
}

/** 配置的当前状态 → 徽标颜色与文字。 */
export function describeAutoReissueState(status: AfdianAutoReissueStatus): AutoReissueStateView {
  if (!status.configured) return { tone: "gray", label: "未开启", detail: "" };
  if (!status.enabled) {
    return { tone: "red", label: "已停用", detail: disabledDetail(status.lastError) };
  }
  switch (status.lastStatus) {
    case "":
      return { tone: "gray", label: "等待首次同步", detail: "" };
    case "ok":
      return { tone: "green", label: "运行正常", detail: "" };
    case "network":
      return { tone: "orange", label: "暂时连不上爱发电", detail: "会自动放慢重试" };
    case "rejected":
      return {
        tone: "orange",
        label: "爱发电拒绝了请求",
        detail: "多次失败会自动停用，可重新填写凭据",
      };
    case "seller_inactive":
      return { tone: "orange", label: "已暂停", detail: "你当前没有创作者权限，恢复后会自动继续" };
    default:
      return { tone: "orange", label: "服务端处理出错", detail: "会自动稍后重试" };
  }
}

/** 最近一轮的统计 → 一行文字；还没跑过返回空串。 */
export function formatAutoReissueStats(
  stats: AfdianAutoReissueStats,
  lastStatus: string,
): string {
  if (lastStatus !== "ok") return "";
  const parts = [`读取 ${stats.fetched} 笔订单`];
  if (stats.checked > 0) parts.push(`校对 ${stats.checked} 笔`);
  if (stats.granted > 0) parts.push(`补发 ${stats.granted} 项`);
  if (stats.waitingBinding > 0) parts.push(`${stats.waitingBinding} 项买家尚未绑定`);
  if (stats.failed > 0) parts.push(`${stats.failed} 项补发失败`);
  if (stats.truncated) parts.push("订单较多，更早的订单未读取");
  return parts.join("，");
}

export function formatAutoReissueTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
