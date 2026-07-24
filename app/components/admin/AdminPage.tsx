import { Button, Spinner } from "@radix-ui/themes";
import { useAccountState } from "~/logic/account/store";

export function hasAnyRole(
  roles: readonly string[] | undefined,
  required: readonly string[] = ["admin", "moderator"],
) {
  return required.some((role) => roles?.includes(role));
}

export function AdminPage({
  title,
  description,
  requiredRoles = ["admin", "moderator"],
  loading,
  error,
  onRetry,
  children,
}: {
  title: string;
  description?: string;
  requiredRoles?: string[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  const accountState = useAccountState();
  const roles = accountState.astrobox?.roles ?? [];

  if (!accountState.astrobox) {
    return (
      <AdminState title={title} text="请先登录 AstroBox 账号。" />
    );
  }

  if (!hasAnyRole(roles, requiredRoles)) {
    return (
      <AdminState
        title={title}
        text="当前账号没有访问这个管理后台的权限。"
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto px-2 py-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        {description && (
          <div className="flex flex-col gap-1 px-1">
            <p className="text-sm text-white/60">{description}</p>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-between rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            <span>{error}</span>
            {onRetry && (
              <Button size="1" variant="soft" color="red" onClick={onRetry}>
                重试
              </Button>
            )}
          </div>
        )}
        {loading ? (
          <div className="grid min-h-[360px] place-items-center text-white/70">
            <Spinner />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function AdminState({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-md rounded-2xl border border-white/10 bg-nav-item p-6 text-center">
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-white/60">{text}</p>
      </div>
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-nav-item p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="min-w-0 text-[16px] font-semibold text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-white/70">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full min-w-0 min-h-10 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none transition focus:border-white/30";

export const textareaClass =
  "w-full min-w-0 min-h-28 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30";

export function formatDateTime(value?: string | Date | null) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatList(value: unknown) {
  if (!value) return "--";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "--";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
