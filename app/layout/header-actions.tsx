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

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  const [fit, setFit] = useState(false);
  return (
    <SetHeaderActionsContext.Provider value={setActions}>
      <SetHeaderActionsFitContext.Provider value={setFit}>
        <HeaderActionsContext.Provider value={actions}>
          <HeaderActionsFitContext.Provider value={fit}>
            {children}
          </HeaderActionsFitContext.Provider>
        </HeaderActionsContext.Provider>
      </SetHeaderActionsFitContext.Provider>
    </SetHeaderActionsContext.Provider>
  );
}
