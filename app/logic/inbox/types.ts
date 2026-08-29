export type CcNoticeSubtype =
  | "review-changes-requested"
  | "review-approved"
  | "review-refused"
  | "review-closed";

export interface CcNoticeMetadata {
  subtype: CcNoticeSubtype;
  tagId?: string | null;
  content?: string | null;
  prNumber?: number;
  prUrl?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  deepLink?: string | null;
  senderNote?: string | null;
}

export interface InboxNotification {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  metadata: unknown;
  senderType: "system" | "admin";
  senderId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface InboxListResponse {
  items: InboxNotification[];
  hasMore: boolean;
  nextCursor: string | null;
}

export const CC_NOTICE_BADGES: Record<
  CcNoticeSubtype,
  { label: string; className: string }
> = {
  "review-changes-requested": {
    label: "需修改",
    className: "bg-amber-500/15 text-amber-100",
  },
  "review-approved": {
    label: "已通过",
    className: "bg-emerald-500/15 text-emerald-100",
  },
  "review-refused": {
    label: "已拒绝",
    className: "bg-purple-500/15 text-purple-100",
  },
  "review-closed": {
    label: "已关闭",
    className: "bg-red-500/15 text-red-100",
  },
};

export function isCcNoticeMetadata(
  metadata: unknown,
): metadata is CcNoticeMetadata {
  if (typeof metadata !== "object" || metadata === null) return false;
  const subtype = (metadata as Record<string, unknown>).subtype;
  return typeof subtype === "string" && subtype in CC_NOTICE_BADGES;
}
