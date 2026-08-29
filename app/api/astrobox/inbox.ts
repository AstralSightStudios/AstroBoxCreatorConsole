import { sendApiRequest } from "./request";
import type { InboxListResponse } from "~/logic/inbox/types";

function buildQuery(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** 用户侧信箱 API（与 NG 共用同一份 inbox 数据，CC 侧仅展示 cc-notice）。 */
export const InboxApi = {
  list: (query: { limit?: number; cursor?: string; onlyUnread?: boolean } = {}) =>
    sendApiRequest<InboxListResponse>(`/inbox${buildQuery(query)}`, "GET"),
  unreadCount: () =>
    sendApiRequest<{ count: number }>("/inbox/unread-count", "GET"),
  markRead: (id: string) =>
    sendApiRequest<{ ok: true }>(
      `/inbox/${encodeURIComponent(id)}/read`,
      "POST",
    ),
  markAllRead: () =>
    sendApiRequest<{ count: number }>("/inbox/read-all", "POST"),
  remove: (id: string) =>
    sendApiRequest<{ ok: true }>(`/inbox/${encodeURIComponent(id)}`, "DELETE"),
};
