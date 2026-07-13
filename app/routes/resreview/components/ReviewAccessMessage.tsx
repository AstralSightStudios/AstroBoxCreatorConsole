export function ReviewAccessMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-lg rounded-2xl border border-white/10 bg-nav-item p-6 text-center">
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-white/60">{text}</p>
      </div>
    </div>
  );
}

export function PRReviewPageSkeleton() {
  return (
    <div className="relative h-full overflow-hidden px-4 pt-5 pb-3 md:px-6">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col gap-4">
        {/* ---- header row (matches real list view header) ---- */}
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold text-white">PR审核</h1>
            <div className="mt-1 h-4 w-44 animate-pulse rounded bg-white/10" />
          </div>
          {/* skeleton for the filter + refresh action bar */}
          <div className="flex flex-row items-center justify-end gap-2">
            <div className="h-8 w-[135px] animate-pulse rounded-full bg-white/10" />
            <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
          </div>
        </div>

        {/* ---- scrollable grid (exact same wrapper as real list) ---- */}
        <section className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3 no-scrollbar">
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <PrCardSkeleton key={index} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PrCardSkeleton() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-white/10 bg-black/15 px-4 py-4">
      <div className="h-5 w-full animate-pulse rounded bg-white/10" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-white/10" />
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-5 w-16 animate-pulse rounded-full bg-white/10" />
        <div className="inline-flex items-center gap-2">
          <div className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-white/10" />
          <div className="h-3.5 w-20 animate-pulse rounded bg-white/10" />
          <div className="h-3.5 w-14 animate-pulse rounded bg-white/10" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="h-5 w-16 animate-pulse rounded-full bg-white/10" />
        <div className="h-3.5 w-10 animate-pulse rounded bg-white/10" />
      </div>
    </div>
  );
}