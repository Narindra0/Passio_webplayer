/**
 * offlineCache.ts — Gestion du cache audio via Cache Storage API.
 *
 * Stocke les fichiers audio téléchargés dans la Cache Storage du navigateur
 * (gérée par le Service Worker) au lieu d'IndexedDB, pour :
 * - Interception transparente par le SW des requêtes /audio/*
 * - Stratégie Cache-First : pas d'appel réseau pour les fichiers déjà téléchargés
 * - Éviction automatique par le navigateur si le quota est dépassé
 *
 * Structure :
 * - Cache : 'passio-audio-cache' (Cache Storage)
 * - Clé de cache : l'URL réelle du fichier audio (CDN Cloudflare ou proxy backend)
 * - Mapping localStorage : 'passio_audio_cache_map_{trackId}' → URL réelle
 */

import { logger } from '@/utils/logger';
import { getAllStoredTrackIds, getTrackFromDB, deleteTrackFromDB } from './indexedDB';

const AUDIO_CACHE_NAME = 'passio-audio-cache';
const CACHE_MAP_PREFIX = 'passio_audio_cache_map_';

// ── Cache Storage ──────────────────────────────────────────────────────────

/**
 * Ouvre le cache audio nommé.
 */
async function openAudioCache(): Promise<Cache> {
  return await caches.open(AUDIO_CACHE_NAME);
}

// ── Mapping localStorage trackId ↔ URL ─────────────────────────────────────

function getCacheKey(trackId: string): string | null {
  try {
    return localStorage.getItem(CACHE_MAP_PREFIX + trackId);
  } catch {
    return null;
  }
}

function setCacheKey(trackId: string, url: string): void {
  try {
    localStorage.setItem(CACHE_MAP_PREFIX + trackId, url);
  } catch {
    // localStorage plein — on ignore
  }
}

function removeCacheKey(trackId: string): void {
  try {
    localStorage.removeItem(CACHE_MAP_PREFIX + trackId);
  } catch {
    // ignore
  }
}

function getAllTrackIdsFromMap(): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_MAP_PREFIX)) {
        ids.push(key.slice(CACHE_MAP_PREFIX.length));
      }
    }
  } catch {
    // ignore
  }
  return ids;
}

// ── Fonctions principales ──────────────────────────────────────────────────

/**
 * Sauvegarde un fichier audio dans le Cache Storage.
 *
 * @param trackId    Identifiant de la piste
 * @param response   Response HTTP (idéal) ou ArrayBuffer/Uint8Array
 * @param sourceUrl  URL source facultative (utilisée comme clé de cache)
 */
export async function saveAudioToCache(
  trackId: string,
  response: Response | ArrayBuffer | Uint8Array,
  sourceUrl?: string,
): Promise<void> {
  try {
    const cache = await openAudioCache();

    let cacheResponse: Response;
    let cacheUrl: string;

    if (response instanceof Response) {
      // ✅ Déjà une Response — on la stocke directement
      cacheResponse = response.clone();
      // Cloner pour éviter "body already consumed"
      cacheUrl = sourceUrl || response.url;
    } else {
      // ArrayBuffer/Uint8Array → créer une Response
      const arrayBuffer = response instanceof Uint8Array
        ? response.buffer.slice(response.byteOffset, response.byteLength + response.byteOffset) as ArrayBuffer
        : response;
      const blob = new Blob([arrayBuffer]);
      cacheResponse = new Response(blob, {
        headers: { 'Content-Type': 'audio/mpeg' },
      });
      cacheUrl = sourceUrl || `passio-audio://track/${trackId}`;
    }

    await cache.put(cacheUrl, cacheResponse);

    // Sauvegarder le mapping trackId → URL
    setCacheKey(trackId, cacheUrl);

    logger.info('[OfflineCache] ✅ Piste mise en cache:', trackId, `(${(blobSize(response) / 1024).toFixed(0)} Ko)`);
  } catch (err) {
    logger.warn('[OfflineCache] ❌ Échec cache pour', trackId, err);
  }
}

/**
 * Estime la taille d'une Response ou ArrayBuffer (pour le log).
 */
function blobSize(data: Response | ArrayBuffer | Uint8Array): number {
  if (data instanceof Response) {
    const len = data.headers.get('Content-Length');
    return len ? parseInt(len, 10) : 0;
  }
  return data.byteLength;
}

/**
 * Récupère une piste audio depuis le Cache Storage sous forme de Blob URL.
 * Retourne null si non trouvée.
 */
export async function getAudioBlobUrl(trackId: string): Promise<string | null> {
  try {
    const cacheUrl = getCacheKey(trackId);
    if (!cacheUrl) return null;

    const cache = await openAudioCache();
    const cachedResponse = await cache.match(cacheUrl);
    if (!cachedResponse) return null;

    const blob = await cachedResponse.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    logger.warn('[OfflineCache] ❌ Erreur lecture cache pour', trackId, err);
    return null;
  }
}

