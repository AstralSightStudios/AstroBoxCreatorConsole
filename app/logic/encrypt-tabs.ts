/** 「资源加解密与激活」页的分页签定义。纯逻辑，页面与测试共用。 */

export type EncryptTab =
  | "platform"
  | "files"
  | "cdk"
  | "buyers"
  | "reissue"
  | "external";

export interface EncryptTabDefinition {
  key: EncryptTab;
  label: string;
  /** 仅 Creator+ 及以上可见（与各管理卡片自身的会员门槛一致）。 */
  vipOnly: boolean;
}

export const ENCRYPT_TABS: readonly EncryptTabDefinition[] = [
  { key: "platform", label: "付费平台", vipOnly: false },
  { key: "files", label: "加密文件", vipOnly: false },
  { key: "cdk", label: "CDK 激活码", vipOnly: true },
  { key: "buyers", label: "已购用户", vipOnly: true },
  { key: "reissue", label: "订单补发", vipOnly: true },
  { key: "external", label: "自有网站授权", vipOnly: true },
];

export const DEFAULT_ENCRYPT_TAB: EncryptTab = "platform";

export function availableEncryptTabs(isVip: boolean): EncryptTabDefinition[] {
  return ENCRYPT_TABS.filter((tab) => isVip || !tab.vipOnly);
}

/**
 * 把 URL 里的 `?tab=` 解析成当前可用的分页签：
 * 未知值、缺省、或非会员访问会员页签（分享链接 / 会员过期）都回到默认页签。
 */
export function resolveEncryptTab(
  param: string | null | undefined,
  isVip: boolean,
): EncryptTab {
  const match = availableEncryptTabs(isVip).find((tab) => tab.key === param);
  return match ? match.key : DEFAULT_ENCRYPT_TAB;
}
