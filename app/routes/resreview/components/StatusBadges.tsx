import { Clock, X, Check } from "@phosphor-icons/react";
import { type ReviewState, STATE_LABELS } from "../types";

export function PrStatusBadge({ state }: { state: "open" | "closed" | "merged" }) {
  const config = {
    open: { label: "Open", color: "bg-[#1f883d]" },
    closed: { label: "Closed", color: "bg-[#cf222e]" },
    merged: { label: "Merged", color: "bg-[#8957e5]" },
  }[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white ${config.color}`}>
      <PrStatusIcon state={state} />
      {config.label}
    </span>
  );
}

function PrStatusIcon({ state }: { state: "open" | "closed" | "merged" }) {
  if (state === "merged") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-white">
        <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z" fill="currentColor" />
      </svg>
    );
  }
  if (state === "closed") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-white">
        <path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-white">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" fill="currentColor" />
    </svg>
  );
}

export function ReviewStatusBadge({ state }: { state: ReviewState }) {
  if (state === "changes_requested") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-100">
        <X size={12} weight="bold" />
        需修复
      </span>
    );
  }
  if (state === "fixed_waiting") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-100">
        <Check size={12} weight="bold" />
        已修复
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/65">
      <Clock size={12} weight="fill" />
      等待审核
    </span>
  );
}

export function ReviewStatusBadgeMini({ state }: { state: ReviewState }) {
  if (state === "changes_requested") {
    return <span className="shrink-0 text-[11px] text-amber-100/80">需修复</span>;
  }
  if (state === "fixed_waiting") {
    return <span className="shrink-0 text-[11px] text-blue-100/80">已修复</span>;
  }
  return <span className="shrink-0 text-[11px] text-white/50">待审核</span>;
}

export function StatusBadge({ state }: { state: ReviewState }) {
  const className =
    state === "changes_requested"
      ? "bg-amber-500/15 text-amber-100"
      : state === "fixed_waiting"
        ? "bg-blue-500/15 text-blue-100"
        : "bg-white/10 text-white/65";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${className}`}>
      {STATE_LABELS[state]}
    </span>
  );
}
