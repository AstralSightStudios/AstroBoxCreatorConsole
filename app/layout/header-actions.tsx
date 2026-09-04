import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

const LARGE_TITLE_COLLAPSE_DISTANCE = 56;

const HeaderActionsContext = createContext<ReactNode>(null);
const SetHeaderActionsContext = createContext<(actions: ReactNode) => void>(
  () => {},
);
const HeaderActionsFitContext = createContext<boolean>(false);
const SetHeaderActionsFitContext = createContext<(fit: boolean) => void>(
  () => {},
);
const HeaderBreadcrumbContext = createContext<string | null>(null);
const SetHeaderBreadcrumbContext = createContext<(value: string | null) => void>(
  () => {},
);
const HeaderLargeTitleContext = createContext<string | null>(null);
const HeaderLargeTitleProgressContext = createContext(0);
const RegisterHeaderLargeTitleContext = createContext<
  (title: string) => () => void
>(() => () => {});
const UpdateHeaderScrollContext = createContext<(scrollTop: number) => void>(
  () => {},
);

export function useHeaderActions() {
  return useContext(HeaderActionsContext);
}

export function useSetHeaderActions() {
  return useContext(SetHeaderActionsContext);
}

export function useHeaderActionsFit() {
  return useContext(HeaderActionsFitContext);
}

export function useSetHeaderActionsFit() {
  return useContext(SetHeaderActionsFitContext);
}

export function useHeaderBreadcrumb() {
  return useContext(HeaderBreadcrumbContext);
}

export function useSetHeaderBreadcrumb() {
  return useContext(SetHeaderBreadcrumbContext);
}

export function useHeaderLargeTitle() {
  return useContext(HeaderLargeTitleContext);
}

export function useHeaderLargeTitleProgress() {
  return useContext(HeaderLargeTitleProgressContext);
}

export function useRegisterHeaderLargeTitle() {
  return useContext(RegisterHeaderLargeTitleContext);
}

export function useUpdateHeaderScroll() {
  return useContext(UpdateHeaderScrollContext);
}

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  const [fit, setFit] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<string | null>(null);
  const [largeTitle, setLargeTitle] = useState<string | null>(null);
  const [largeTitleProgress, setLargeTitleProgress] = useState(0);
  const largeTitleRef = useRef<string | null>(null);

  const registerLargeTitle = useCallback((title: string) => {
    largeTitleRef.current = title;
    setLargeTitle(title);
    setLargeTitleProgress(0);

    return () => {
      if (largeTitleRef.current !== title) return;
      largeTitleRef.current = null;
      setLargeTitle(null);
      setLargeTitleProgress(0);
    };
  }, []);

  const updateHeaderScroll = useCallback((scrollTop: number) => {
    if (!largeTitleRef.current) return;
    setLargeTitleProgress(
      Math.min(1, Math.max(0, scrollTop / LARGE_TITLE_COLLAPSE_DISTANCE)),
    );
  }, []);

  return (
    <SetHeaderActionsContext.Provider value={setActions}>
      <SetHeaderActionsFitContext.Provider value={setFit}>
        <SetHeaderBreadcrumbContext.Provider value={setBreadcrumb}>
          <RegisterHeaderLargeTitleContext.Provider value={registerLargeTitle}>
            <UpdateHeaderScrollContext.Provider value={updateHeaderScroll}>
              <HeaderActionsContext.Provider value={actions}>
                <HeaderActionsFitContext.Provider value={fit}>
                  <HeaderBreadcrumbContext.Provider value={breadcrumb}>
                    <HeaderLargeTitleContext.Provider value={largeTitle}>
                      <HeaderLargeTitleProgressContext.Provider
                        value={largeTitleProgress}
                      >
                        {children}
                      </HeaderLargeTitleProgressContext.Provider>
                    </HeaderLargeTitleContext.Provider>
                  </HeaderBreadcrumbContext.Provider>
                </HeaderActionsFitContext.Provider>
              </HeaderActionsContext.Provider>
            </UpdateHeaderScrollContext.Provider>
          </RegisterHeaderLargeTitleContext.Provider>
        </SetHeaderBreadcrumbContext.Provider>
      </SetHeaderActionsFitContext.Provider>
    </SetHeaderActionsContext.Provider>
  );
}
