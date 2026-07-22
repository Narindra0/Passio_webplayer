/**
 * useNetworkQuality.ts — Hook qui détecte la qualité de la connexion réseau
 *
 * Utilise l'API Network Information (navigator.connection) pour déterminer
 * si l'utilisateur est en data mobile et ajuster le comportement de l'app.
 *
 * Retourne :
 *   - 'slow'   : connexion lente (2G/3G/saveData) → économie de données maximale
 *   - 'medium' : connexion moyenne (4G sans saveData)
 *   - 'fast'   : connexion rapide (Wi-Fi / Ethernet / 5G)
 *   - 'offline': pas de connexion
 */

import { useSyncExternalStore, useCallback } from 'react';

export type NetworkQuality = 'slow' | 'medium' | 'fast' | 'offline';

interface NavigatorWithConnection extends Navigator {
  connection?: {
    effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
    saveData?: boolean;
    addEventListener?: (type: string, listener: EventListener) => void;
    removeEventListener?: (type: string, listener: EventListener) => void;
  };
}

function getNetworkQuality(): NetworkQuality {
  // Vérifier la connectivité d'abord
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'offline';
  }

  const conn = (navigator as NavigatorWithConnection).connection;
  if (!conn) return 'fast'; // API non supportée → supposer Wi-Fi

  // Data Saver activé (Android / Windows)
  if (conn.saveData) return 'slow';

  // Type de connexion effectif
  switch (conn.effectiveType) {
    case 'slow-2g':
    case '2g':
      return 'slow';
    case '3g':
      return 'slow';
    case '4g':
      return 'medium';
    default:
      return 'fast'; // 5G, Wi-Fi, Ethernet ou inconnu
  }
}

/**
 * Hook synchrone qui retourne la qualité réseau actuelle.
 * Se met à jour automatiquement quand la connexion change.
 */
export function useNetworkQuality(): NetworkQuality {
  const subscribe = useCallback((callback: () => void) => {
    const conn = (navigator as NavigatorWithConnection).connection;
    if (conn?.addEventListener) {
      conn.addEventListener('change', callback);
      return () => conn.removeEventListener?.('change', callback);
    }
    // Pas d'API → souscrire à online/offline uniquement
    window.addEventListener('online', callback);
    window.addEventListener('offline', callback);
    return () => {
      window.removeEventListener('online', callback);
      window.removeEventListener('offline', callback);
    };
  }, []);

  const getSnapshot = useCallback(() => getNetworkQuality(), []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Version utilitaire pour une vérification ponctuelle (hors hook React).
 */
export function getNetworkQualitySnapshot(): NetworkQuality {
  return getNetworkQuality();
}
