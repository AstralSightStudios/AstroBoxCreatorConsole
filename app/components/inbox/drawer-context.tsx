import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavVisibility } from "~/layout/nav-visibility-context";

interface InboxDrawerContextValue {
  open: boolean;
  openInbox: () => void;
  closeInbox: () => void;
}

const InboxDrawerContext = createContext<InboxDrawerContextValue | null>(null);

/**
 * 信箱抽屉的状态。
 *
 * Provider 必须挂在 `<Nav />` **之外**（见 `root.tsx`），这不是洁癖而是硬约束：
 * 窄屏下 `Nav` 自己就是一个 vaul `Drawer`，而 Radix DismissableLayer 判「外部
 * 点击」用的是 React 树（`@radix-ui/react-dismissable-layer` 里那句
 * "ensures we check React component tree (not just DOM tree)"）。信箱浮层若留在
 * 导航子树内，它和导航抽屉就共享同一套浮层判定，点消息会连带把侧栏收掉、信箱
 * 一起卸载。AstroBox 端 `InboxButton` 挂在 `pages/home.tsx` 的页面 header 上、
 * 全链路没有 Drawer，就是为了避开这个冲突。
 *
 * 提到顶层后信箱是独立浮层：打开时由 `openInbox` 主动收起侧栏（窄屏信箱是
 * 全屏 sheet，与导航抽屉无法共存），此后互不干扰。
 */
export function InboxDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { isDesktop, collapseNav } = useNavVisibility();

  const openInbox = useCallback(() => {
    if (!isDesktop) collapseNav();
    setOpen(true);
  }, [collapseNav, isDesktop]);

  const closeInbox = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, openInbox, closeInbox }),
    [open, openInbox, closeInbox],
  );

  return (
    <InboxDrawerContext.Provider value={value}>
      {children}
    </InboxDrawerContext.Provider>
  );
}

export function useInboxDrawer() {
  const context = useContext(InboxDrawerContext);
  if (!context) {
    throw new Error(
      "useInboxDrawer must be used within an InboxDrawerProvider",
    );
  }
  return context;
}
