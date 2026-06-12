import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';
import { logger } from '@/utils/logger';

const CACHE_KEY = 'passio_free_catalog_cache';
const CACHE_VERSION = 1;

/** Durée de vie du cache : 10 minutes */
const CACHE_TTL_MS = 10 * 60 * 1000;

export type FreeCatalogCache = {
  version: 1;
  cachedAt: string;
  albums: PublicAlbumSummary[];
  albumDetails: Record<string, PublicAlbumDetails>;
};

/**
 * Lit le cache et retourne les données si elles existent.
 */
export async function readFreeCatalogCache(): Promise<FreeCatalogCache | null> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FreeCatalogCache>;
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.albums) || !parsed.albumDetails) return null;
    return parsed as FreeCatalogCache;
  } catch (error) {
    logger.warn('FreeCatalogCache', 'Cache illisible', error);
    return null;
  }
}

/**
 * Vérifie si le cache est encore frais (moins de CACHE_TTL_MS).
 */
export function isCacheFresh(cache: FreeCatalogCache): boolean {
  const cachedAt = new Date(cache.cachedAt).getTime();
  return Date.now() - cachedAt < CACHE_TTL_MS;
}

/**
 * Écrit le cache en localStorage.
 */
export async function writeFreeCatalogCache(
  albums: PublicAlbumSummary[],
  albumDetails: Map<string, PublicAlbumDetails> | Record<string, PublicAlbumDetails>,
): Promise<void> {
  try {
    const normalized = albumDetails instanceof Map ? Object.fromEntries(albumDetails.entries()) : albumDetails;
    const payload: FreeCatalogCache = { version: CACHE_VERSION, cachedAt: new Date().toISOString(), albums, albumDetails: normalized };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    logger.warn('FreeCatalogCache', 'Écriture impossible', error);
  }
}

/**
 * Stratégie stale-while-revalidate :
 * 1. Vérifie le cache existant
 * 2. Si le cache est frais → l'utilise directement (fromNetwork = false)
 * 3. Si le cache est périmé → retourne les données mises en cache + déclenche un rafraîchissement en arrière-plan (fromNetwork = 'background')
 * 4. Si pas de cache → retourne null (le caller doit faire un appel réseau)
 *
 * @param fetcher - Fonction qui fait l'appel réseau pour récupérer les données fraîches
 * @returns Données du cache + statut de la source
 */
export async function staleWhileRevalidate(
  fetcher: () => Promise<{ albums: PublicAlbumSummary[]; albumDetails: Map<string, PublicAlbumDetails> }>,
): Promise<{
  data: FreeCatalogCache | null;
  fromNetwork: boolean | 'background';
  backgroundRefresh?: Promise<void>;
}> {
  // 1. Vérifier le cache existant
  const cached = await readFreeCatalogCache();

  if (cached && isCacheFresh(cached)) {
    // Cache frais — l'utiliser directement sans appel réseau
    return { data: cached, fromNetwork: false };
  }

  if (cached) {
    // Cache périmé — retourner les données mises en cache
    // et déclencher un rafraîchissement en arrière-plan
    const refreshPromise = (async () => {
      try {
        const freshData = await fetcher();
        await writeFreeCatalogCache(freshData.albums, freshData.albumDetails);
        logger.info('FreeCatalogCache', 'Cache rafraîchi en arrière-plan');
      } catch (err) {
        logger.warn('FreeCatalogCache', 'Échec du rafraîchissement arrière-plan', err);
      }
    })();

    return { data: cached, fromNetwork: 'background', backgroundRefresh: refreshPromise };
  }

  // Pas de cache — le caller doit faire l'appel réseau
  return { data: null, fromNetwork: false };
}

export function freeCatalogDetailsMap(cache: FreeCatalogCache): Map<string, PublicAlbumDetails> {
  return new Map(Object.entries(cache.albumDetails));
}

/**
 * Vide le cache du catalogue gratuit.
 */
export async function clearFreeCatalogCache(): Promise<void> {
  try {
    localStorage.removeItem(CACHE_KEY);
    logger.info('FreeCatalogCache', 'Cache vidé');
  } catch {
    // ignore
  }
}
