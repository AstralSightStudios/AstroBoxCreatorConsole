import { AnimatePresence, motion } from "framer-motion";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { useLocation } from "react-router";
import { useFrozenOutlet } from "./use-frozen-outlet";
import {
  ENTER_DURATION,
  ENTER_EASE,
  EXIT_DURATION,
  EXIT_EASE,
  getExitOffset,
  getInitialOffset,
  type TransitionAxis,
} from "./transition-config";
import Header from "~/components/header";
import { useNavItemPreferences } from "~/config/nav";
import {
  HeaderActionsProvider,
  useHeaderIdentity,
  useUpdateHeaderScroll,
} from "~/layout/header-actions";
import { findNavIndex, getSegments, normalizePath } from "~/layout/nav-config";

interface TransitionMeta {
  axis: TransitionAxis;
  direction: 1 | -1;
  reason: "hierarchy" | "nav" | "fallback";
}

const DEFAULT_TRANSITION: TransitionMeta = {
  axis: "x",
  direction: 1,
  reason: "fallback",
};

const HEADER_GRADIENT_REVEAL_DISTANCE = 56;

function isPrefixOf(base: string[], target: string[]) {
  if (base.length === 0) {
    return false;
  }
  if (base.length >= target.length) {
    return false;
  }

  return base.every((segment, index) => segment === target[index]);
}

function determineTransition(
  prevPath: string,
  nextPath: string,
  itemOrder: readonly string[] = [],
): TransitionMeta {
  if (!prevPath) {
    return DEFAULT_TRANSITION;
  }

  const prevSegments = getSegments(prevPath);
  const nextSegments = getSegments(nextPath);

  if (isPrefixOf(prevSegments, nextSegments)) {
    return {
      axis: "x",
      direction: 1,
      reason: "hierarchy",
    };
  }
  if (isPrefixOf(nextSegments, prevSegments)) {
    return {
      axis: "x",
      direction: -1,
      reason: "hierarchy",
    };
  }

  const prevNavIndex = findNavIndex(prevPath, itemOrder);
  const nextNavIndex = findNavIndex(nextPath, itemOrder);
  if (
    prevNavIndex !== null &&
    nextNavIndex !== null &&
    prevNavIndex !== nextNavIndex
  ) {
    return {
      axis: "y",
      direction: nextNavIndex > prevNavIndex ? 1 : -1,
      reason: "nav",
    };
  }

  return DEFAULT_TRANSITION;
}

export default function PageTransition() {
  return (
    <HeaderActionsProvider>
      <PageTransitionContent />
    </HeaderActionsProvider>
  );
}

function PageTransitionContent() {
  const location = useLocation();
  const frozenOutlet = useFrozenOutlet();
  const navItemPreferences = useNavItemPreferences();
  const headerIdentity = useHeaderIdentity();
  const updateHeaderScroll = useUpdateHeaderScroll();
  const [headerScrollProgress, setHeaderScrollProgress] = useState(0);

  const normalizedPath = normalizePath(location.pathname);
  const isAfdianMessagesPage = normalizedPath === "/afdian-messages";
  const isAfdianConversation =
    isAfdianMessagesPage &&
    Boolean(headerIdentity);
  const isAfdianMessagesList =
    isAfdianMessagesPage && !isAfdianConversation;
  const disableHeaderScrollEffect = isAfdianConversation;
  const transitionSnapshotRef = useRef<{
    path: string;
    meta: TransitionMeta;
  }>({
    path: normalizedPath,
    meta: DEFAULT_TRANSITION,
  });

  if (normalizedPath !== transitionSnapshotRef.current.path) {
    const previousPath = transitionSnapshotRef.current.path;
    const meta = determineTransition(
      previousPath,
      normalizedPath,
      navItemPreferences.itemOrder,
    );
    transitionSnapshotRef.current = {
      path: normalizedPath,
      meta,
    };
  }

  const { meta: transitionMeta, path: motionKey } =
    transitionSnapshotRef.current;
  const handlePageScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.hasAttribute("data-overlayscrollbars-viewport")) return;
      updateHeaderScroll(target.scrollTop);
      setHeaderScrollProgress(
        Math.min(1, Math.max(0, target.scrollTop / HEADER_GRADIENT_REVEAL_DISTANCE)),
      );
    },
    [updateHeaderScroll],
  );

  useEffect(() => {
    setHeaderScrollProgress(0);
  }, [normalizedPath]);

  return (
    <div
      className="relative h-full overflow-hidden select-none"
    >
      <div
        className={`app-page-content flex h-full flex-col gap-2 pt-[max(0.5rem,var(--ui-safe-area-top))] pl-[max(0.5rem,var(--ui-safe-area-left))] pr-[max(0.5rem,var(--ui-safe-area-right))] ${isAfdianMessagesList ? "app-page-content-afdian-list" : ""} ${isAfdianConversation ? "app-page-content-afdian-messages app-page-content-afdian-conversation" : ""}`}
      >
        <Header
          key={isAfdianConversation ? "afdian-conversation" : "default"}
          scrollProgress={headerScrollProgress}
          disableTitlebarEffect={disableHeaderScrollEffect}
          uniformBackgroundEffect={isAfdianConversation}
        />
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <AnimatePresence initial={false} mode="sync" custom={transitionMeta}>
            <motion.div
              key={motionKey}
              className="absolute inset-0 h-full w-full overflow-hidden"
              custom={transitionMeta}
              variants={{
                initial: (meta: TransitionMeta) => ({
                  x: meta.axis === "x" ? getInitialOffset(meta.axis, meta.direction) : 0,
                  y: meta.axis === "y" ? getInitialOffset(meta.axis, meta.direction) : 0,
                  opacity: 0,
                }),
                animate: {
                  x: 0,
                  y: 0,
                  opacity: 1,
                  transition: {
                    duration: ENTER_DURATION,
                    ease: ENTER_EASE,
                  },
                },
                exit: (meta: TransitionMeta) => ({
                  x: meta.axis === "x" ? getExitOffset(meta.axis, meta.direction) : 0,
                  y: meta.axis === "y" ? getExitOffset(meta.axis, meta.direction) : 0,
                  opacity: 0,
                  transition: {
                    duration: EXIT_DURATION,
                    ease: EXIT_EASE,
                  },
                }),
              }}
              initial="initial"
              animate="animate"
              exit="exit"
              onScrollCapture={
                disableHeaderScrollEffect ? undefined : handlePageScroll
              }
            >
              <OverlayScrollbarsComponent
                defer
                className={`app-page-scroll-area h-full w-full overscroll-contain ${isAfdianConversation ? "app-page-scroll-area-afdian-messages" : ""}`}
                options={{
                  overflow: { x: "hidden", y: "scroll" },
                  scrollbars: {
                    theme: "os-theme-light",
                    autoHide: "scroll",
                    autoHideDelay: 700,
                  },
                }}
              >
                <div
                  className={`app-page-scroll-content h-full pb-[var(--ui-safe-area-bottom)] ${isAfdianMessagesList ? "app-page-scroll-content-afdian-list" : ""} ${isAfdianConversation ? "app-page-scroll-content-afdian-messages" : ""}`}
                >
                  {frozenOutlet}
                </div>
              </OverlayScrollbarsComponent>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
