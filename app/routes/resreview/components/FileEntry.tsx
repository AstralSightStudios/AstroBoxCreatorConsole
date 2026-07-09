import { openUrl } from "@tauri-apps/plugin-opener";
import type { GithubPullFile } from "~/api/github/pr-review";
import { isImagePath, isVideoPath } from "../utils";
import { ProxiedImage, ProxiedVideo } from "./ProxiedMedia";

export function FileEntry({ file }: { file: GithubPullFile }) {
  const showImage = isImagePath(file.filename) && file.raw_url;
  const showVideo = isVideoPath(file.filename) && file.raw_url;

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 break-all font-mono-sarasa text-white">{file.filename}</span>
        <span className="text-emerald-300">+{file.additions}</span>
        <span className="text-red-300">-{file.deletions}</span>
        {file.blob_url && (
          <button
            className="ml-auto text-xs text-blue-200 underline"
            onClick={() => openUrl(file.blob_url!).catch(() => window.open(file.blob_url, "_blank", "noopener,noreferrer"))}
          >
            查看文件
          </button>
        )}
      </div>
      {showImage && <ProxiedImage rawUrl={file.raw_url!} filename={file.filename} />}
      {showVideo && <ProxiedVideo rawUrl={file.raw_url!} />}
      {!showImage && !showVideo && file.patch && <DiffBlock patch={file.patch} />}
    </div>
  );
}

export function DiffBlock({ patch }: { patch: string }) {
  return (
    <div className="mt-2 max-h-96 max-w-full overflow-auto rounded border border-white/10 bg-black/30">
      <pre className="w-max min-w-full whitespace-pre py-2 font-mono-sarasa text-xs leading-5 text-white/65">
        {patch.split(/\r?\n/).map((line, index) => {
          const tone =
            line.startsWith("+") && !line.startsWith("+++")
              ? "bg-emerald-500/12 text-emerald-100"
              : line.startsWith("-") && !line.startsWith("---")
                ? "bg-red-500/12 text-red-100"
                : line.startsWith("@@")
                  ? "bg-blue-500/15 text-blue-100"
                  : "text-white/55";
          return (
            <div key={`${index}-${line.slice(0, 12)}`} className={`px-3 ${tone}`}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
