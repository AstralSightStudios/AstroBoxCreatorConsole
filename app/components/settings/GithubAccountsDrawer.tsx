import { useEffect } from "react";
import {
  ArrowClockwiseIcon,
  Info,
  PlusIcon,
  SealCheckIcon,
  SignOutIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Badge, Button, Callout, Spinner } from "@radix-ui/themes";
import FloatingDrawer from "~/components/drawer/FloatingDrawer";
import {
  useGithubQuota,
  type GithubAccountQuota,
} from "~/logic/account/github-tokens";
import type { CommunityRepoManageAccess } from "~/logic/account/repo-permission";
import type {
  GithubAccount,
  GithubReaderAccount,
} from "~/logic/account/store";
import { getGithubReaderGateMessage } from "./github-reader-gate";

function formatResetTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "稍后";
  }
}

function formatQuota(quota?: GithubAccountQuota): string {
  if (!quota) return "额度未知";
  if (quota.invalid) return "Token 已失效";
  const core = quota.core;
  if (!core) return "额度未知";
  if (core.remaining <= 0) {
    return `额度已用完，${formatResetTime(core.resetAt)} 恢复`;
  }
  return `剩余 ${core.remaining.toLocaleString()} / ${core.limit.toLocaleString()} · ${formatResetTime(core.resetAt)} 重置`;
}

