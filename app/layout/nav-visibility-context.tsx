import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import { UI_DESKTOP_MIN_WIDTH } from "~/config/uiScale";

export const NAV_DESKTOP_MIN_WIDTH = UI_DESKTOP_MIN_WIDTH;
// Marker stored on the synthetic history entry we push while the mobile
// drawer is open, so the hardware/Android back button closes the drawer
// instead of exiting the app.
const DRAWER_HISTORY_STATE = "__navDrawerOpen";

interface NavVisibilityContextValue {
  isCollapsed: boolean;
  isDesktop: boolean;
  toggleNav: () => void;
  collapseNav: () => void;
  expandNav: () => void;
  /**
   * Close the drawer right after a route navigation. The navigation is
   * expected to have replaced the synthetic drawer history entry, so this
   * only resets internal state without touching the history stack.
   */
  collapseNavForNavigation: () => void;
}

const NavVisibilityContext = createContext<
  NavVisibilityContextValue | undefined
>(undefined);

export function NavVisibilityProvider({ children }: React.PropsWithChildren) {
  const { isDesktop } = useUiScaleViewport();
  const [isCollapsed, setIsCollapsed] = useState(!isDesktop);
  // Tracks whether we currently have a synthetic history entry on the stack
  // representing the open mobile drawer.
  const drawerHistoryActiveRef = useRef(false);

  useEffect(() => {
    setIsCollapsed(!isDesktop);
  }, [isDesktop]);

  // Hardware back button support: when the synthetic drawer entry is popped
  // (Android back button, or our own history.back call), close the drawer.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePopState = () => {
      if (drawerHistoryActiveRef.current) {
        drawerHistoryActiveRef.current = false;
        setIsCollapsed(true);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const expandNav = () => {
    if (isDesktop) return;
    if (typeof window !== "undefined" && !drawerHistoryActiveRef.current) {
      drawerHistoryActiveRef.current = true;
      // Preserve react-router's own history state ({usr, key, idx}) and just
      // tack on our marker. No URL argument keeps the current location; we
      // only need an extra entry so the WebView reports it can navigate back
      // (otherwise the Android back button exits the app).
      const currentState =
        (window.history.state as Record<string, unknown> | null) ?? {};
      window.history.pushState(
        { ...currentState, [DRAWER_HISTORY_STATE]: true },
        "",
      );
    }
    setIsCollapsed(false);
  };

  const collapseNav = () => {
    if (isDesktop) return;
    if (drawerHistoryActiveRef.current && typeof window !== "undefined") {
      // Pop the synthetic entry; the popstate listener flips isCollapsed.
      window.history.back();
    } else {
      setIsCollapsed(true);
    }
  };

  const collapseNavForNavigation = () => {
    // The destination route navigation has replaced the synthetic entry, so
    // just reset state without rewinding history.
    drawerHistoryActiveRef.current = false;
    if (!isDesktop) {
      setIsCollapsed(true);
    }
  };

  const toggleNav = () => {
    if (isDesktop) {
      setIsCollapsed(false);
      return;
    }
    if (isCollapsed) {
      expandNav();
    } else {
      collapseNav();
    }
  };

  const value = useMemo(
    () => ({
      isCollapsed,
      isDesktop,
      toggleNav,
      collapseNav,
      expandNav,
      collapseNavForNavigation,
    }),
    [isCollapsed, isDesktop],
  );

  return (
    <NavVisibilityContext.Provider value={value}>
      {children}
    </NavVisibilityContext.Provider>
  );
}

export function useNavVisibility() {
  const context = useContext(NavVisibilityContext);
  if (!context) {
    throw new Error(
      "useNavVisibility must be used within a NavVisibilityProvider",
    );
  }
  return context;
}
