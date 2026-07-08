import { useProxiedMediaUrl } from "~/logic/media-proxy";

export function ProxiedImage({
  rawUrl,
  filename,
  className = "mt-2 max-h-80 max-w-full object-contain",
}: {
  rawUrl: string;
  filename: string;
  className?: string;
}) {
  const url = useProxiedMediaUrl(rawUrl);
  return (
    <img
      src={url}
      alt={filename}
      className={`rounded border border-white/10 ${className}`}
    />
  );
}

export function ProxiedVideo({ rawUrl }: { rawUrl: string }) {
  const url = useProxiedMediaUrl(rawUrl);
  return (
    <video
      controls
      src={url}
      className="mt-2 max-h-80 max-w-full rounded border border-white/10"
    />
  );
}
