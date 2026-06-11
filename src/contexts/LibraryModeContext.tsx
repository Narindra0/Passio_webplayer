import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type LibraryMode = 'online' | 'offline';

const STORAGE_KEY = 'passio_library_mode';

type LibraryModeContextValue = {
  effectiveMode: LibraryMode;
  toggleMode: () => Promise<void>;
  setMode: (mode: LibraryMode) => Promise<void>;
};

const LibraryModeContext = createContext<LibraryModeContextValue | null>(null);

export function LibraryModeProvider({ children }: { children: ReactNode }) {
  const [effectiveMode, setEffectiveMode] = useState<LibraryMode>('online');

  useEffect(() => {
    let mounted = true;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (mounted && (stored === 'online' || stored === 'offline')) {
        setEffectiveMode(stored);
      }
    } catch {
      // ignore
    }

    // Auto-switch to offline mode when network drops
    const handleOffline = () => setEffectiveMode('offline');
    const handleOnline = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY) as LibraryMode | null;
        setEffectiveMode(stored === 'offline' ? 'offline' : 'online');
      } catch {
        setEffectiveMode('online');
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    // Initial check
    if (!navigator.onLine) {
      setEffectiveMode('offline');
    }

    return () => {
      mounted = false;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const setMode = useCallback(async (mode: LibraryMode) => {
    setEffectiveMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }, []);

  const toggleMode = useCallback(async () => {
    const next: LibraryMode = effectiveMode === 'online' ? 'offline' : 'online';
    await setMode(next);
  }, [effectiveMode, setMode]);

  const value = useMemo<LibraryModeContextValue>(
    () => ({ effectiveMode, toggleMode, setMode }),
    [effectiveMode, toggleMode, setMode],
  );

  return (
    <LibraryModeContext.Provider value={value}>{children}</LibraryModeContext.Provider>
  );
}

export function useLibraryMode() {
  const ctx = useContext(LibraryModeContext);
  if (!ctx) {
    throw new Error('useLibraryMode must be used within LibraryModeProvider');
  }
  return ctx;
}
