import { forwardRef, type SVGProps } from "react";

export type DynamicDrawerHandleDirection = "up" | "down";

export interface DynamicDrawerHandleProps
  extends Omit<SVGProps<SVGSVGElement>, "direction"> {
  progress: number;
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
  const values = lineNumbers.map(
    (value, index) =>
      value + (arrowNumbers[index] - value) * normalizedProgress,
  );

  return `M${values[0]} ${values[1]}L${values[2]} ${values[3]}C${values[4]} ${values[5]} ${values[6]} ${values[7]} ${values[8]} ${values[9]}L${values[10]} ${values[11]}`;
}

const DynamicDrawerHandle = forwardRef<
  SVGSVGElement,
  DynamicDrawerHandleProps
>(function DynamicDrawerHandle(
  { progress, direction = "up", strokeWidth = 5, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      width={55}
      height={15}
      viewBox="0 0 55 15"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path
        d={buildPath(progress, direction)}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
});

export default DynamicDrawerHandle;
