import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import InboxMessageCard from "./InboxMessageCard";
import { appleStackTransition, collapsedTranslateYMap } from "./styles";
import type { InboxMessageActionHandlers, PendingAction } from "./types";
import type { InboxNotification } from "~/logic/inbox/types";

type InboxReadStackProps = InboxMessageActionHandlers & {
  messages: InboxNotification[];
  expanded: boolean;
  expandedId: string | null;
  pendingActions: Map<string, PendingAction>;
};

export default function InboxReadStack({
  messages,
  expanded,
  expandedId,
  pendingActions,
  onMarkRead,
  onDeleteMessage,
  onToggleMessage,
  onOpenResource,
}: InboxReadStackProps) {
  const cardGap = 8;
  const collapsedOffsetStep = 12;
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const measureFrameRef = useRef<number | null>(null);
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const normalizeHeight = (height: number) => Math.round(height);

    const measureHeights = () => {
      measureFrameRef.current = null;
      setCardHeights((current) => {
        let changed = false;
        const next: Record<string, number> = {};

        for (const message of messages) {
          const height = normalizeHeight(
            cardRefs.current[message.id]?.getBoundingClientRect().height ?? 0,
          );
          next[message.id] = height;
          if (current[message.id] !== height) {
            changed = true;
          }
        }

        if (
          !changed &&
          Object.keys(current).length === Object.keys(next).length
        ) {
          return current;
        }
        return next;
      });
    };

    const scheduleMeasure = () => {
      if (measureFrameRef.current !== null || typeof window === "undefined") {
        return;
      }
      measureFrameRef.current = window.requestAnimationFrame(measureHeights);
    };

    scheduleMeasure();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (measureFrameRef.current !== null && typeof window !== "undefined") {
          window.cancelAnimationFrame(measureFrameRef.current);
        }
      };
    }

    const observer = new ResizeObserver(scheduleMeasure);

    for (const message of messages) {
      const node = cardRefs.current[message.id];
      if (node) {
        node.dataset.inboxMessageId = message.id;
        observer.observe(node);
      }
    }

    return () => {
      if (measureFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = null;
      }
      observer.disconnect();
    };
  }, [messages]);

  const { expandedHeight, expandedPositions, collapsedHeight } = useMemo(() => {
    const firstHeight = messages[0] ? (cardHeights[messages[0].id] ?? 0) : 0;
    const fallbackHeight = firstHeight || 92;
    const nextExpandedPositions: number[] = [];
    let nextExpandedHeight = 0;

    messages.forEach((message, index) => {
      const height = cardHeights[message.id] || fallbackHeight;
      nextExpandedPositions[index] = nextExpandedHeight;
      nextExpandedHeight += height;
      if (index < messages.length - 1) {
        nextExpandedHeight += cardGap;
      }
    });

    const nextCollapsedHeight = messages.reduce((maxHeight, message, index) => {
      const height = cardHeights[message.id] || fallbackHeight;
      const depth = Math.min(index, 2);
      const offset =
        collapsedTranslateYMap[depth] ?? depth * collapsedOffsetStep;
      return Math.max(maxHeight, offset + height);
    }, fallbackHeight);

    return {
      expandedHeight: nextExpandedHeight,
      expandedPositions: nextExpandedPositions,
      collapsedHeight: nextCollapsedHeight,
    };
  }, [cardGap, cardHeights, collapsedOffsetStep, messages]);

  return (
    <div
      className="relative overflow-visible"
      style={{
        height: expanded ? expandedHeight : collapsedHeight,
        contain: "layout",
        transition: `height ${appleStackTransition.duration}ms cubic-bezier(${appleStackTransition.ease.join(",")})`,
      }}
    >
      {messages.map((message, index) => {
        const depth = Math.min(index, 2);
        const expandedMessage = expandedId === message.id;
        const collapsedScale = depth === 0 ? 1 : depth === 1 ? 0.97 : 0.925;
        const collapsedTranslateY =
          collapsedTranslateYMap[depth] ?? depth * collapsedOffsetStep;
        const collapsedOpacity =
          depth === 0 ? 1 : depth === 1 ? 0.75 : index === 2 ? 0.5 : 0;
        const isBlurredStackCard = index === 0 && !expandedMessage;

        return (
          <motion.div
            key={message.id}
            initial={false}
            className={`absolute inset-x-0 top-0 origin-top ${
              isBlurredStackCard
                ? "overflow-hidden rounded-[14px] corner-rounded bg-[var(--inbox-stacked-card-bg)] backdrop-blur-md"
                : ""
            }`}
            style={{
              zIndex: expandedMessage
                ? 200
                : expanded
                  ? Math.max(1, messages.length - index)
                  : Math.max(1, 100 - index),
              pointerEvents: expanded ? "auto" : "none",
              ...(isBlurredStackCard
                ? {}
                : {
                    willChange: "transform, opacity",
                    backfaceVisibility: "hidden" as const,
                  }),
            }}
            animate={{
              y: expanded
                ? (expandedPositions[index] ?? 0)
                : collapsedTranslateY,
              scale: expanded ? 1 : collapsedScale,
              opacity: expanded ? 1 : collapsedOpacity,
            }}
            transition={appleStackTransition}
          >
            <div
              ref={(node) => {
                cardRefs.current[message.id] = node;
              }}
            >
              <InboxMessageCard
                message={message}
                expanded={expandedMessage}
                blurredBackground={index === 0}
                pendingAction={pendingActions.get(message.id)}
                onMarkRead={onMarkRead}
                onDeleteMessage={onDeleteMessage}
                onToggleMessage={onToggleMessage}
                onOpenResource={onOpenResource}
              />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
