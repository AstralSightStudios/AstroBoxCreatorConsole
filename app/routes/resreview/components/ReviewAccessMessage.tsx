import { LoadingIndicator } from "./LoadingIndicator";

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
      <LoadingIndicator
        text="正在加载审核列表"
        hint="正在从 GitHub 拉取 PR 与审核状态，请稍候"
      />
    </div>
  );
}
