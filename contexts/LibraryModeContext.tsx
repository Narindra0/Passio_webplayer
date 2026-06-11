import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  deleteEncryptedValue,
  readEncryptedValue,
  saveEncryptedValue,
} from '@/services/storage';

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
    void (async () => {
      try {
        const stored = await readEncryptedValue(STORAGE_KEY);
        if (mounted && (stored === 'online' || stored === 'offline')) {
          setEffectiveMode(stored);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setMode = useCallback(async (mode: LibraryMode) => {
    setEffectiveMode(mode);
    await saveEncryptedValue(STORAGE_KEY, mode);
  }, []);

  const toggleMode = useCallback(async () => {
    const next: LibraryMode = effectiveMode === 'online' ? 'offline' : 'online';
    await setMode(next);
  }, [effectiveMode, setMode]);

  const value = useMemo<LibraryModeContextValue>(
    () => ({
      effectiveMode,
      toggleMode,
      setMode,
    }),
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
