import { invoke } from "@tauri-apps/api/core";

export const AFDIAN_MANAGEMENT_OVERVIEW_QUERY_KEY = [
  "afdian",
  "management-overview",
] as const;

export interface AfdianManagementOverview {
  todayIncome: string;
  todayOrderCount: number;
  monthIncome?: string | null;
  allIncome?: string | null;
  recentSponsorCount?: number | null;
  allSponsorCount?: number | null;
  uv?: number | null;
  pv?: number | null;
  balance?: string | null;
  balanceAfterTax?: string | null;
  asOf: string;
}

export interface AfdianIncomeStatItem {
  date: string;
  income: string;
  orderCount?: number | null;
  sponsorCount?: number | null;
  returningSponsorCount?: number | null;
  uv?: number | null;
}

export interface AfdianIncomeStatPage {
  items: AfdianIncomeStatItem[];
  page: number;
  hasMore: boolean;
}

export interface AfdianReceivedOrder {
  id: string;
  title: string;
  amount: string;
  status?: number | null;
  createdAt?: string | null;
  sponsorName: string;
  sponsorAvatar?: string | null;
  planName?: string | null;
  remark?: string | null;
  productType?: number | null;
}

export interface AfdianReceivedOrderPage {
  items: AfdianReceivedOrder[];
  page: number;
  hasMore: boolean;
  nextOrderId?: string | null;
  nextCartOrderId?: string | null;
}

export interface AfdianSponsorItem {
  id: string;
  name: string;
  avatar?: string | null;
  totalAmount: string;
  firstSponsoredAt?: string | null;
  lastSponsoredAt?: string | null;
  planNames: string[];
}

export interface AfdianSponsorPage {
  items: AfdianSponsorItem[];
  page: number;
  totalCount?: number | null;
  totalPage?: number | null;
  hasMore: boolean;
}

export function getAfdianManagementOverview() {
  return invoke<AfdianManagementOverview>("afdian_management_overview");
}

export function getAfdianIncomeStats(page: number) {
  return invoke<AfdianIncomeStatPage>("afdian_income_stats", { page });
}

export function getAfdianReceivedOrders(input: {
  page: number;
  lastOrderId?: string | null;
  lastCartOrderId?: string | null;
}) {
  return invoke<AfdianReceivedOrderPage>("afdian_received_orders", input);
}

export function getAfdianSponsors(page: number) {
  return invoke<AfdianSponsorPage>("afdian_sponsors", { page });
}
