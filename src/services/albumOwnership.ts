import { getAlbum, getAlbumDecryptionKey, listOwnedAlbums, refreshAlbumTracks, unwrapAlbumDetails } from '@/services/api';
import { readEncryptedValue, saveEncryptedValue } from '@/services/storage';
import type { PublicAlbumDetails } from '@/types/backend';

const ACTIVATION_SNAPSHOT_PREFIX = 'passio_album_snap_';

export function isRestrictedAlbumPayload(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && 'message' in raw && 'album' in raw && (raw as { album?: unknown }).album);
}

export function albumHasStreamableTracks(album: PublicAlbumDetails): boolean {
  return Boolean(album.tracks?.some((t) => t.encrypted_audio_url || t.preview_url || t.stream_url));
}

export async function saveActivationSnapshot(album: PublicAlbumDetails, decryptionKey: string | null): Promise<void> {
  try {
    const payload = { album, decryption_key: decryptionKey, saved_at: new Date().toISOString() };
    localStorage.setItem(ACTIVATION_SNAPSHOT_PREFIX + album.id, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to save activation snapshot:', error);
  }
}

export async function readActivationSnapshot(albumId: string): Promise<{ album: PublicAlbumDetails; decryption_key: string | null } | null> {
  try {
    const raw = localStorage.getItem(ACTIVATION_SNAPSHOT_PREFIX + albumId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { album: PublicAlbumDetails; decryption_key?: string | null };
    if (!parsed?.album?.id) return null;
    return { album: parsed.album, decryption_key: parsed.decryption_key ?? null };
  } catch {
    return null;
  }
}

export async function resolveAlbumDecryptionKey(albumId: string, hint?: string | null): Promise<string | null> {
  if (hint) {
    await saveEncryptedValue(`passio_key_${albumId}`, hint);
    return hint;
  }
  const stored = await readEncryptedValue(`passio_key_${albumId}`);
  if (stored) return stored;
  try {
    const { decryption_key } = await getAlbumDecryptionKey(albumId);
    if (decryption_key) {
      await saveEncryptedValue(`passio_key_${albumId}`, decryption_key);
      return decryption_key;
    }
  } catch { /* ignore */ }
  return null;
}

export async function isAlbumOwnedByDevice(albumId: string): Promise<boolean> {
  const localKey = await readEncryptedValue(`passio_key_${albumId}`);
  if (localKey) return true;
  try { await getAlbumDecryptionKey(albumId); return true; } catch { /* ignore */ }
  try { const owned = await listOwnedAlbums(); return owned.some((a) => a.id === albumId); } catch { return false; }
}

export async function loadOwnedAlbumForPlayback(albumId: string): Promise<{
  album: PublicAlbumDetails; decryptionKey: string | null; ownedByDevice: boolean;
}> {
  const snapshot = await readActivationSnapshot(albumId);
  let raw = await getAlbum(albumId);
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
