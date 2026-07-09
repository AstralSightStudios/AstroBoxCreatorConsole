import { Button } from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PrResourcePreview, ResourcePackagePreview } from "../types";
import { openAllPackages } from "../utils";
import { ProxiedImage } from "./ProxiedMedia";

export function ResourcePreviewList({ resources }: { resources: PrResourcePreview[] }) {
  if (resources.length === 0) {
    return <p className="text-sm text-white/45">没有从目录 diff 中识别到资源条目。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {resources.map((resource) => (
        <ResourcePreviewCard key={`${resource.entry.id}-${resource.ref}`} resource={resource} />
      ))}
    </div>
  );
}

function ResourcePreviewCard({ resource }: { resource: PrResourcePreview }) {
  const manifestItem = resource.manifest?.item;
  const title = manifestItem?.name || resource.entry.name || resource.entry.id;
  const description = manifestItem?.description || "";
  const allPackages = resource.packages.filter((item) => item.url);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <div className="grid gap-3 p-3 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="min-w-0">
          {resource.coverUrl ? (
            <ProxiedImage
              rawUrl={resource.coverUrl}
              filename={`${title} cover`}
              className="mt-0 aspect-[4/3] w-full max-w-none object-cover"
            />
          ) : (
            <div className="grid aspect-[4/3] place-items-center rounded border border-white/10 bg-white/[0.04] text-xs text-white/35">
              无封面
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-3">
            {resource.iconUrl && (
              <ProxiedImage
                rawUrl={resource.iconUrl}
                filename={`${title} icon`}
                className="mt-0 h-14 w-14 shrink-0 rounded-xl object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-base font-semibold text-white">{title}</h4>
              <p className="mt-1 break-all font-mono-sarasa text-xs text-white/55">
                {manifestItem?.id || resource.entry.id}
              </p>
              <p className="mt-1 text-xs text-white/45">
                {resource.entry.restype} · {resource.entry.paid_type || "free"} ·{" "}
                {resource.entry.repo_owner}/{resource.entry.repo_name}@{resource.ref.slice(0, 7)}
              </p>
            </div>
            {allPackages.length > 0 && (
              <Button
                size="1"
                variant="soft"
                onClick={() => void openAllPackages(allPackages)}
              >
                下载全部包体
              </Button>
            )}
          </div>

          {description && (
            <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-white/70">
              {description}
            </p>
          )}

          {resource.manifestError && (
            <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              manifest 读取失败：{resource.manifestError}
            </p>
          )}

          {resource.previewUrls.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {resource.previewUrls.map((url, index) => (
                <ProxiedImage
                  key={url}
                  rawUrl={url}
                  filename={`${title} preview ${index + 1}`}
                  className="mt-0 h-24 w-36 shrink-0 object-cover"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {resource.packages.length > 0 && (
        <div className="border-t border-white/10 p-3">
          <div className="grid gap-2 md:grid-cols-2">
            {resource.packages.map((pkg) => (
              <PackageRow key={`${pkg.kind}-${pkg.deviceId}-${pkg.fileName}`} pkg={pkg} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PackageRow({ pkg }: { pkg: ResourcePackagePreview }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs">
      <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/65">
        {pkg.kind}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono-sarasa text-white/80">{pkg.deviceId}</p>
        <p className="truncate font-mono-sarasa text-white/45">
          {pkg.version || "--"} · {pkg.fileName}
        </p>
      </div>
      <Button size="1" variant="soft" onClick={() => openUrl(pkg.url).catch(() => window.open(pkg.url, "_blank", "noopener,noreferrer"))}>
        下载
      </Button>
    </div>
  );
}
