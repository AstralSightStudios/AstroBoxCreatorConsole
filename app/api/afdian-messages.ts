import { invoke } from "@tauri-apps/api/core";

export const AFDIAN_DIALOGS_QUERY_KEY = ["afdian", "dialogs"] as const;

export interface AfdianDialogUser {
  userId: string;
  name: string;
  avatar?: string | null;
}

export interface AfdianDialog {
  latestMessageId?: string | null;
  unreadCount: number;
  totalCount: number;
  status?: number | null;
  user: AfdianDialogUser;
  preview?: string | null;
  sentAt?: string | null;
}

export interface AfdianDialogPage {
  items: AfdianDialog[];
  page: number;
  totalCount?: number | null;
  totalPage?: number | null;
  hasMore: boolean;
}

export interface AfdianMessage {
  id: string;
  direction: "send" | "receive" | string;
  sender?: string | null;
  messageType?: number | null;
  content: unknown;
  sentAt?: string | null;
  readStatus?: number | null;
}

export interface AfdianMessagePage {
  items: AfdianMessage[];
  hasMore: boolean;
  oldestMessageId?: string | null;
  latestMessageId?: string | null;
}

export interface AfdianMessageUserDetails {
  userId: string;
  cover?: string | null;
  urlSlug?: string | null;
  status?: number | null;
  gender?: number | null;
  birthday?: string | null;
  isVerified?: boolean | null;
  verifiedType?: number | null;
  creatorType?: number | null;
  creatorDoing?: string | null;
  creatorDetail?: string | null;
  categoryName?: string | null;
  monthlyFans?: string | null;
  monthlyIncome?: string | null;
  sponsoredAmount?: string | null;
  sponsoredOrderCount?: number | null;
  sponsoredPlanNames: string[];
  lastSponsoredAt?: string | null;
  receivedAmount?: string | null;
  receivedOrderCount?: number | null;
  receivedPlanNames: string[];
  lastReceivedAt?: string | null;
}

export function getAfdianDialogs(page: number) {
  return invoke<AfdianDialogPage>("afdian_message_dialogs", { page });
}

export function getAfdianMessages(input: {
  userId: string;
  messageType?: "old" | "new";
  messageId?: string | null;
}) {
  return invoke<AfdianMessagePage>("afdian_message_messages", {
    userId: input.userId,
    messageType: input.messageType ?? "new",
    messageId: input.messageId ?? null,
  });
}

export function getAfdianMessageUserDetails(userId: string) {
  return invoke<AfdianMessageUserDetails>("afdian_message_user_details", {
    userId,
  });
}

export function sendAfdianMessage(input: {
  userId: string;
  content: string;
}) {
  return invoke<AfdianMessage>("afdian_message_send", {
    userId: input.userId,
    content: input.content,
  });
}
