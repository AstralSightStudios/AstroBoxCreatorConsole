import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

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

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  const [fit, setFit] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<string | null>(null);
  return (
    <SetHeaderActionsContext.Provider value={setActions}>
      <SetHeaderActionsFitContext.Provider value={setFit}>
        <SetHeaderBreadcrumbContext.Provider value={setBreadcrumb}>
          <HeaderActionsContext.Provider value={actions}>
            <HeaderActionsFitContext.Provider value={fit}>
              <HeaderBreadcrumbContext.Provider value={breadcrumb}>
                {children}
              </HeaderBreadcrumbContext.Provider>
            </HeaderActionsFitContext.Provider>
          </HeaderActionsContext.Provider>
        </SetHeaderBreadcrumbContext.Provider>
      </SetHeaderActionsFitContext.Provider>
    </SetHeaderActionsContext.Provider>
  );
}
