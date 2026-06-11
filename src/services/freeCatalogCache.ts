import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';
import { logger } from '@/utils/logger';

const CACHE_KEY = 'passio_free_catalog_cache';
const CACHE_VERSION = 1;

export type FreeCatalogCache = {
  version: 1;
  cachedAt: string;
  albums: PublicAlbumSummary[];
  albumDetails: Record<string, PublicAlbumDetails>;
};

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

export function freeCatalogDetailsMap(cache: FreeCatalogCache): Map<string, PublicAlbumDetails> {
  return new Map(Object.entries(cache.albumDetails));
}
