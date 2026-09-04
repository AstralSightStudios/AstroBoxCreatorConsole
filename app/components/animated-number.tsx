import {
    AnimatePresence,
    MotionConfig,
    animate,
    motion,
    useMotionValue,
    useTransform,
    type Transition,
} from "framer-motion";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
    type ElementType,
    type ReactNode,
} from "react";

type NumberAnimation = "default" | "smooth" | "snappy" | "bouncy";

type AnimatedNumberProps = Omit<
    ComponentPropsWithoutRef<"span">,
    "children"
> & {
    as?: ElementType;
    value: number;
    prefix?: string;
    suffix?: string;
    format?: Intl.NumberFormatOptions;
    locales?: Intl.LocalesArgument;
    animation?: NumberAnimation;
    autoSize?: boolean;
    initial?: boolean;
    stagger?: number;
    onComplete?: () => void;
};

const ANIMATIONS: Record<NumberAnimation, Transition> = {
    default: {
        duration: 0.38,
        ease: [0.19, 1, 0.22, 1],
    },
    smooth: {
        type: "spring",
        duration: 0.4,
        bounce: 0,
    },
    snappy: {
        type: "spring",
        duration: 0.35,
        bounce: 0.15,
    },
    bouncy: {
        type: "spring",
        duration: 0.5,
        bounce: 0.3,
    },
};

const DIGIT_DISTANCE = 8;

const segmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
});

