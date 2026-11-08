import { XIcon } from "@phosphor-icons/react";
import FloatingDrawer from "~/components/drawer/FloatingDrawer";
import { Button } from "~/components/ScaleAwareThemes";
import type { ReviewState } from "~/logic/publish/review-status";
import type { ReviewSource } from "../source";

const STATE_OPTIONS: Array<{ value: ReviewState | "all"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "waiting_review", label: "等待审核" },
  { value: "changes_requested", label: "需要修改" },
  { value: "fixed_waiting", label: "已修复待复核" },
];

interface FilterOptionProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterOption({ active, onClick, children }: FilterOptionProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white/15 text-white"
          : "bg-white/[0.04] text-white/55 hover:bg-white/10 hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}

interface ReviewFilterDrawerProps {
  open: boolean;
  onClose: () => void;
  stateFilter: ReviewState | "all";
  sourceFilter: ReviewSource | "all";
  canReviewResource: boolean;
  canReviewPlugin: boolean;
  onStateFilterChange: (value: ReviewState | "all") => void;
  onSourceFilterChange: (value: ReviewSource | "all") => void;
}

/** 审核列表筛选抽屉：状态与来源都即时生效，关闭后保留。 */
export default function ReviewFilterDrawer({
  open,
  onClose,
  stateFilter,
  sourceFilter,
  canReviewResource,
  canReviewPlugin,
  onStateFilterChange,
  onSourceFilterChange,
}: ReviewFilterDrawerProps) {
  const sourceOptions: Array<{ value: ReviewSource | "all"; label: string }> = [
    { value: "all", label: "全部来源" },
    ...(canReviewResource
      ? [{ value: "resource" as const, label: "资源 PR" }]
      : []),
    ...(canReviewPlugin
      ? [{ value: "plugin" as const, label: "插件 PR" }]
      : []),
  ];

  const reset = () => {
    onStateFilterChange("all");
    onSourceFilterChange("all");
  };

  return (
    <FloatingDrawer
      open={open}
      onClose={onClose}
      title="筛选"
      description="按审核状态与 PR 来源筛选审核列表"
      sideOnDesktop
      handleLabel="收起筛选"
    >
      <header className="flex items-center justify-between gap-3 px-5.5 pt-1.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-[700] leading-none text-[color:var(--text-color)]">
            筛选
          </h1>
          <p className="mt-1 truncate text-[12px] text-white/50">
            按审核状态与 PR 来源筛选
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭筛选"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[color:var(--text-color)] opacity-60 transition hover:bg-[var(--nav-btn-bg)] hover:opacity-100"
        >
          <XIcon size={18} />
        </button>
      </header>

      <div className="mt-4 flex-1 overflow-y-auto px-5.5 pb-5">
        <section>
          <h2 className="text-sm font-medium text-white/70">审核状态</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATE_OPTIONS.map((option) => (
              <FilterOption
                key={option.value}
                active={stateFilter === option.value}
                onClick={() => onStateFilterChange(option.value)}
              >
                {option.label}
              </FilterOption>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-sm font-medium text-white/70">来源</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {sourceOptions.map((option) => (
              <FilterOption
                key={option.value}
                active={sourceFilter === option.value}
                onClick={() => onSourceFilterChange(option.value)}
              >
                {option.label}
              </FilterOption>
            ))}
          </div>
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-white/10 px-5.5 py-3">
        <Button variant="soft" color="gray" onClick={reset}>
          重置
        </Button>
        <Button onClick={onClose}>完成</Button>
      </footer>
    </FloatingDrawer>
  );
}
