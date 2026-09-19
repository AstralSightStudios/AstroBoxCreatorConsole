import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { useAccountState } from "~/logic/account/store";
import { AstroboxLinkIcon } from "~/components/phosphor-icon";
import { formatResourceType } from "~/logic/publish/resource-type";
import {
  useAuthorsProStatuses,
  hasCreatorPro,
  vipTierLabel,
  isVipActive,
  type AuthorProStatus,
} from "../owner-pro";
import { usePaidRatioStatus } from "../utils/paid-ratio";
import type { PrResourcePreview } from "../types";
import { ResourceDownloadsSection } from "./ResourceDownloadsSection";
import { ResourceImagesSection } from "./ResourceImagesSection";

// --- Helpers ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasUrl(value: string): boolean {
  return /https?:\/\/[^\s)]+/.test(value);
}

function formatPaidType(paidType?: string): string {
  const normalized = (paidType || "").trim().toLowerCase();
  if (!normalized || normalized === "free") return "免费";
  if (normalized === "paid") return "付费";
  if (normalized === "force_paid") return "强制付费";
  return normalized;
}

/** request.json client 字段的宽松占位值为 "unknown"，视为缺失不展示。 */
function isKnownClientValue(value?: string): boolean {
  const text = (value || "").trim();
  return Boolean(text) && text !== "unknown";
}

function formatClientBuildTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function renderTextWithLinks(value: string): string {
  const escaped = escapeHtml(value);
  return escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline break-all">${url}</a>`,
  );
}

