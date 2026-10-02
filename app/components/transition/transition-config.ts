// 路由进退场动画的统一参数。主应用（PageTransition）与设置/登录等配置页
// （root.tsx 中的 setup 分支）共用同一套时长与缓动，保证动画观感一致。

export const ENTER_EASE: [number, number, number, number] = [0.22, 0.82, 0.3, 1];
export const EXIT_EASE: [number, number, number, number] = [0.65, 0, 0.35, 1];
export const ENTER_DURATION = 0.3;
export const EXIT_DURATION = 0.2;

export type TransitionAxis = "x" | "y";

/** 退场页面进入时的起始位移；direction > 0 表示新页面位移方向为正。 */
export function getInitialOffset(axis: TransitionAxis, direction: 1 | -1) {
  const distance = axis === "x" ? "100%" : "85%";
  return direction > 0 ? distance : `-${distance}`;
}

/** 旧页面的退场位移。 */
export function getExitOffset(axis: TransitionAxis, direction: 1 | -1) {
  const distance = axis === "x" ? "30%" : "25%";
  return direction > 0 ? `-${distance}` : distance;
}
