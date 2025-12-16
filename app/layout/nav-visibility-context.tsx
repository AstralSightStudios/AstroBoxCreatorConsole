import { createContext, useContext, useEffect, useMemo, useState } from "react";

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function detectIsDesktop() {
  if (typeof window === "undefined") {
    return true;
  }
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

interface NavVisibilityContextValue {
  isCollapsed: boolean;
  isDesktop: boolean;
  toggleNav: () => void;
  collapseNav: () => void;
  expandNav: () => void;
}

const NavVisibilityContext = createContext<
  NavVisibilityContextValue | undefined
>(undefined);

export function NavVisibilityProvider({ children }: React.PropsWithChildren) {
  const initialDesktop = detectIsDesktop();
  const [isDesktop, setIsDesktop] = useState(initialDesktop);
  const [isCollapsed, setIsCollapsed] = useState(!initialDesktop);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const syncState = (matches: boolean) => {
      setIsDesktop(matches);
      setIsCollapsed(matches ? false : true);
    };
    syncState(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncState(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const toggleNav = () => setIsCollapsed((prev) => (isDesktop ? false : !prev));

  const collapseNav = () => {
    if (!isDesktop) setIsCollapsed(true);
  };

  const expandNav = () => {
    if (!isDesktop) setIsCollapsed(false);
  };

  const value = useMemo(
    () => ({
      isCollapsed,
      isDesktop,
      toggleNav,
      collapseNav,
      expandNav,
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
