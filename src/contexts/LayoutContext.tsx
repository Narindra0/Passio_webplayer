import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface LayoutContextValue {
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue>({
  isSidebarCollapsed: false,
  setSidebarCollapsed: () => {},
});

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);

  const value = useMemo(
    () => ({ isSidebarCollapsed, setSidebarCollapsed }),
    [isSidebarCollapsed],
  );

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  return useContext(LayoutContext);
}
