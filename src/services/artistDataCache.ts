import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';
import type { TrackWithAlbum } from '@/components/TrackListItem';

interface CachedArtistData {
  artistName: string;
  profilePicture: string | null;
  albums: PublicAlbumSummary[];
  ownedMap: Map<string, boolean>;
  collabAlbums: PublicAlbumSummary[];
  collaborationTracks: TrackWithAlbum[];
  albumCache: Map<string, PublicAlbumDetails>;
  topTracks: TrackWithAlbum[];
}

interface CacheEntry {
  data: CachedArtistData;
  ts: number;
}

// ── Types sérialisables pour sessionStorage ──
interface SerializedArtistData {
  artistName: string;
  profilePicture: string | null;
  albums: PublicAlbumSummary[];
  ownedMap: [string, boolean][];
  collabAlbums: PublicAlbumSummary[];
  collaborationTracks: TrackWithAlbum[];
  albumCache: [string, PublicAlbumDetails][];
  topTracks: TrackWithAlbum[];
}

interface SerializedEntry {
  data: SerializedArtistData;
  ts: number;
}

// ── Cache mémoire (instantané) ──
const memoryCache = new Map<string, CacheEntry>();

// ── sessionStorage ──
const STORAGE_PREFIX = 'artist_cache_';

/** Durée de validité : 10 minutes */
const CACHE_TTL = 10 * 60 * 1000;

// ── Helpers de sérialisation ──

function serialize(data: CachedArtistData): SerializedArtistData {
  return {
    ...data,
    ownedMap: Array.from(data.ownedMap.entries()),
    albumCache: Array.from(data.albumCache.entries()),
  };
}

function deserialize(data: SerializedArtistData): CachedArtistData {
  return {
    ...data,
    ownedMap: new Map(data.ownedMap),
    albumCache: new Map(data.albumCache),
  };
}

// ── sessionStorage helpers ──

function storageKey(artistId: string): string {
  return STORAGE_PREFIX + artistId;
}

function readFromStorage(artistId: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(storageKey(artistId));
    if (!raw) return null;
    const parsed: SerializedEntry = JSON.parse(raw);
    return { data: deserialize(parsed.data), ts: parsed.ts };
  } catch {
    // sessionStorage indisponible, quota dépassé ou JSON invalide
    return null;
  }
}

function writeToStorage(artistId: string, entry: CacheEntry): void {
  try {
    const serialized: SerializedEntry = { data: serialize(entry.data), ts: entry.ts };
    sessionStorage.setItem(storageKey(artistId), JSON.stringify(serialized));
  } catch {
    // Quota dépassé ou sessionStorage indisponible — silencieux
  }
}

function removeFromStorage(artistId: string): void {
  try {
    sessionStorage.removeItem(storageKey(artistId));
  } catch { /* silencieux */ }
}

// ── API publique ──

/**
 * Récupère les données mises en cache pour un artiste.
 * Vérifie d'abord le cache mémoire (instantané), puis sessionStorage (persistant).
 * Retourne `null` si absentes ou expirées.
 */
export function getCachedArtistData(artistId: string): CachedArtistData | null {
  // 1. Cache mémoire
  const mem = memoryCache.get(artistId);
  if (mem) {
    if (Date.now() - mem.ts > CACHE_TTL) {
      memoryCache.delete(artistId);
      removeFromStorage(artistId);
      return null;
    }
    return mem.data;
  }

  // 2. sessionStorage (reload → hydrate le cache mémoire)
  const stored = readFromStorage(artistId);
  if (stored) {
    if (Date.now() - stored.ts > CACHE_TTL) {
      removeFromStorage(artistId);
      return null;
    }
    memoryCache.set(artistId, stored);
    return stored.data;
  }

  return null;
}

/**
 * Stocke les données d'un artiste dans le cache (mémoire + sessionStorage).
 */
export function setCachedArtistData(
  artistId: string,
  data: CachedArtistData,
): void {
  const entry: CacheEntry = { data, ts: Date.now() };
  memoryCache.set(artistId, entry);
  writeToStorage(artistId, entry);
}

/**
 * Vide le cache pour un artiste spécifique ou tout le cache.
 */
export function clearArtistCache(artistId?: string): void {
  if (artistId) {
    memoryCache.delete(artistId);
    removeFromStorage(artistId);
  } else {
    memoryCache.clear();
    // Vider toutes les clés sessionStorage — collecter d'abord pour éviter le décalage d'index
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  }
}
