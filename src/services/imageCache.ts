/**
 * imageCache.ts — Cache d'images en IndexedDB
 *
 * Évite de re-télécharger les covers d'albums et photos d'artistes
 * en les stockant dans IndexedDB après le premier chargement.
 */

import { get, set, del, keys } from 'idb-keyval';
import { logger } from '@/utils/logger';

/** Taille maximum du cache en octets (~50 Mo) */
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024;

/** Durée de vie d'une image dans le cache : 7 jours */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  blob: Blob;
  contentType: string;
  cachedAt: number;
  size: number;
}

/**
 * Récupère une image depuis le cache ou la télécharge.
 * Retourne une URL d'objet local (blob URL) qui peut être utilisée comme src d'<img>.
 *
 * @returns {string | null} URL de l'objet blob, ou null si échec.
 */
export async function getCachedImageUrl(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!imageUrl) return null;

  try {
    // 1. Vérifier le cache IndexedDB
    const cacheKey = `passio_img_${hashUrl(imageUrl)}`;
    const existing = await get<CacheEntry>(cacheKey);

    if (existing) {
      const isExpired = Date.now() - existing.cachedAt > CACHE_TTL_MS;

      // Si le cache est valide, retourner un blob URL
      if (!isExpired) {
        return URL.createObjectURL(existing.blob);
      }

      // Sinon, supprimer l'entrée expirée
      await del(cacheKey);
    }

    // 2. Télécharger l'image
    const response = await fetch(imageUrl, {
      signal,
      cache: 'force-cache', // utiliser le cache HTTP navigateur si dispo
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const contentType = response.headers.get('Content-Type') || blob.type || 'image/jpeg';
    const size = blob.size;

    // 3. Stocker dans IndexedDB
    const entry: CacheEntry = { blob, contentType, cachedAt: Date.now(), size };

    // Vérifier la taille totale du cache avant d'ajouter
    await ensureCacheSpace(size);
    await set(cacheKey, entry);

    // 4. Retourner un objet URL local
    return URL.createObjectURL(blob);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    logger.warn('ImageCache', `Échec du cache pour ${imageUrl.slice(0, 60)}`, err);
    return imageUrl; // fallback : retourne l'URL distante
  }
}

/**
 * Hash simple d'une URL pour l'utiliser comme clé de cache.
 */
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Nettoie le cache si la taille totale dépasse MAX_CACHE_SIZE_BYTES.
 * Supprime les entrées les plus anciennes d'abord.
 */
async function ensureCacheSpace(neededSize: number): Promise<void> {
  try {
    const allKeys = await keys();
    const imgKeys = allKeys.filter(
      (k: IDBValidKey) => typeof k === 'string' && k.startsWith('passio_img_'),
    ) as string[];

    if (imgKeys.length === 0) return;

    // Calculer la taille actuelle approximative
    const entries: { key: string; size: number; cachedAt: number }[] = [];

    for (const key of imgKeys) {
      const entry = await get<CacheEntry>(key);
      if (entry) {
        entries.push({ key, size: entry.size, cachedAt: entry.cachedAt });
      }
    }

    const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

    // Si on a assez d'espace, ne rien faire
    if (totalSize + neededSize <= MAX_CACHE_SIZE_BYTES) return;

    // Sinon, supprimer les plus vieilles jusqu'à avoir assez d'espace
    const sorted = entries.sort((a, b) => a.cachedAt - b.cachedAt);
    let freed = 0;

    for (const entry of sorted) {
      if (totalSize - freed + neededSize <= MAX_CACHE_SIZE_BYTES) break;
      await del(entry.key);
      freed += entry.size;
    }
  } catch {
    // Ignorer les erreurs de nettoyage
  }
}

/**
 * Vide tout le cache d'images.
 */
export async function clearImageCache(): Promise<void> {
  try {
    const allKeys = await keys();
    const imgKeys = allKeys.filter(
      (k: IDBValidKey) => typeof k === 'string' && k.startsWith('passio_img_'),
    );
    for (const key of imgKeys) {
      await del(key);
    }
    logger.info('ImageCache', 'Cache vidé avec succès');
  } catch (err) {
    logger.warn('ImageCache', 'Échec du vidage du cache', err);
  }
}

/**
 * Retourne la taille approximative du cache d'images en octets.
 */
export async function getImageCacheSize(): Promise<number> {
  try {
    const allKeys = await keys();
    const imgKeys = allKeys.filter(
      (k: IDBValidKey) => typeof k === 'string' && k.startsWith('passio_img_'),
    ) as string[];

    let total = 0;
    for (const key of imgKeys) {
      const entry = await get<CacheEntry>(key);
      if (entry) total += entry.size;
    }
    return total;
  } catch {
    return 0;
  }
}
