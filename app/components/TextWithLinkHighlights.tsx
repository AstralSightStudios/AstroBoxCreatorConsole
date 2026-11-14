import { useMemo } from "react";
import {
  splitTextByLinks,
  textLinkHref,
} from "~/logic/publish/description-links";

/**
 * 把文本中的链接渲染成琥珀色高亮。
 *
 * 资源简介夹带外链会被审核自动检查标记为警告；这里在展示层把链接直接标出来，
 * 避免审核员在长简介里逐字查找。只有 http/https/ftp/mailto 会变成可点击链接，
 * 其他协议只高亮不跳转。
 */
export function TextWithLinkHighlights({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const segments = useMemo(() => splitTextByLinks(text), [text]);
  const linkClass =
    "rounded bg-amber-500/20 px-0.5 text-amber-200 underline decoration-amber-400/60 underline-offset-2 hover:bg-amber-500/30";
  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (!segment.link) return <span key={index}>{segment.text}</span>;
        const href = textLinkHref(segment.text);
        return href ? (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} break-all`}
          >
            {segment.text}
          </a>
        ) : (
          <span key={index} className={linkClass}>
            {segment.text}
          </span>
        );
      })}
    </span>
  );
}
