import { useEffect, useMemo, useState, useCallback } from "react";
import { Check, X, Warning, ArrowsClockwise, Spinner } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useAccountState } from "~/logic/account/store";
import type { GithubPullFile } from "~/api/github/pr-review";
import type { PrResourcePreview, RuleCheckItem } from "../types";
import {
  runResourceRuleChecks,
  formatBytes,
  type ResourceRuleCheckResult,
  type PackageCheckResult,
} from "../rule-checks";
import type { PaidRatioResult } from "../utils/paid-ratio";

interface RuleCheckPanelProps {
  resources: PrResourcePreview[];
  prFiles: GithubPullFile[];
}

interface CheckState {
  loading: boolean;
  result?: ResourceRuleCheckResult;
  error?: string;
}

function useResourceRuleChecks(
  resource: PrResourcePreview | undefined,
  prFiles: GithubPullFile[],
  token: string,
  astroboxToken: string | undefined,
  reloadTick: number,
): CheckState {
  const [state, setState] = useState<CheckState>({ loading: Boolean(resource) });

  useEffect(() => {
    if (!resource) {
      setState({ loading: false });
      return;
    }
    if (!token) {
      setState({ loading: false, error: "未登录 GitHub" });
      return;
    }

    let cancelled = false;
    setState({ loading: true });
    runResourceRuleChecks({ preview: resource, prFiles, token, astroboxToken })
      .then((result) => {
        if (!cancelled) setState({ loading: false, result });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resource, prFiles, token, astroboxToken, reloadTick]);

  return state;
}

const STATUS_META: Record<
  RuleCheckItem["status"],
  { icon: typeof Check; color: string; label: string }
> = {
  pass: { icon: Check, color: "text-emerald-400", label: "通过" },
  fail: { icon: X, color: "text-red-400", label: "失败" },
  warn: { icon: Warning, color: "text-amber-400", label: "警告" },
  manual: { icon: Spinner, color: "text-white/45", label: "人工" },
};

export function RuleCheckPanel({ resources, prFiles }: RuleCheckPanelProps) {
  const accountState = useAccountState();
  const token = accountState.github?.token || "";
  const astroboxToken = accountState.astrobox?.token;
  const [activeIdx, setActiveIdx] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  const safeActiveIdx = Math.min(activeIdx, Math.max(0, resources.length - 1));
  const resource = resources[safeActiveIdx];
  const { loading, result, error } = useResourceRuleChecks(
    resource,
    prFiles,
    token,
    astroboxToken,
    reloadTick,
  );

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  if (resources.length === 0) {
    return <p className="text-sm text-white/45">没有从目录 diff 中识别到资源条目。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {resources.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {resources.map((r, i) => (
            <button
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
      )}

      {loading && !result && (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/55">
          <Spinner size={16} className="animate-spin" />
          正在执行自动检查（拉取仓库文件树、图片体积、包体内容…）...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          检查失败：{error}
        </div>
      )}

      {result && resource && (
        <RuleCheckResultView
          key={resource.entry.id + reloadTick}
          result={result}
          loading={loading}
          onReload={reload}
        />
      )}
    </div>
  );
}

function RuleCheckResultView({
  result,
  loading,
  onReload,
}: {
  result: ResourceRuleCheckResult;
  loading: boolean;
  onReload: () => void;
}) {
  const { checks, packageChecks, imageSizes, repoTruncated, paidRatioChecks } = result;

  const counts = useMemo(() => {
    const c = { pass: 0, fail: 0, warn: 0, manual: 0 };
    for (const ch of checks) c[ch.status] += 1;
    return c;
  }, [checks]);

  const hasFail = counts.fail > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <Check size={14} weight="bold" /> 通过 {counts.pass}
          </span>
          <span className="inline-flex items-center gap-1 text-red-400">
            <X size={14} weight="bold" /> 失败 {counts.fail}
          </span>
          <span className="inline-flex items-center gap-1 text-amber-400">
            <Warning size={14} weight="bold" /> 警告 {counts.warn}
          </span>
        </div>
        {repoTruncated && (
          <span className="text-xs text-amber-300/80">
            仓库文件过多，文件树被截断，部分文件存在性/体积可能不准
          </span>
        )}
        <button
          onClick={onReload}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 disabled:opacity-50 transition"
        >
          <ArrowsClockwise size={12} />
          {loading ? "检查中..." : "重新检查"}
        </button>
      </div>

      {hasFail && (
        <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          存在 {counts.fail} 项未通过检查，建议要求创作者修改后再合并。
        </div>
      )}

      {/* 检查清单 */}
      <div className="flex flex-col gap-1.5">
        {checks.map((check, i) => (
          <CheckRow key={i} check={check} />
        ))}
      </div>

      {/* 包体校验详情 */}
      {packageChecks.length > 0 && (
        <PackageChecksBlock packageChecks={packageChecks} />
      )}

      {/* 付费/免费比例详情 */}
      {paidRatioChecks && paidRatioChecks.length > 0 && (
        <PaidRatioBlock results={paidRatioChecks} />
      )}

      {/* 图片体积 */}
      {imageSizes.length > 0 && <ImageSizesBlock imageSizes={imageSizes} />}
    </motion.div>
  );
}

function CheckRow({ check }: { check: RuleCheckItem }) {
  const meta = STATUS_META[check.status];
  const Icon = meta.icon;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <Icon
        size={16}
        weight="bold"
        className={`mt-0.5 shrink-0 ${meta.color} ${check.status === "manual" ? "animate-spin" : ""}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white">{check.title}</div>
        <div className="mt-0.5 break-words text-xs text-white/55">{check.detail}</div>
      </div>
    </div>
  );
}

function PackageChecksBlock({ packageChecks }: { packageChecks: PackageCheckResult[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 text-xs font-semibold text-white/55">包体内容校验</div>
      <div className="flex flex-col gap-2">
        {packageChecks.map((pkg, i) => (
          <PackageCheckRow key={i} pkg={pkg} />
        ))}
      </div>
    </div>
  );
}

function PackageCheckRow({ pkg }: { pkg: PackageCheckResult }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="break-all font-medium text-white">{pkg.fileName}</span>
        <span className="text-white/45">{formatBytes(pkg.sizeBytes)}</span>
        <span className="text-white/45">
          {pkg.kind} · 设备：{pkg.devices.join(" / ") || "-"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-white/60">
        <span>
          类型：
          <MatchBadge ok={pkg.typeMatch === "match"} warn={pkg.typeMatch === "inconclusive"} />
          <span className="ml-1 text-white/45">
            {pkg.detectedType}（{pkg.effectiveCategory === "watchface" ? "表盘" : pkg.effectiveCategory === "quick_app" ? "快应用" : "其他"}）
          </span>
        </span>
        <span>
          内嵌 ID：
          <MatchBadge
            ok={pkg.idMatch === "match"}
            warn={pkg.idMatch === "skipped"}
            fail={pkg.idMatch === "mismatch"}
          />
          {pkg.detectedId && <span className="ml-1 text-white/45">检测到 {pkg.detectedId}</span>}
        </span>
        {pkg.skipped && <span className="text-amber-300/80">包体过大/疑似加密，已跳过内容校验</span>}
        {pkg.error && <span className="text-red-400">[错误：{pkg.error}]</span>}
      </div>
    </div>
  );
}

function MatchBadge({
  ok,
  warn,
  fail,
}: {
  ok?: boolean;
  warn?: boolean;
  fail?: boolean;
}) {
  if (ok) return <span className="ml-1 text-emerald-400">匹配</span>;
  if (fail) return <span className="ml-1 text-red-400">不匹配</span>;
  if (warn) return <span className="ml-1 text-amber-400">跳过</span>;
  return <span className="ml-1 text-white/45">未知</span>;
}

function ImageSizesBlock({
  imageSizes,
}: {
  imageSizes: Array<{
    label: string;
    path: string;
    url: string;
    sizeBytes?: number;
    overLimit?: "warn" | "fail";
    width?: number;
    height?: number;
    ratio?: number;
    ratioValid?: boolean;
  }>;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 text-xs font-semibold text-white/55">图片体积与宽高比</div>
      <div className="flex flex-col gap-1">
        {imageSizes.map((img, i) => (
          <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-white/70">{img.label}</span>
            <span className="break-all text-white/45">{img.path || img.url.split("/").pop()}</span>
            <span
              className={
                img.overLimit === "fail"
                  ? "font-semibold text-red-400"
                  : img.overLimit === "warn"
                    ? "font-semibold text-amber-400"
                    : "text-white/70"
              }
            >
              {formatBytes(img.sizeBytes)}
            </span>
            {img.overLimit === "fail" && <span className="text-red-400">过大</span>}
            {img.overLimit === "warn" && <span className="text-amber-400">偏大</span>}
            {img.sizeBytes == null && <span className="text-white/35">未取到体积</span>}
            {(img.label === "icon" || img.label === "cover") && (
              <span
                className={
                  img.ratioValid === false
                    ? "font-semibold text-red-400"
                    : img.width == null
                      ? "text-white/35"
                      : "text-white/70"
                }
              >
                像素 {img.width ? `${img.width}×${img.height}` : "-"}
                {img.ratio != null ? ` · 比例 ${img.ratio.toFixed(2)}` : ""}
                {img.ratioValid === false && `（应为 ${img.label === "icon" ? "1:1" : "3:2"}）`}
                {img.width == null && " · 未取到尺寸"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PaidRatioBlock({ results }: { results: PaidRatioResult[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 text-xs font-semibold text-white/55">
        作者已发布资源及付费/免费比例
      </div>
      <div className="flex flex-col gap-3">
        {results.map((r, i) => (
          <PaidRatioAuthorRow key={i} result={r} />
        ))}
      </div>
    </div>
  );
}

function PaidRatioAuthorRow({ result }: { result: PaidRatioResult }) {
  const ratio = result.ratio;
  const compliant = ratio?.compliant;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-white">{result.authorName}</span>
        {result.hasPro ? (
          <span className="text-emerald-400">Creator Pro，不受比例限制</span>
        ) : ratio ? (
          <>
            <span className="text-white/60">
              免费 {ratio.freeCount} / 付费 {ratio.paidCount}
            </span>
            <span
              className={
                compliant ? "text-emerald-400" : "text-amber-400 font-semibold"
              }
            >
              {compliant ? "合规" : "不合规"}
            </span>
          </>
        ) : (
          <span className="text-white/45">
            {result.error || "无法判断"}
          </span>
        )}
      </div>
      {!compliant && ratio && (
        <div className="mt-1 text-xs text-amber-300/80">{ratio.reason}</div>
      )}
      {result.resources.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {result.resources.map((res, j) => (
            <div key={j} className="flex items-center gap-2 text-xs">
              <span
                className={
                  res.paidKind === "paid"
                    ? "text-amber-400"
                    : "text-emerald-400"
                }
              >
                {res.paidKind === "paid" ? "付费" : "免费"}
              </span>
              <span className="text-white/70">{res.name}</span>
              <span className="text-white/35">{res.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
