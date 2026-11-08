import { CrownSimple, PlusIcon } from "@phosphor-icons/react";
import type {
  GithubAccount,
  GithubReaderAccount,
} from "~/logic/account/store";

interface AccountAvatarProps {
  account: { avatar?: string; username: string };
  primary?: boolean;
}

function AccountAvatar({ account, primary }: AccountAvatarProps) {
  return (
    <span
      className="relative inline-flex shrink-0"
      title={primary ? `@${account.username}（主账号）` : `@${account.username}（读取账号）`}
    >
      {account.avatar ? (
        <img
          src={account.avatar}
          alt={account.username}
          className="h-7 w-7 rounded-full object-cover ring-2 ring-[var(--gray-a3)]"
          loading="lazy"
        />
      ) : (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[11px] font-medium text-white/70 ring-2 ring-[var(--gray-a3)]">
          {account.username.slice(0, 1).toUpperCase()}
        </span>
      )}
      {primary && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent-9)] text-white ring-2 ring-[var(--gray-a3)]">
          <CrownSimple size={8} weight="fill" />
        </span>
      )}
    </span>
  );
}

export interface GithubAccountStackProps {
  primary: GithubAccount;
  readers: GithubReaderAccount[];
  canAdd: boolean;
  addDisabledReason?: string;
  onManage: () => void;
  onAdd: () => void;
}

/**
 * 设置页 GitHub 行右侧的账号堆叠：主账号 + 读取账号 + 添加按钮。
 * 点击头像堆叠打开管理抽屉，点击虚线加号直接打开添加对话框。
 */
export default function GithubAccountStack({
  primary,
  readers,
  canAdd,
  addDisabledReason,
  onManage,
  onAdd,
}: GithubAccountStackProps) {
  const visibleReaders = readers.slice(0, 4);
  const extraReaders = readers.length - visibleReaders.length;

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onManage}
        aria-label="管理 GitHub 账号"
        title="管理 GitHub 账号"
        className="flex items-center rounded-full p-0.5 transition-colors hover:bg-white/[0.06]"
      >
        <span className="flex items-center -space-x-2">
          <AccountAvatar account={primary} primary />
          {visibleReaders.map((reader) => (
            <AccountAvatar key={reader.username} account={reader} />
          ))}
        </span>
        {extraReaders > 0 && (
          <span className="ml-1.5 text-xs text-white/45">+{extraReaders}</span>
        )}
      </button>

      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        aria-label="添加读取账号"
        title={canAdd ? "添加读取账号" : addDisabledReason || "暂不可添加读取账号"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-white/30 text-white/55 transition-colors hover:border-white/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PlusIcon size={13} />
      </button>
    </div>
  );
}
