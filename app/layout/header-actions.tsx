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

export function useHeaderActions() {
  return useContext(HeaderActionsContext);
}

export function useSetHeaderActions() {
  return useContext(SetHeaderActionsContext);
}

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <SetHeaderActionsContext.Provider value={setActions}>
      <HeaderActionsContext.Provider value={actions}>
        {children}
      </HeaderActionsContext.Provider>
    </SetHeaderActionsContext.Provider>
  );
}