export function ResourceDetailTab({ resources }: { resources: PrResourcePreview[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const safeActiveIdx = Math.min(activeIdx, Math.max(0, resources.length - 1));
  const resource = resources[safeActiveIdx];

  if (!resource) {
    return <p className="text-sm text-white/45">没有从目录 diff 中识别到资源条目。</p>;
  }

  if (resources.length === 1) {
    return <ResourceDetailView resource={resource} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {resources.map((r, i) => (
          <button
            type="button"
            key={r.entry.id}
            onClick={() => setActiveIdx(i)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              i === safeActiveIdx
                ? "bg-white/15 text-white"
                : "bg-white/[0.04] text-white/55 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            {r.manifest?.item?.name || r.entry.name || r.entry.id}
          </button>
        ))}
      </div>
      <ResourceDetailView key={resource.entry.id} resource={resource} />
    </div>
  );
}

// --- Full Resource Detail View ---

function ResourceDetailView({ resource }: { resource: PrResourcePreview }) {
  const navigate = useNavigate();
  const manifest = resource.manifest;
  const manifestItem = manifest?.item;
  const entry = resource.entry;

  const links = useMemo(() => {
    const raw = manifest?.links;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (l): l is { title: string; url: string; icon?: string } => Boolean(l?.title || l?.url),
    );
  }, [manifest?.links]);

  const authors = useMemo(() => {
    const raw = manifest?.item?.author;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (a): a is { name: string; bindABAccount?: boolean } => Boolean(a?.name),
    );
  }, [manifest?.item?.author]);

  const accountState = useAccountState();
  const boundAuthorNames = useMemo(
    () => authors.filter((a) => a.bindABAccount).map((a) => a.name),
    [authors],
  );
  const authorProStatuses = useAuthorsProStatuses(
    boundAuthorNames,
    accountState.astrobox?.token,
  );

  const paidRatioStatus = usePaidRatioStatus({
    boundAuthorNames,
    authorProStatuses,
    astroboxToken: accountState.astrobox?.token,
    githubToken: accountState.github?.token,
    paidType: entry.paid_type,
    resourceId: manifestItem?.id || entry.id,
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Manifest Error Banner */}
      {resource.manifestError && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          manifest 读取失败：{resource.manifestError}
        </div>
      )}

      {/* Resource Info Grid (2 columns) */}
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoCell label="资源仓库">
          <a
            href={`https://github.com/${entry.repo_owner}/${entry.repo_name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-300 hover:underline"
          >
            {entry.repo_owner}/{entry.repo_name}
          </a>
        </InfoCell>
        <InfoCell label="资源分支">
          <a
            href={`https://github.com/${entry.repo_owner}/${entry.repo_name}/tree/${resource.ref}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-blue-300 hover:underline"
          >
            {resource.ref || "-"}
          </a>
        </InfoCell>
      </div>

      {/* Resource Info + Devices (2 columns on xl) */}
      <div className="grid gap-3 xl:grid-cols-2">
        {/* Resource Info Section */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-2 text-xs font-semibold text-white/55">资源信息</div>
          <div className="space-y-2">
            <InfoRow label="资源名称" value={manifestItem?.name || entry.name || "-"} />
            <InfoRow label="资源 ID" value={manifestItem?.id || entry.id || "-"} />
            <InfoRow label="资源类型" value={formatResourceType(manifestItem?.restype || entry.restype)} />
            <InfoRow label="资源描述" value={manifestItem?.description || "-"} />
            <InfoRow label="付费类型" value={formatPaidType(entry.paid_type)} />
            {paidRatioStatus.state === "non-compliant" && (
              <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                {paidRatioStatus.authors.map((a) => (
                  <div key={a.name}>
                    {a.name}：免费 {a.freeCount} / 付费 {a.paidCount} - {a.reason}
                  </div>
                ))}
              </div>
            )}
            {paidRatioStatus.state === "error" && (
              <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/70">
                比例检查失败：{paidRatioStatus.message}
              </div>
            )}
            <InfoRow
              label="AstroBoxCreator 加密功能"
              value={manifest?.ext?.enableAstroBoxCreatorFeatures ? "开启" : "关闭"}
            />

            {/* Tags */}
            <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-xs text-white/55">标签</span>
              {entry.tags ? (
                <div className="flex flex-wrap gap-1.5">
                  {entry.tags.split(";").map((t) => t.trim()).filter(Boolean).map((tag, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-white/80"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-white/45">未设置标签</span>
              )}
            </div>

            {/* Authors */}
            <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-xs text-white/55">作者</span>
              <div className="flex flex-col gap-1">
                {authors.length > 0 ? (
                  authors.map((author, i) => {
                    const status = author.bindABAccount
                      ? authorProStatuses[author.name] ?? { state: "loading" as const }
                      : null;
                    const user = status?.state === "found" ? status.user : null;
                    const canOpen = Boolean(user?.userId);
                    const avatar = user?.avatar || "";
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
                      >
                        {canOpen ? (
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/admin/accounts?userId=${encodeURIComponent(user!.userId)}`,
                              )
                            }
                            title="查看 AstroBox 账户详情"
                            className="group flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            {avatar ? (
                              <img
                                src={avatar}
                                alt=""
                                className="h-7 w-7 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs text-white/50">
                                {author.name.slice(0, 1)}
                              </span>
                            )}
                            <span className="min-w-0 break-all text-white transition group-hover:text-blue-300 group-hover:underline">
                              {author.name}
                            </span>
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 break-all text-white">
                            {author.name}
                          </span>
                        )}
                        {status ? (
                          <ProBadge status={status} />
                        ) : (
                          <span className="ml-auto shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/45">
                            未绑定
                          </span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <span className="text-xs text-white/45">未填写作者</span>
                )}
              </div>
            </div>

            {/* Links */}
            {links.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="text-xs text-white/55">链接</span>
                <div className="flex flex-col gap-1">
                  {links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 hover:bg-white/10 transition"
                    >
                      <AstroboxLinkIcon icon={link.icon} size={16} />
                      <span className="min-w-0 break-all text-white">{link.title || link.url}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* 提交客户端信息（request.json client，缺失时不展示） */}
            {(() => {
              const client = resource.request?.client;
              if (!client) return null;
              const version = isKnownClientValue(client.version) ? client.version.trim() : "";
              const commit = isKnownClientValue(client.git_commit_hash) ? client.git_commit_hash.trim() : "";
              const buildTime = isKnownClientValue(client.build_time) ? formatClientBuildTime(client.build_time) : "";
              const builder = isKnownClientValue(client.build_user) ? client.build_user.trim() : "";
              if (!version && !buildTime && !builder) return null;
              return (
                <>
                  {version ? (
                    <InfoRow
                      label="提交客户端版本"
                      value={commit ? `${version}（${commit}）` : version}
                    />
                  ) : null}
                  {buildTime ? (
                    <InfoRow label="客户端构建时间" value={buildTime} />
                  ) : null}
                  {builder ? (
                    <InfoRow label="客户端构建者" value={builder} />
                  ) : null}
                </>
              );
            })()}
          </div>
        </div>

        <ResourceDownloadsSection resource={resource} />
      </div>

      <ResourceImagesSection resource={resource} />

    </div>
  );
}

// --- Sub-components ---

function InfoCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="text-xs text-white/55">{label}</span>
      <p className="mt-0.5 break-all text-sm font-medium text-white">{children}</p>
    </div>
  );
}

function InfoRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  const isUrl = value ? hasUrl(value) : false;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 md:flex-row md:items-start md:justify-between">
      <span className="text-xs text-white/55">{label}</span>
      {children ? (
        <div className="min-w-0 flex-1">{children}</div>
      ) : isUrl ? (
        <span
          className="min-w-0 break-all text-sm font-medium text-white"
          dangerouslySetInnerHTML={{ __html: renderTextWithLinks(value!) }}
        />
      ) : (
        <span className="min-w-0 break-all text-sm font-medium text-white">{value}</span>
      )}
    </div>
  );
}

/** 作者开启绑定 AstroBox 后，通过后端 /admin/users 按名称查询得到的真实权益徽章。 */
function ProBadge({ status }: { status: AuthorProStatus }) {
  const base =
    "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px]";
  switch (status.state) {
    case "loading":
      return <span className={`${base} border-white/10 bg-white/5 text-white/45`}>查询中…</span>;
    case "no-auth":
      return <span className={`${base} border-white/10 bg-white/5 text-white/45`}>未登录 AstroBox</span>;
    case "not-found":
      return <span className={`${base} border-red-400/30 bg-red-500/10 text-red-300`}>名称未匹配账户</span>;
    case "error":
      return <span className={`${base} border-red-400/30 bg-red-500/10 text-red-300`}>查询失败</span>;
    case "found": {
      const { user } = status;
      const active = isVipActive(user.vip, user.vipExpireMap);
      const pro = hasCreatorPro(user.vip) && active;
      if (pro) {
        return (
          <span className={`${base} border-emerald-500/40 bg-emerald-500/15 text-emerald-300`}>
            有 {vipTierLabel(user.vip)} 权益
          </span>
        );
      }
      const expired = !active && user.vip !== "None";
      return (
        <span className={`${base} border-white/10 bg-white/5 text-white/45`}>
          {vipTierLabel(user.vip)}
          {expired ? "（已过期）" : ""}
        </span>
      );
    }
  }
}
