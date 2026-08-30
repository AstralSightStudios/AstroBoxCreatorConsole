import { Spinner } from "@radix-ui/themes";

export function ReviewAccessMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-lg rounded-[14px] border border-white/10 bg-nav-item p-6 text-center">
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-white/60">{text}</p>
      </div>
    </div>
  );
}

export function PRReviewPageSkeleton() {
  return (
    <div className="grid h-full w-full place-items-center px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Spinner size="3" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-white/70">
            正在加载审核列表
          </p>
          <p className="text-xs text-white/45">
            正在从 GitHub 拉取 PR 与审核状态，请稍候
          </p>
        </div>
      </div>
    </div>
  );
}
