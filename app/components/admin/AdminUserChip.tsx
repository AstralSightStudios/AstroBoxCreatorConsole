import { UserIcon } from "@phosphor-icons/react";
import { Link } from "react-router";
import {
  adminUserDisplayName,
  useAdminUserEntry,
} from "~/logic/account/admin-user-directory";

/**
 * 账号胶囊：解析 uid 后显示头像 + 昵称，点击跳到「账号管理 → 用户详情」。
 *
 * 解析不出来时（账号被删 / 当前账号没有后台权限）退回展示 uid 本身，
 * 保证信息不丢；未解析完成时先显示 uid、解析完成后自动替换为昵称。
 */
export function AdminUserChip({
  userId,
  className = "",
}: {
  userId?: string | null;
  className?: string;
}) {
  const id = (userId ?? "").trim();
  const { user } = useAdminUserEntry(id);

  if (!id) return <span className="text-white/35">--</span>;

  const name = adminUserDisplayName(user, id);

  return (
    <Link
      to={`/admin/accounts?userId=${encodeURIComponent(id)}`}
      title={user ? `${name} · ${id}` : id}
      className={`inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-0.5 pr-2 pl-0.5 text-xs text-white/85 transition-colors align-middle hover:border-white/25 hover:bg-white/[0.1] hover:text-white ${className}`}
    >
      {user?.avatar ? (
        <img
          src={user.avatar}
          alt=""
          className="size-5 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/10 text-white/45">
          <UserIcon size={11} />
        </span>
      )}
      <span className="min-w-0 truncate">{name}</span>
    </Link>
  );
}
