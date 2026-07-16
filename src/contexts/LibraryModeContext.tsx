import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type LibraryMode = 'online' | 'offline';

const STORAGE_KEY = 'passio_library_mode';

/** URL de base de l'API (calculée comme dans api.ts). */
function getApiBaseUrl(): string {
  return (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

type LibraryModeContextValue = {
  effectiveMode: LibraryMode;
  toggleMode: () => Promise<void>;
  setMode: (mode: LibraryMode) => Promise<void>;
  /** Message de transition à afficher dans un toast, ou null. */
  transitionMessage: string | null;
};

const LibraryModeContext = createContext<LibraryModeContextValue | null>(null);

// ─── Health-check réseau ─────────────────────────────────────────────────

/**
 * Vérifie si le réseau ET l'API sont réellement joignables.
 *
 * Stratégie anti-portail-captif :
 * 1. Fetch GET /api/health avec timeout 3s (AbortController)
 * 2. Vérifie que Content-Type est application/json
 * 3. Parse le JSON et valide la structure ApiHealth { status, message, timestamp }
 *
 * Retourne `true` uniquement si les 3 conditions sont remplies.
 */
async function checkNetworkReachable(): Promise<boolean> {
  const apiUrl = getApiBaseUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`${apiUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'include',
      mode: 'cors',
    });
    clearTimeout(timeoutId);

    // 1. Code HTTP 2xx
    if (!response.ok) return false;

    // 2. Content-Type JSON (un portail captif renvoie du HTML)
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) return false;

    // 3. Structure ApiHealth valide
    const data: unknown = await response.json();
    return (
      data !== null &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      typeof (data as Record<string, unknown>).status === 'string' &&
      typeof (data as Record<string, unknown>).message === 'string'
    );
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

// ─── Provider ────────────────────────────────────────────────────────────

export function LibraryModeProvider({ children }: { children: ReactNode }) {
  const [effectiveMode, setEffectiveMode] = useState<LibraryMode>('online');
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);

  // Refs pour les timers (éviter les stale closures)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recheckAttemptRef = useRef(0);
  const prevModeRef = useRef<LibraryMode>('online');
  const mountedRef = useRef(true);

  // ── Nettoyage des timers ─────────────────────────────────────────────

  const clearRecheckTimer = useCallback(() => {
    if (recheckTimerRef.current !== null) {
      clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
    recheckAttemptRef.current = 0;
  }, []);

  // ── Affichage du toast de transition ──────────────────────────────────

  const showTransition = useCallback((message: string) => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    setTransitionMessage(message);
    transitionTimerRef.current = setTimeout(() => {
      setTransitionMessage(null);
      transitionTimerRef.current = null;
    }, 3000);
  }, []);

  // ── Planification de la re-vérification périodique (backoff) ──────────

  const scheduleRecheck = useCallback(() => {
    const attempt = recheckAttemptRef.current;
    const delay = Math.min(30_000 * Math.pow(2, attempt), 120_000);
    recheckAttemptRef.current = attempt + 1;

    recheckTimerRef.current = setTimeout(async () => {
      const reachable = await checkNetworkReachable();
      if (!mountedRef.current) return;
      if (reachable) {
        clearRecheckTimer();
        setEffectiveMode('online');
        try {
          localStorage.setItem(STORAGE_KEY, 'online');
        } catch { /* ignore */ }
        showTransition('🌐 Connexion rétablie');
      } else {
        if (!mountedRef.current) return;
        scheduleRecheck();
      }
    }, delay);
  }, [clearRecheckTimer, showTransition]);

  // ── Changement de mode (interne) ─────────────────────────────────────

  const switchMode = useCallback((mode: LibraryMode) => {
    setEffectiveMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch { /* ignore */ }
  }, []);

  // ── Détection des changements de mode → toast ────────────────────────

  useEffect(() => {
    if (prevModeRef.current !== effectiveMode) {
      if (effectiveMode === 'offline') {
        showTransition('📴 Mode hors-ligne activé');
      }
      prevModeRef.current = effectiveMode;
    }
  }, [effectiveMode, showTransition]);

  // ── Initialisation et écouteurs réseau ────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    // Restaurer le mode sauvegardé
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as LibraryMode | null;
      if (mountedRef.current && (stored === 'online' || stored === 'offline')) {
        setEffectiveMode(stored);
        prevModeRef.current = stored;
      }
    } catch { /* ignore */ }

    // ── Gestion des événements réseau ──

    const handleOffline = () => {
      switchMode('offline');
      scheduleRecheck();
    };

    const handleOnline = () => {
      // Ne pas se fier aveuglément à navigator.onLine →
      // valider avec le health-check
      checkNetworkReachable().then((reachable) => {
        if (!mountedRef.current) return;
        if (reachable) {
          clearRecheckTimer();
          const stored = localStorage.getItem(STORAGE_KEY) as LibraryMode | null;
          switchMode(stored === 'offline' ? 'offline' : 'online');
          showTransition('🌐 Connexion rétablie');
        }
        // Si pas joignable → on reste en offline,
        // scheduleRecheck est déjà en cours depuis le handleOffline
        // (ou a été appelé à l'initialisation si on était déjà offline)
      });
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    // ── Vérification initiale ──

    if (!navigator.onLine) {
      switchMode('offline');
      scheduleRecheck();
    } else {
      // Health-check initial pour détecter un portail captif au démarrage
      checkNetworkReachable().then((reachable) => {
        if (!mountedRef.current) return;
        if (!reachable) {
          switchMode('offline');
          scheduleRecheck();
        }
      });

      // Au démarrage en ligne : migration + validation des clés (fire & forget)
      (async () => {
        try {
          const { migrateKeysFormat, validateAllKeysOnline } = await import('@/services/keyManager');
          await migrateKeysFormat();
          await validateAllKeysOnline();
        } catch {
          // Échec silencieux
        }
      })();
    }

    return () => {
      mountedRef.current = false;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      if (recheckTimerRef.current) clearTimeout(recheckTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── API publique ─────────────────────────────────────────────────────

  const setMode = useCallback(async (mode: LibraryMode) => {
    switchMode(mode);
    if (mode === 'offline') {
      scheduleRecheck();
    } else {
      clearRecheckTimer();
      // En passant en online manuel, vérifier que c'est réellement joignable
      const reachable = await checkNetworkReachable();
      if (!reachable) {
        switchMode('offline');
        scheduleRecheck();
        showTransition('📴 Mode hors-ligne activé');
      }
    }
  }, [switchMode, scheduleRecheck, clearRecheckTimer, showTransition]);

  const toggleMode = useCallback(async () => {
    const next: LibraryMode = effectiveMode === 'online' ? 'offline' : 'online';
    await setMode(next);
  }, [effectiveMode, setMode]);

  const value = useMemo<LibraryModeContextValue>(
    () => ({ effectiveMode, toggleMode, setMode, transitionMessage }),
    [effectiveMode, toggleMode, setMode, transitionMessage],
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
