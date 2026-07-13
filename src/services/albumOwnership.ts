import { getAlbum, getAlbumDecryptionKey, listOwnedAlbums, refreshAlbumTracks, unwrapAlbumDetails } from '@/services/api';
import { readEncryptedValue, saveEncryptedValue } from '@/services/storage';
import { persistVaultDecryptionKey } from '@/services/vault';
import { logger } from '@/utils/logger';
import type { PublicAlbumDetails } from '@/types/backend';

const ACTIVATION_SNAPSHOT_KEY_PREFIX = 'album_snap_';

export function isRestrictedAlbumPayload(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && 'message' in raw && 'album' in raw && (raw as { album?: unknown }).album);
}

export function albumHasStreamableTracks(album: PublicAlbumDetails): boolean {
  return Boolean(album.tracks?.some((t) => t.encrypted_audio_url || t.preview_url || t.stream_url));
}

export async function saveActivationSnapshot(album: PublicAlbumDetails, decryptionKey: string | null): Promise<void> {
  try {
    const payload = { album, decryption_key: decryptionKey, saved_at: new Date().toISOString() };
    await saveEncryptedValue(ACTIVATION_SNAPSHOT_KEY_PREFIX + album.id, JSON.stringify(payload));
  } catch (error) {
    logger.warn('Failed to save activation snapshot:', error);
  }
}

const LEGACY_SNAPSHOT_PREFIX = 'passio_album_snap_';

export async function readActivationSnapshot(albumId: string): Promise<{ album: PublicAlbumDetails; decryption_key: string | null } | null> {
  try {
    // 1. Nouveau format (chiffré)
    const raw = await readEncryptedValue(ACTIVATION_SNAPSHOT_KEY_PREFIX + albumId);
    if (raw) {
      const parsed = JSON.parse(raw) as { album: PublicAlbumDetails; decryption_key?: string | null };
      if (parsed?.album?.id) return { album: parsed.album, decryption_key: parsed.decryption_key ?? null };
    }
    // 2. Fallback : ancien format (clair) — migration silencieuse
    const legacyRaw = localStorage.getItem(LEGACY_SNAPSHOT_PREFIX + albumId);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as { album: PublicAlbumDetails; decryption_key?: string | null };
      if (parsed?.album?.id) {
        // Re-sauvegarde chiffrée + nettoyage
        const payload = { album: parsed.album, decryption_key: parsed.decryption_key ?? null, saved_at: new Date().toISOString() };
        await saveEncryptedValue(ACTIVATION_SNAPSHOT_KEY_PREFIX + albumId, JSON.stringify(payload));
        localStorage.removeItem(LEGACY_SNAPSHOT_PREFIX + albumId);
        return { album: parsed.album, decryption_key: parsed.decryption_key ?? null };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveAlbumDecryptionKey(albumId: string, hint?: string | null): Promise<string | null> {
  if (hint) {
    await persistVaultDecryptionKey(albumId, hint);
    return hint;
  }
  const stored = await readEncryptedValue(`passio_key_${albumId}`);
  if (stored) {
    // ⚡ Migrer silencieusement vers le nouveau format enrichi
    // (fire & forget — ne bloque pas)
    persistVaultDecryptionKey(albumId, stored);
    return stored;
  }
  try {
    const { decryption_key } = await getAlbumDecryptionKey(albumId);
    if (decryption_key) {
      await persistVaultDecryptionKey(albumId, decryption_key);
      return decryption_key;
    }
  } catch { /* ignore */ }
  return null;
}

let ownedAlbumsListCache: { albums: { id: string }[]; timestamp: number } | null = null;
const OWNED_CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Vérifie si l'appareil possède un album.
 *
 * ⚡ Optimisé pour éviter les 403 en cascade :
 * 1. Vérifie le stockage local (instantané)
 * 2. Appelle listOwnedAlbums() UNE SEULE FOIS (avec cache de 1 min)
 * 3. En dernier recours, tente getAlbumDecryptionKey (pour confirmer les cas limites)
 *
 * Avant : N appels à /api/albums/:id/key → N erreurs 403 pour les albums non possédés
 * Après : 1 appel à /api/albums/owned → 0 erreur 403
 */
export async function isAlbumOwnedByDevice(albumId: string): Promise<boolean> {
  // 1. Vérification locale (instantanée, zéro réseau)
  const localKey = await readEncryptedValue(`passio_key_${albumId}`);
  if (localKey) return true;

  // 2. Cache des albums possédés (un seul appel réseau, avec cache)
  //    Si listOwnedAlbums réussit, on SE FIE à son résultat (pas de 403 supplémentaire)
  try {
    if (!ownedAlbumsListCache || Date.now() - ownedAlbumsListCache.timestamp > OWNED_CACHE_TTL_MS) {
      const albums = await listOwnedAlbums();
      ownedAlbumsListCache = { albums, timestamp: Date.now() };
    }
    return ownedAlbumsListCache.albums.some((a) => a.id === albumId);
  } catch { /* cache failed, fallthrough */ }

  // ❌ Plus de fallback vers getAlbumDecryptionKey ici — cela provoquait
  //    systématiquement un 403 pour les albums que le device ne possède PAS.
  //    Si listOwnedAlbums a échoué, on considère que l'album n'est pas possédé
  //    (la lecture échouera avec un message clair le moment venu).
  return false;
}

/**
 * Vide le cache des albums possédés (à appeler après activation/désactivation).
 */
export function clearOwnedAlbumsCache() {
  ownedAlbumsListCache = null;
}

export async function loadOwnedAlbumForPlayback(albumId: string): Promise<{
  album: PublicAlbumDetails; decryptionKey: string | null; ownedByDevice: boolean;
}> {
  const snapshot = await readActivationSnapshot(albumId);
  const raw = await getAlbum(albumId);
  let album = unwrapAlbumDetails(raw);
  let restricted = isRestrictedAlbumPayload(raw);

  if (snapshot && (restricted || !albumHasStreamableTracks(album))) {
    album = snapshot.album;
    restricted = false;
  }

  let keyHint = (raw as PublicAlbumDetails & { decryption_key?: string }).decryption_key ?? snapshot?.decryption_key ?? null;
  let key = await resolveAlbumDecryptionKey(albumId, keyHint);
  let owned = !restricted || Boolean(key);

  if (!owned) owned = await isAlbumOwnedByDevice(albumId);

  if (owned && (restricted || !albumHasStreamableTracks(album))) {
    try {
      const refreshed = await refreshAlbumTracks(albumId);
      if (!isRestrictedAlbumPayload(refreshed)) {
        album = unwrapAlbumDetails(refreshed);
        keyHint = (refreshed as PublicAlbumDetails & { decryption_key?: string }).decryption_key ?? keyHint;
        key = await resolveAlbumDecryptionKey(albumId, keyHint);
      }
    } catch { /* keep current */ }
  }

  if (snapshot && !albumHasStreamableTracks(album) && albumHasStreamableTracks(snapshot.album)) {
    album = snapshot.album;
  }

  if (key && album.id) await saveActivationSnapshot(album, key);

  return { album, decryptionKey: key, ownedByDevice: owned };
}
