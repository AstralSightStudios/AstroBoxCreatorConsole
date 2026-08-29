import { BellIcon } from "@phosphor-icons/react";
import { useInboxUnreadCount } from "~/logic/inbox/store";

export default function InboxBell({ onClick }: { onClick: () => void }) {
  const count = useInboxUnreadCount();

  return (
    <button
      type="button"
      aria-label="信箱"
      onClick={onClick}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/30"
    >
      <BellIcon size={18} />
      {count > 0 ? (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