/**
 * Récupère la Response brute depuis le Cache Storage.
 * Utilisé par le système de lecture pour obtenir les headers originaux.
 */
export async function getAudioResponse(trackId: string): Promise<Response | null> {
  try {
    const cacheUrl = getCacheKey(trackId);
    if (!cacheUrl) return null;

    const cache = await openAudioCache();
    const cachedResponse = await cache.match(cacheUrl);
    return cachedResponse || null;
  } catch {
    return null;
  }
}

/**
 * Vérifie si une piste est disponible dans le Cache Storage.
 */
export async function isAudioInCache(trackId: string): Promise<boolean> {
  try {
    const url = getCacheKey(trackId);
    if (!url) return false;
    const cache = await openAudioCache();
    return await cache.match(url) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Supprime une piste du Cache Storage + nettoie le mapping.
 */
export async function deleteAudioFromCache(trackId: string): Promise<void> {
  try {
    const cacheUrl = getCacheKey(trackId);
    if (cacheUrl) {
      const cache = await openAudioCache();
      await cache.delete(cacheUrl);
    }
    removeCacheKey(trackId);
    logger.info('[OfflineCache] ✅ Piste supprimée du cache:', trackId);
  } catch (err) {
    logger.warn('[OfflineCache] ❌ Erreur suppression cache pour', trackId, err);
  }
}

/**
 * Liste tous les IDs de pistes actuellement dans le Cache Storage.
 */
export async function getAllCachedTrackIds(): Promise<string[]> {
  return getAllTrackIdsFromMap();
}

/**
 * Nettoie TOUT le cache audio (supprime toutes les entrées).
 */
export async function clearAudioCache(): Promise<void> {
  try {
    await caches.delete(AUDIO_CACHE_NAME);
    // Nettoyer les mappings
    const ids = getAllTrackIdsFromMap();
    ids.forEach((id) => removeCacheKey(id));
    logger.info('[OfflineCache] ✅ Cache audio vidé');
  } catch (err) {
    logger.warn('[OfflineCache] ❌ Erreur vidage cache:', err);
  }
}

// ── Migration depuis IndexedDB ─────────────────────────────────────────────

let migrationDone = false;

/**
 * Migre une seule fois les anciennes données d'IndexedDB vers Cache Storage.
 * S'exécute automatiquement au démarrage.
 */
export async function migrateFromIndexedDB(): Promise<number> {
  if (migrationDone) return 0;
  migrationDone = true;

  let migratedCount = 0;

  try {
    const oldTrackIds = await getAllStoredTrackIds();
    if (oldTrackIds.length === 0) return 0;

    logger.info('[OfflineCache] 🔄 Migration IndexedDB → Cache Storage:', oldTrackIds.length, 'piste(s)');

    for (const trackId of oldTrackIds) {
      // Vérifier si déjà migrée (si une clé de mapping existe déjà)
      if (getCacheKey(trackId)) continue;

      const data = await getTrackFromDB(trackId);
      if (!data) continue;

      // Créer un Blob → Response pour le Cache Storage
      const arrayBuffer = data instanceof Uint8Array
        ? data.buffer.slice(data.byteOffset, data.byteLength + data.byteOffset) as ArrayBuffer
        : data;
      const blob = new Blob([arrayBuffer]);
      const response = new Response(blob, {
        headers: { 'Content-Type': 'audio/mpeg' },
      });

      // Stocker dans le Cache Storage
      const syntheticUrl = `passio-audio://track/${trackId}`;
      const cache = await openAudioCache();
      await cache.put(syntheticUrl, response);
      setCacheKey(trackId, syntheticUrl);

      // Supprimer de l'ancienne IndexedDB
      await deleteTrackFromDB(trackId);
      migratedCount++;
    }

    if (migratedCount > 0) {
      logger.info('[OfflineCache] ✅ Migration terminée :', migratedCount, 'piste(s) déplacée(s)');
    }
  } catch (err) {
    logger.warn('[OfflineCache] ❌ Erreur migration:', err);
  }

  return migratedCount;
}

/**
 * Obtient la taille estimée du cache audio.
 */
export async function getAudioCacheSize(): Promise<{ trackCount: number; estimatedBytes: number }> {
  try {
    const cache = await openAudioCache();
    const requests = await cache.keys();
    const trackCount = requests.length;

    // Estimer la taille en sommant les Content-Length
    let estimatedBytes = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const len = response.headers.get('Content-Length');
        if (len) estimatedBytes += parseInt(len, 10);
      }
    }

    return { trackCount, estimatedBytes };
  } catch {
    return { trackCount: 0, estimatedBytes: 0 };
  }
}
