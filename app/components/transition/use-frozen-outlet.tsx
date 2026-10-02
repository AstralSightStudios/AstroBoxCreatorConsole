import { useContext, useMemo } from "react";
import {
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
  useOutlet,
} from "react-router";

/**
 * 返回「冻结」后的 Outlet 元素。
 *
 * `AnimatePresence` 在退出动画期间会保留旧页面的 React 元素，但 React Router 的
 * 上下文更新仍会让旧页面重新读取到新路由，导致进退场出现两份新内容。因此这里在
 * 渲染时捕获一次路由上下文，并把 Outlet 包在捕获到的上下文里，使退出中的旧页面
 * 保持渲染它原本的内容。
 */
export function useFrozenOutlet() {
  const outlet = useOutlet();
  const dataRouterContext = useContext(UNSAFE_DataRouterContext);
  const dataRouterState = useContext(UNSAFE_DataRouterStateContext);
  const locationContext = useContext(UNSAFE_LocationContext);
  const navigationContext = useContext(UNSAFE_NavigationContext);
  const routeContext = useContext(UNSAFE_RouteContext);

  return useMemo(() => {
    if (!outlet) {
      return outlet;
    }

    return (
      <UNSAFE_DataRouterContext.Provider value={dataRouterContext}>
        <UNSAFE_DataRouterStateContext.Provider value={dataRouterState}>
          <UNSAFE_LocationContext.Provider value={locationContext}>
            <UNSAFE_NavigationContext.Provider value={navigationContext}>
              <UNSAFE_RouteContext.Provider value={routeContext}>
                {outlet}
              </UNSAFE_RouteContext.Provider>
            </UNSAFE_NavigationContext.Provider>
          </UNSAFE_LocationContext.Provider>
        </UNSAFE_DataRouterStateContext.Provider>
      </UNSAFE_DataRouterContext.Provider>
    );
  }, [
    outlet,
    dataRouterContext,
    dataRouterState,
    locationContext,
    navigationContext,
    routeContext,
  ]);
}