function splitGraphemes(value: string) {
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

function isDigit(value: string) {
    return value >= "0" && value <= "9";
}

function parseNumber(value: string) {
    return Number.parseFloat(value.replace(/[^0-9.-]/g, "")) || 0;
}

function reconcileDigitKeys(
    previousText: string,
    nextText: string,
    previousKeys: number[],
    nextId: number,
) {
    const direction = Math.sign(parseNumber(nextText) - parseNumber(previousText));
    const previousChars = splitGraphemes(previousText);
    const nextChars = splitGraphemes(nextText);
    const firstDigitIndex = (chars: string[]) => {
        const index = chars.findIndex(isDigit);
        return index === -1 ? chars.length : index;
    };
    const nextPrefixLength = firstDigitIndex(nextChars);
    const previousPrefixLength = firstDigitIndex(previousChars);
    const sharedPrefixLength = Math.min(
        nextPrefixLength,
        previousPrefixLength,
    );
    const nextKeys = new Array<number>(nextChars.length);
    let id = nextId;

    for (let index = 0; index < nextPrefixLength; index += 1) {
        nextKeys[index] =
            index < sharedPrefixLength &&
            nextChars[index] === previousChars[index]
                ? previousKeys[index]
                : id++;
    }

    const previousBody = previousChars.slice(previousPrefixLength);
    const nextBody = nextChars.slice(nextPrefixLength);
    const previousBodyKeys = previousKeys.slice(previousPrefixLength);
    const maxBodyLength = Math.max(previousBody.length, nextBody.length);
    const paddedPrevious = [
        ...Array(Math.max(0, maxBodyLength - previousBody.length)).fill(""),
        ...previousBody,
    ];
    const paddedNext = [
        ...Array(Math.max(0, maxBodyLength - nextBody.length)).fill(""),
        ...nextBody,
    ];
    const paddedKeys = [
        ...Array(Math.max(0, maxBodyLength - previousBodyKeys.length)).fill(-1),
        ...previousBodyKeys,
    ];
    const bodyOffset = maxBodyLength - nextBody.length;

    for (let index = 0; index < nextBody.length; index += 1) {
        const previousIndex = bodyOffset + index;
        nextKeys[nextPrefixLength + index] =
            paddedNext[previousIndex] === paddedPrevious[previousIndex] &&
            paddedKeys[previousIndex] >= 0
                ? paddedKeys[previousIndex]
                : id++;
    }

    return { direction, keys: nextKeys, nextId: id };
}

function NumberRenderer({
    text,
    transition,
    stagger,
    animateInitial,
    onComplete,
}: {
    text: string;
    transition: Transition;
    stagger: number;
    animateInitial: boolean;
    onComplete?: () => void;
}) {
    const chars = splitGraphemes(text);
    const nextIdRef = useRef(chars.length);
    const [previousText, setPreviousText] = useState(text);
    const [digitKeys, setDigitKeys] = useState<number[]>(
        () => chars.map((_, index) => index),
    );
    const directionRef = useRef(1);

    if (text !== previousText) {
        const result = reconcileDigitKeys(
            previousText,
            text,
            digitKeys,
            nextIdRef.current,
        );
        nextIdRef.current = result.nextId;
        directionRef.current = result.direction;
        setDigitKeys(result.keys);
        setPreviousText(text);
    }

    const direction = directionRef.current;
    const prefixLength = (() => {
        const index = chars.findIndex(isDigit);
        return index === -1 ? chars.length : index;
    })();

    return (
        <MotionConfig transition={transition}>
            <span
                aria-label={text}
                style={{
                    display: "inline-flex",
                    position: "relative",
                }}
            >
                <AnimatePresence
                    mode="popLayout"
                    initial={animateInitial}
                >
                    {chars.map((char, index) => {
                        const isPrefix = index < prefixLength;
                        const outerKey = isPrefix
                            ? `pre-${index}`
                            : `col-${chars.length - 1 - index}`;
                        const delay = index * stagger;
                        const isLast = index === chars.length - 1;

                        return (
                            <motion.span
                                key={outerKey}
                                layout="position"
                                initial={isPrefix ? false : { opacity: 0 }}
                                animate={isPrefix ? undefined : { opacity: 1 }}
                                exit={isPrefix ? undefined : { opacity: 0 }}
                                style={{
                                    display: "inline-block",
                                    position: "relative",
                                }}
                            >
                                {isPrefix ? (
                                    <span
                                        style={{
                                            display: "inline-block",
                                            whiteSpace: "pre",
                                        }}
                                    >
                                        {char}
                                    </span>
                                ) : (
                                    <AnimatePresence
                                        mode="popLayout"
                                        initial={animateInitial}
                                        propagate
                                    >
                                        <motion.span
                                            key={digitKeys[index]}
                                            aria-hidden="true"
                                            initial={{
                                                y: isDigit(char)
                                                    ? direction > 0
                                                        ? DIGIT_DISTANCE
                                                        : -DIGIT_DISTANCE
                                                    : 0,
                                                filter: "blur(2px)",
                                                scale: 0.5,
                                                opacity: 0,
                                            }}
                                            animate={{
                                                y: 0,
                                                opacity: 1,
                                                filter: "blur(0px)",
                                                scale: 1,
                                                transition: { delay },
                                            }}
                                            exit={{
                                                y: isDigit(char)
                                                    ? direction > 0
                                                        ? -DIGIT_DISTANCE
                                                        : DIGIT_DISTANCE
                                                    : 0,
                                                opacity: 0,
                                                filter: "blur(2px)",
                                                scale: 0.5,
                                                transition: { delay },
                                            }}
                                            onAnimationComplete={
                                                isLast ? onComplete : undefined
                                            }
                                            style={{
                                                display: "inline-block",
                                                whiteSpace: "pre",
                                            }}
                                        >
                                            {char}
                                        </motion.span>
                                    </AnimatePresence>
                                )}
                            </motion.span>
                        );
                    })}
                </AnimatePresence>
            </span>
        </MotionConfig>
    );
}

function AutoSizeWrapper({
    children,
    transition,
}: {
    children: ReactNode;
    transition: Transition;
}) {
    const [element, setElement] = useState<HTMLSpanElement | null>(null);
    const [width, setWidth] = useState(0);
    const ref = useCallback((node: HTMLSpanElement | null) => {
        setElement(node);
    }, []);

    useEffect(() => {
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            setWidth(Math.ceil(entry.contentRect.width));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);

    return (
        <motion.span
            animate={{ width: width > 0 ? width : "auto" }}
            transition={transition}
            style={{ display: "inline-flex" }}
        >
            <span ref={ref} style={{ display: "inline-flex" }}>
                {children}
            </span>
        </motion.span>
    );
}

function formatAnimatedValue(
    value: number,
    format?: Intl.NumberFormatOptions,
    locales?: Intl.LocalesArgument,
) {
    return new Intl.NumberFormat(locales, format).format(value);
}

export default function AnimatedNumber({
    value,
    prefix,
    suffix,
    format,
    locales,
    animation = "snappy",
    as: Component = "span",
    autoSize = true,
    initial = false,
    stagger = 0.02,
    onComplete,
    className,
    style,
    ...props
}: AnimatedNumberProps) {
    const text = useMemo(
        () => formatAnimatedValue(value, format, locales),
        [format, locales, value],
    );
    const transition = ANIMATIONS[animation];
    const renderedNumber = (
        <NumberRenderer
            text={text}
            transition={transition}
            stagger={stagger}
            animateInitial={initial}
            onComplete={onComplete}
        />
    );
    const animatedContent = autoSize ? (
        <AutoSizeWrapper transition={transition}>
            {renderedNumber}
        </AutoSizeWrapper>
    ) : (
        renderedNumber
    );

    return (
        <Component {...props} className={className} style={style}>
            {prefix && <span data-animated-number-prefix>{prefix}</span>}
            {animatedContent}
            {suffix && <span data-animated-number-suffix>{suffix}</span>}
        </Component>
    );
}
