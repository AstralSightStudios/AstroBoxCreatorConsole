import { AnimatePresence, motion } from "framer-motion";
import { useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { findNavIndex, getSegments, normalizePath } from "~/layout/nav-config";

type Axis = "x" | "y";

interface TransitionMeta {
    axis: Axis;
    direction: 1 | -1;
    reason: "hierarchy" | "nav" | "fallback";
}

const DEFAULT_TRANSITION: TransitionMeta = {
    axis: "x",
    direction: 1,
    reason: "fallback",
};

const MOTION_EASE: [number, number, number, number] = [0.19, 1, 0.22, 1];
const ENTER_DURATION = 0.26;
const EXIT_DURATION = 0.22;

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

    const prevNavIndex = findNavIndex(prevPath);
    const nextNavIndex = findNavIndex(nextPath);
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

function getInitialOffset(meta: TransitionMeta) {
    const distance = meta.axis === "x" ? "100%" : "85%";
    return meta.direction > 0 ? distance : `-${distance}`;
}

function getExitOffset(meta: TransitionMeta) {
    const distance = meta.axis === "x" ? "30%" : "25%";
    return meta.direction > 0 ? `-${distance}` : distance;
}

export default function PageTransition() {
    const location = useLocation();
    const normalizedPath = normalizePath(location.pathname);
    const transitionSnapshotRef = useRef<{
        path: string;
        meta: TransitionMeta;
    }>({
        path: normalizedPath,
        meta: DEFAULT_TRANSITION,
    });

    if (normalizedPath !== transitionSnapshotRef.current.path) {
        const previousPath = transitionSnapshotRef.current.path;
        transitionSnapshotRef.current = {
            path: normalizedPath,
            meta: determineTransition(
                previousPath,
                normalizedPath,
            ),
        };
    }

    const { meta: transitionMeta, path: motionKey } = transitionSnapshotRef.current;

    return (
        <div className="relative h-full min-h-screen overflow-hidden">
            <AnimatePresence
                initial={false}
                mode="wait"
                custom={transitionMeta}
            >
                <motion.div
                    key={motionKey}
                    className="absolute inset-0 w-full h-full overflow-y-auto"
                    custom={transitionMeta}
                    variants={{
                        initial: (meta: TransitionMeta) => ({
                            x: meta.axis === "x" ? getInitialOffset(meta) : 0,
                            y: meta.axis === "y" ? getInitialOffset(meta) : 0,
                            opacity: 0.85,
                        }),
                        animate: {
                            x: 0,
                            y: 0,
                            opacity: 1,
                            transition: {
                                duration: ENTER_DURATION,
                                ease: MOTION_EASE,
                            },
                        },
                        exit: (meta: TransitionMeta) => ({
                            x: meta.axis === "x" ? getExitOffset(meta) : 0,
                            y: meta.axis === "y" ? getExitOffset(meta) : 0,
                            opacity: 0.5,
                            transition: {
                                duration: EXIT_DURATION,
                                ease: MOTION_EASE,
                            },
                        }),
                    }}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                >
                    <div className="min-h-full">
                        <Outlet />
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
