import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type SVGProps,
} from "react";

export type DynamicDrawerHandleDirection = "up" | "down";

/**
 * 命令式句柄：抽屉拖拽时由父组件在 `onDrag` 里调用 `setProgress`，
 * 直接改写 `<path>` 的 `d` 属性，避免每帧 setState 触发整个抽屉重渲染
 * （对齐 AstroBox-NG 的 `DynamicDrawerHandleRef` 约定）。
 */
export interface DynamicDrawerHandleRef {
  setProgress: (progress: number) => void;
}

export interface DynamicDrawerHandleProps
  extends Omit<SVGProps<SVGSVGElement>, "direction"> {
  /** 受控进度；不传时由 ref.setProgress 驱动 */
  progress?: number;
  direction?: DynamicDrawerHandleDirection;
}

const upArrowPath =
  "M2.50061 11.7297L23.7867 3.21524C26.1708 2.26159 28.8304 2.26159 31.2145 3.21524L52.5006 11.7297";
const upLinePath =
  "M3 11.7301L24.2861 11.73C26.6702 11.73 29.3298 11.73 31.7139 11.73L53 11.7301";
const downArrowPath =
  "M2.50061 3.2703L23.7867 11.78476C26.1708 12.73841 28.8304 12.73841 31.2145 11.78476L52.5006 3.2703";
const downLinePath =
  "M3 3.2699L24.2861 3.27C26.6702 3.27 29.3298 3.27 31.7139 3.27L53 3.2699";
const pathNumberPattern = /-?\d*\.?\d+/g;

function getPathNumbers(path: string) {
  return path.match(pathNumberPattern)?.map(Number) ?? [];
}

const upArrowNumbers = getPathNumbers(upArrowPath);
const upLineNumbers = getPathNumbers(upLinePath);
const downArrowNumbers = getPathNumbers(downArrowPath);
const downLineNumbers = getPathNumbers(downLinePath);

function buildPath(progress: number, direction: DynamicDrawerHandleDirection) {
  const normalizedProgress = Math.min(Math.max(progress, 0), 1);
  const arrowNumbers = direction === "up" ? upArrowNumbers : downArrowNumbers;
  const lineNumbers = direction === "up" ? upLineNumbers : downLineNumbers;
  // Keep the resting handle neutral and reveal the directional arrow while dragging.
  const values = lineNumbers.map(
    (value, index) =>
      value + (arrowNumbers[index] - value) * normalizedProgress,
  );

  return `M${values[0]} ${values[1]}L${values[2]} ${values[3]}C${values[4]} ${values[5]} ${values[6]} ${values[7]} ${values[8]} ${values[9]}L${values[10]} ${values[11]}`;
}

const DynamicDrawerHandle = forwardRef<
  DynamicDrawerHandleRef,
  DynamicDrawerHandleProps
>(function DynamicDrawerHandle(
  {
    progress: controlledProgress,
    direction = "up",
    strokeWidth = 5,
    ...props
  },
  ref,
) {
  const pathRef = useRef<SVGPathElement>(null);
  const internalProgressRef = useRef(controlledProgress ?? 0);

  useImperativeHandle(
    ref,
    () => ({
      setProgress: (nextProgress: number) => {
        const normalized = Math.min(Math.max(nextProgress, 0), 1);
        internalProgressRef.current = normalized;
        if (pathRef.current) {
          pathRef.current.setAttribute("d", buildPath(normalized, direction));
        }
      },
    }),
    [direction],
  );

  const activeProgress =
    controlledProgress !== undefined
      ? controlledProgress
      : internalProgressRef.current;

  return (
    <svg
      width={55}
      height={15}
      viewBox="0 0 55 15"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        ref={pathRef}
        d={buildPath(activeProgress, direction)}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
});

export default DynamicDrawerHandle;
