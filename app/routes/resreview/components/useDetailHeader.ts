import { useCallback, useRef, useState } from "react";

export function useDetailHeader() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const onScroll = useCallback(() => {
    const container = scrollRef.current;
    const panel = panelRef.current;
    if (!container || !panel) return;

    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    const panelTop = panelRect.top - containerRect.top;
    const distance = panelRect.height;
    const progress = Math.min(Math.max(-panelTop / distance, 0), 1);

    setScrollProgress(progress);
  }, []);

  return { scrollProgress, scrollRef, panelRef, onScroll };
}
