import type { InboxNotification } from "~/logic/inbox/types";

export type PendingAction = "read" | "delete";

export type InboxMessageActionHandlers = {
  onMarkRead: (message: InboxNotification) => void;
  onDeleteMessage: (id: string) => void;
  onToggleMessage: (id: string) => void;
  onOpenResource?: (message: InboxNotification) => void;
};
