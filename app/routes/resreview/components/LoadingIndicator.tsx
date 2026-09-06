import { CircleNotch } from "@phosphor-icons/react";

/**
 * PR 审核统一的加载态：icon 与文字上下排列，无容器装饰。
 * className 用于按场景微调内边距（默认 py-10）。
 */
export function LoadingIndicator({
  text = "加载中",
  hint,
  className = "py-10",
}: {
  text?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-sm text-white/50 ${className}`}
    >
      <CircleNotch size={22} className="animate-spin" />
      <span>{text}</span>
      {hint ? <span className="text-xs text-white/40">{hint}</span> : null}
    </div>
  );
}
