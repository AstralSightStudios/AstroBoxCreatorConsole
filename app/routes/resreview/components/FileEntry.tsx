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
            className="ml-auto text-white/40 hover:text-blue-300 transition"
            onClick={() => openUrl(file.blob_url!).catch(() => window.open(file.blob_url, "_blank", "noopener,noreferrer"))}
            title="View this file"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: 'text-bottom' }}>
              <path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.824-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.824.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"></path>
            </svg>
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