function AccountAvatar({
  account,
}: {
  account: { avatar?: string; username: string };
}) {
  if (account.avatar) {
    return (
      <img
        src={account.avatar}
        alt={account.username}
        className="h-11 w-11 shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-sm font-semibold text-white/60">
      {account.username.slice(0, 1).toUpperCase()}
    </span>
  );
}

export interface GithubAccountsDrawerProps {
  open: boolean;
  onClose: () => void;
  primary?: GithubAccount;
  readers: GithubReaderAccount[];
  access: CommunityRepoManageAccess;
  canAdd: boolean;
  onAdd: () => void;
  onRemoveReader: (reader: GithubReaderAccount) => void;
  onLogoutPrimary: () => void;
  onRefreshQuota: () => Promise<void> | void;
  refreshingQuota?: boolean;
}

/**
 * 设置页「GitHub 账号」管理抽屉：主账号、读取账号、额度与移除入口。
 * 读取账号仅用于审核内容读取，写操作始终走主账号。
 */
export default function GithubAccountsDrawer({
  open,
  onClose,
  primary,
  readers,
  access,
  canAdd,
  onAdd,
  onRemoveReader,
  onLogoutPrimary,
  onRefreshQuota,
  refreshingQuota,
}: GithubAccountsDrawerProps) {
  const quotas = useGithubQuota();
  const quotaByLogin = new Map(
    quotas.map((quota) => [quota.login.trim().toLowerCase(), quota]),
  );
  const gateMessage = getGithubReaderGateMessage(access);

  useEffect(() => {
    if (!open) return;
    void onRefreshQuota();
  }, [open, onRefreshQuota]);

  const permissionTitle = access.checking
    ? "正在校验审核权限"
    : access.allowed
      ? "审核权限已确认"
      : access.error
        ? `审核权限校验失败：${access.error}`
        : "当前主账号无审核权限";

  return (
    <FloatingDrawer
      open={open}
      onClose={onClose}
      title="GitHub 账号"
      description="主账号负责审核与合并，读取账号分摊内容浏览的 API 额度"
      handleLabel="收起账号"
      maxWidth={600}
    >
      <header className="flex items-center justify-between gap-3 px-5.5 pt-1.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-[700] leading-none text-[color:var(--text-color)]">
            GitHub 账号
          </h1>
          <p className="mt-1 text-[12px] text-white/50">
            主账号负责审核与合并，读取账号只读公开内容
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭 GitHub 账号"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[color:var(--text-color)] opacity-60 transition hover:bg-[var(--nav-btn-bg)] hover:opacity-100"
        >
          <XIcon size={18} />
        </button>
      </header>

      <div
        data-vaul-no-drag
        className="mt-2 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-[max(0.875rem,var(--ui-safe-area-bottom))]"
      >
        <p className="mb-3 rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-white/55">
          读取账号仅用于审核内容读取，不会执行批准、合并或评论。该功能只对具备当前社区仓库审核权限的主账号开放，用于审核者绕过 GitHub API 速率限制。
        </p>

        {gateMessage && (
          <Callout.Root color="amber" size="1" className="mb-3">
            <Callout.Icon>
              <Info size={16} />
            </Callout.Icon>
            <Callout.Text>{gateMessage}</Callout.Text>
          </Callout.Root>
        )}

        {primary ? (
          <div className="rounded-[14px] border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center gap-3">
              <AccountAvatar account={primary} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">
                    {primary.name || primary.username}
                  </span>
                  <Badge color="gray" size="1">
                    主账号
                  </Badge>
                  <span
                    className="inline-flex items-center"
                    title={permissionTitle}
                    aria-label={permissionTitle}
                  >
                    {access.checking ? (
                      <Spinner size="1" />
                    ) : access.allowed ? (
                      <SealCheckIcon
                        size={16}
                        weight="fill"
                        className="text-emerald-400"
                      />
                    ) : (
                      <WarningIcon
                        size={16}
                        weight="fill"
                        className="text-amber-400"
                      />
                    )}
                  </span>
                </div>
                <div className="truncate text-xs text-white/45">
                  @{primary.username}
                </div>
                <div className="mt-1 text-[11px] text-white/45">
                  {formatQuota(quotaByLogin.get(primary.username.toLowerCase()))}
                </div>
              </div>
              <Button
                variant="soft"
                color="red"
                onClick={onLogoutPrimary}
              >
                <SignOutIcon size={15} />
                退出登录
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-[14px] border border-white/10 bg-white/[0.03] p-4 text-sm text-white/55">
            请先登录 GitHub 主账号。
          </div>
        )}

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-white">读取账号</h2>
            <span className="text-[11px] text-white/40">
              {readers.length > 0 ? `${readers.length} 个` : "未添加"}
            </span>
          </div>

          {readers.length === 0 ? (
            <p className="rounded-[14px] border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">
              还没有读取账号。添加一个独立账号后，审核内容浏览会优先使用它的额度。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {readers.map((reader) => {
                const quota = quotaByLogin.get(reader.username.toLowerCase());
                return (
                  <div
                    key={reader.username}
                    className="flex items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.03] p-3"
                  >
                    <AccountAvatar account={reader} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-white">
                          {reader.name || reader.username}
                        </span>
                        <Badge color="gray" size="1">
                          读取账号
                        </Badge>
                        <Badge color="gray" size="1">
                          {reader.authType === "pat" ? "Token" : "GitHub 登录"}
                        </Badge>
                        {!access.allowed && (
                          <Badge color="amber" size="1">
                            已暂停
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-xs text-white/45">
                        @{reader.username}
                      </div>
                      <div className="mt-1 text-[11px] text-white/45">
                        {formatQuota(quota)}
                      </div>
                    </div>
                    <Button
                      variant="soft"
                      color="red"
                      size="2"
                      aria-label={`移除 ${reader.username}`}
                      onClick={() => onRemoveReader(reader)}
                    >
                      <TrashIcon size={15} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <div className="rounded-[14px] border border-dashed border-white/15 bg-white/[0.03] p-3">
            <Button
              className="w-full"
              disabled={!canAdd}
              onClick={onAdd}
              aria-label="添加读取账号"
            >
              <PlusIcon size={14} />
              添加读取账号
            </Button>
            {!canAdd && gateMessage && (
              <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                {gateMessage}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              variant="soft"
              color="gray"
              disabled={refreshingQuota}
              onClick={() => void onRefreshQuota()}
            >
              {refreshingQuota ? (
                <Spinner size="1" />
              ) : (
                <ArrowClockwiseIcon size={14} />
              )}
              刷新额度
            </Button>
          </div>
        </div>
      </div>
    </FloatingDrawer>
  );
}
