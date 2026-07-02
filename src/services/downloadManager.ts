import { getApiBaseUrl } from './api';
import { getCloudflareAudioUrl } from '@/config/urls';
import { logger } from '@/utils/logger';
import type { PublicAlbumDetails, PublicAlbumSummary, PublicTrack } from '@/types/backend';
import { secureAudioPlayer } from './secureAudioPlayer';
import { saveTrackToDB, isTrackInDB, getTrackFromDB, deleteTrackFromDB } from './indexedDB';
import { saveDownloadQueue, getDownloadQueue, clearDownloadQueue } from './storageQuota';

export type DownloadStatus = 'idle' | 'downloading' | 'completed' | 'error' | 'cancelled';

export interface DownloadProgress {
  albumId: string;
  status: DownloadStatus;
  progress: number;
  downloadedTracks: number;
  totalTracks: number;
  currentTrack?: string;
  error?: string;
}

const downloadState = new Map<string, DownloadProgress>();
type ProgressCallback = (progress: DownloadProgress) => void;
const progressCallbacks = new Map<string, Set<ProgressCallback>>();

// AbortControllers pour permettre l'annulation des téléchargements actifs
const abortControllers = new Map<string, AbortController>();

const PARALLEL_BATCH_SIZE = 2;

/**
 * Annule un téléchargement d'album en cours.
 */
export function cancelDownload(albumId: string): void {
  const controller = abortControllers.get(albumId);
  if (controller) {
    controller.abort();
    abortControllers.delete(albumId);
  }
  downloadState.set(albumId, {
    albumId,
    status: 'idle',
    progress: 0,
    downloadedTracks: 0,
    totalTracks: 0,
  });
  const callbacks = progressCallbacks.get(albumId);
  if (callbacks) {
    callbacks.forEach(cb => cb(downloadState.get(albumId)!));
  }
  clearDownloadQueue(albumId);
  logger.info('[DownloadManager] ⏹ Téléchargement annulé:', albumId);
}

// ── LRU Cache : suivi des accès aux albums pour éviction automatique ──
const LRU_PREFIX = 'passio_lru_access_';

/**
 * Enregistre le moment où un album a été écouté pour la dernière fois.
 * Utilisé par le système LRU pour décider quels albums évincer en priorité.
 */
export function touchAlbumAccess(albumId: string): void {
  try {
    localStorage.setItem(LRU_PREFIX + albumId, String(Date.now()));
  } catch {
    // localStorage peut être plein — on ignore
  }
}

/**
 * Retourne les IDs des albums triés du plus anciennement accédé au plus récent.
 * Seuls les albums encore présents dans le vault sont inclus.
 */
export async function getEvictionCandidates(): Promise<string[]> {
  const vaultIds = new Set((await listVaultAlbums()).map(a => a.id));
  const entries: { albumId: string; lastAccess: number }[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(LRU_PREFIX)) continue;
    const albumId = key.slice(LRU_PREFIX.length);
    if (!vaultIds.has(albumId)) {
      // Nettoyer les entrées orphelines (album supprimé)
      localStorage.removeItem(key);
      continue;
    }
    const raw = localStorage.getItem(key);
    if (raw) {
      entries.push({ albumId, lastAccess: parseInt(raw, 10) || 0 });
    }
  }

  // Trier du plus vieux au plus récent
  entries.sort((a, b) => a.lastAccess - b.lastAccess);
  return entries.map(e => e.albumId);
}

/**
 * Vérifie si le stockage est presque plein et évince les albums les plus anciens
 * jusqu'à ce que l'utilisation repasse sous 70%.
 * 
 * Se déclenche automatiquement avant chaque téléchargement d'album.
 */
export async function evictLRUIfNeeded(): Promise<{ evicted: string[]; freedBytes: number }> {
  const result = { evicted: [] as string[], freedBytes: 0 };

  try {
    // Importer dynamiquement pour éviter la dépendance circulaire
    const { getStorageStats } = await import('./storageQuota');
    const stats = await getStorageStats();

    // Seuil : 90% → déclencher l'éviction
    const EVICT_THRESHOLD = 0.9;
    const SAFE_THRESHOLD = 0.7;

    if (stats.usageRatio < EVICT_THRESHOLD) return result;

    logger.info('[LRU] ⚠️ Stockage à', Math.round(stats.usageRatio * 100), '%, éviction LRU nécessaire');

    const candidates = await getEvictionCandidates();

    for (const albumId of candidates) {
      if (result.evicted.length >= 5) break; // Max 5 albums par éviction

      const metadata = await getLocalAlbumMetadata(albumId);
      const trackCount = metadata?.tracks?.length ?? 0;

      await deleteAlbumOffline(albumId);
      result.evicted.push(albumId);

      // Estimation : ~3 Mo par piste en moyenne
      result.freedBytes += trackCount * 3 * 1024 * 1024;

      // Vérifier si on est revenu sous le seuil de sécurité
      const updatedStats = await getStorageStats();
      if (updatedStats.usageRatio < SAFE_THRESHOLD) break;
    }

    if (result.evicted.length > 0) {
      logger.info('[LRU] ✅ Éviction terminée :', result.evicted.length, 'album(s) supprimé(s)');
    }

    return result;
  } catch (err) {
    logger.warn('[LRU] ❌ Erreur lors de l\'éviction:', err);
    return result;
  }
}

export async function isAlbumReadyOffline(albumId: string): Promise<boolean> {
  try {
    const metadata = localStorage.getItem(`passio_album_metadata_${albumId}`);
    if (!metadata) return false;
    const album = JSON.parse(metadata) as PublicAlbumDetails;
    if (!album.tracks) return false;
    for (const track of album.tracks) {
      const exists = await isTrackInDB(track.id);
      if (!exists) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function getLocalAlbumMetadata(albumId: string): Promise<PublicAlbumDetails | null> {
  try {
    const raw = localStorage.getItem(`passio_album_metadata_${albumId}`);
    if (!raw) return null;
    return JSON.parse(raw) as PublicAlbumDetails;
  } catch {
    return null;
  }
}

export async function getLocalEncryptedTrackUri(trackId: string): Promise<string | null> {
  try {
    const data = localStorage.getItem(`passio_track_${trackId}`);
    return data ? `data:audio/mp4;base64,${data}` : null;
  } catch {
    return null;
  }
}

export function getLocalLyricsPath(trackId: string): string {
  return `passio_lyrics_${trackId}`;
}

export async function readLocalLyricsForTrack(trackId: string): Promise<string | null> {
  try {
    return localStorage.getItem(`passio_lyrics_${trackId}`);
  } catch {
    return null;
  }
}

export async function listVaultAlbums(): Promise<PublicAlbumSummary[]> {
  const albums: PublicAlbumSummary[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('passio_album_metadata_')) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const metadata = JSON.parse(raw) as PublicAlbumDetails;
        albums.push({
          id: metadata.id,
          artist_id: metadata.artist_id,
          title: metadata.title,
          description: metadata.description,
          price_ariary: metadata.price_ariary ?? 0,
          cover_url: metadata.cover_url,
          status: metadata.status,
          is_free: metadata.is_free,
          type: metadata.type,
          stream_status: metadata.stream_status,
          stream_url: metadata.stream_url,
          artist_name: metadata.artist_name ?? metadata.artist?.name,
          artist_pdp: metadata.artist_pdp ?? metadata.artist?.profile_picture_url,
          artist: metadata.artist,
          artists: metadata.artists,
          created_at: metadata.created_at,
          updated_at: metadata.updated_at,
        });
      } catch { continue; }
    }
  }
  return albums.sort((a, b) => {
    const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return dateB - dateA;
  });
}

/**
 * Supprime toutes les données offline d'un album : métadonnées, clé, tracks, queue.
 */
export async function deleteAlbumOffline(albumId: string): Promise<boolean> {
  try {
    const metadata = await getLocalAlbumMetadata(albumId);
    if (metadata?.tracks) {
      for (const track of metadata.tracks) {
        await deleteTrackFromDB(track.id);
      }
    }
    localStorage.removeItem(`passio_album_metadata_${albumId}`);
    localStorage.removeItem(`passio_key_${albumId}`);
    clearDownloadQueue(albumId);
    logger.info('[DeleteOffline] ✅ Album supprimé:', albumId);
    return true;
  } catch (err) {
    logger.warn('[DeleteOffline] ❌ Erreur suppression:', albumId, err);
    return false;
  }
}

/**
 * Supprime TOUS les albums offline.
 */
export async function deleteAllOffline(): Promise<boolean> {
  try {
    const albums = await listVaultAlbums();
    for (const album of albums) {
      await deleteAlbumOffline(album.id);
    }
    // Nettoyage supplémentaire : forcer l'itération de toutes les clés
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key?.startsWith('passio_album_metadata_') ||
        key?.startsWith('passio_key_') ||
        key?.startsWith('passio_dl_queue_') ||
        key?.startsWith('passio_lyrics_')
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    logger.info('[DeleteOffline] ✅ Tous les albums offline supprimés');
    return true;
  } catch (err) {
    logger.warn('[DeleteOffline] ❌ Erreur suppression totale:', err);
    return false;
  }
}

/**
 * Télécharge et met en cache une piste gratuite dans IndexedDB.
 * Évite de re-télécharger le même fichier audio à chaque écoute.
 * Utilise un fetch + ArrayBuffer pour sauvegarder dans le DB.
 */
export async function cacheFreeTrack(
  trackId: string,
  audioUrl: string,
): Promise<boolean> {
  try {
    const alreadyCached = await isTrackInDB(trackId);
    if (alreadyCached) return true;

    const response = await fetch(audioUrl);
    if (!response.ok) {
      logger.warn('[CacheFreeTrack] ⚠️ HTTP', response.status, 'pour', trackId);
      return false;
    }

    const buffer = await response.arrayBuffer();
    await saveTrackToDB(trackId, new Uint8Array(buffer));
    logger.info('[CacheFreeTrack] ✅ Piste gratuite mise en cache:', trackId, `(${(buffer.byteLength / 1024).toFixed(0)} Ko)`);
    return true;
  } catch (err) {
    logger.warn('[CacheFreeTrack] ❌ Échec cache pour', trackId, err);
    return false;
  }
}

/**
 * Récupère une piste gratuite depuis le cache IndexedDB sous forme de Blob URL.
 * Retourne null si non trouvée.
 */
export async function getCachedFreeTrackUrl(trackId: string): Promise<string | null> {
  try {
    const exists = await isTrackInDB(trackId);
    if (!exists) return null;

    const data = await getTrackFromDB(trackId);
    if (!data) return null;

    // Convertir en ArrayBuffer pour Blob (gère Uint8Array<ArrayBufferLike>)
    const buffer = data instanceof Uint8Array ? data.buffer as ArrayBuffer : data;
    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);
    return url;
  } catch (err) {
    logger.warn('[CacheFreeTrack] ❌ Erreur lecture cache pour', trackId, err);
    return null;
  }
}

export function subscribeToDownloadProgress(albumId: string, callback: ProgressCallback): () => void {
  if (!progressCallbacks.has(albumId)) progressCallbacks.set(albumId, new Set());
  progressCallbacks.get(albumId)!.add(callback);
  return () => {
    const callbacks = progressCallbacks.get(albumId);
    if (callbacks) { callbacks.delete(callback); if (callbacks.size === 0) progressCallbacks.delete(albumId); }
  };
}

export function getDownloadProgress(albumId: string): DownloadProgress | undefined {
  return downloadState.get(albumId);
}

export async function downloadAlbumWithStreaming(
  album: PublicAlbumDetails,
  decryptionKey: string | null,
  onTrackReady?: (track: PublicTrack, index: number) => void,
): Promise<DownloadStatus> {
  const albumId = album.id;
  const tracks = album.tracks ?? [];
  if (tracks.length === 0) return 'error';    // ⚡ Éviction LRU : libérer de l'espace si nécessaire
  await evictLRUIfNeeded();

  // ⚡ Vérifier s'il y a une queue de téléchargement en cours (reprise)
  const savedQueue = getDownloadQueue(albumId);
  const alreadyDownloaded = new Set<string>(savedQueue?.downloadedTrackIds ?? []);

  downloadState.set(albumId, {
    albumId,
    status: 'downloading',
    progress: 0,
    downloadedTracks: alreadyDownloaded.size,
    totalTracks: tracks.length,
  });

  // Sauvegarder les métadonnées même si la reprise est partielle
  localStorage.setItem(`passio_album_metadata_${albumId}`, JSON.stringify(album));
  if (decryptionKey) localStorage.setItem(`passio_key_${albumId}`, decryptionKey);

  // ⚡ Créer un AbortController pour ce téléchargement
  const abortController = new AbortController();
  abortControllers.set(albumId, abortController);
  const signal = abortController.signal;

  const isFreeAlbum = Boolean(album.is_free);

  try {
    let completedTracks = alreadyDownloaded.size;
    const downloadedIds = new Set(alreadyDownloaded);

    // Fonction utilitaire pour télécharger une piste individuelle
    async function downloadSingleTrack(track: PublicTrack, trackIndex: number): Promise<boolean> {
      if (signal.aborted) return false;

      // ⚡ Skiper si déjà téléchargé (vérification rapide)
      if (alreadyDownloaded.has(track.id) || downloadedIds.has(track.id)) return true;

      // ⚡ Vérifier dans IndexedDB
      const existingInDB = await isTrackInDB(track.id);
      if (existingInDB) {
        downloadedIds.add(track.id);
        return true;
      }

      // ⚡ Mettre à jour le currentTrack dans le state
      const progressUpdate = downloadState.get(albumId);
      if (progressUpdate) {
        progressUpdate.currentTrack = track.title;
        downloadState.set(albumId, { ...progressUpdate });
      }

      let downloaded = false;
      let retries = 0;
      const MAX_RETRIES = 3;

      while (!downloaded && retries < MAX_RETRIES && !signal.aborted) {
        try {
          let trackData: Uint8Array;

          if (isFreeAlbum) {
            // 🚀 Piste gratuite → téléchargement direct Cloudflare CDN
            const cfUrl = getCloudflareAudioUrl(track.audio_storage_key || '');
            const directUrl = cfUrl || track.encrypted_audio_url || track.preview_url;
            if (directUrl) {
              const response = await fetch(directUrl, { signal });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const buffer = await response.arrayBuffer();
              trackData = new Uint8Array(buffer);
            } else {
              throw new Error('Aucune URL CDN disponible');
            }
          } else {
            // 🔒 Piste payante → proxy backend avec XOR sécurisé
            // Récupérer un token audio avant le téléchargement
            await secureAudioPlayer.fetchToken(track.id);
            secureAudioPlayer.currentTrackId = track.id;
            const proxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(track.id)}/audio`;
            trackData = await secureAudioPlayer.downloadInChunks(proxyUrl, undefined, undefined, signal);
          }

          await saveTrackToDB(track.id, trackData);
          downloaded = true;
        } catch (err: any) {
          if (err.name === 'AbortError' || signal.aborted) {
            return false;
          }
          retries++;
          if (retries >= MAX_RETRIES) {
            logger.warn('DownloadManager', `Failed to download track ${track.id} after ${MAX_RETRIES} retries`, err);
            return false;
          }
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries - 1)));
        }
      }

      return downloaded;
    }

    // Traiter les pistes par lots parallèles
    for (let i = 0; i < tracks.length; i += PARALLEL_BATCH_SIZE) {
      if (signal.aborted) {
        return 'cancelled';
      }

      const batch = tracks.slice(i, i + PARALLEL_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((track, batchIdx) => downloadSingleTrack(track, i + batchIdx)),
      );

      for (let j = 0; j < batch.length; j++) {
        if (signal.aborted) {
          return 'cancelled';
        }

        const track = batch[j];
        const success = batchResults[j];

        if (alreadyDownloaded.has(track.id)) continue;
        if (downloadedIds.has(track.id)) continue;

        if (success) {
          downloadedIds.add(track.id);
          completedTracks++;
          saveDownloadQueue(albumId, Array.from(downloadedIds), tracks.length);
          if (onTrackReady) onTrackReady(track, i + j);
        }
      }

      // Mettre à jour le state après chaque lot
      downloadState.set(albumId, {
        albumId,
        status: 'downloading',
        progress: (completedTracks / tracks.length) * 100,
        downloadedTracks: completedTracks,
        totalTracks: tracks.length,
        currentTrack: batch[batch.length - 1]?.title,
      });
      // Notifier les subscribers
      const callbacks = progressCallbacks.get(albumId);
      if (callbacks) {
        callbacks.forEach(cb => cb(downloadState.get(albumId)!));
      }
    }

    // ✅ Nettoyer la queue de téléchargement
    clearDownloadQueue(albumId);
    downloadState.set(albumId, { albumId, status: 'completed', progress: 100, downloadedTracks: tracks.length, totalTracks: tracks.length });
    logger.info('[DownloadManager] ✅ Album téléchargé:', albumId);
    return 'completed';
  } catch (error) {
    // Si l'erreur vient d'un abort volontaire, ne pas polluer l'état
    if ((error as Error)?.name === 'AbortError') return 'cancelled';
    logger.error('DownloadManager', 'Erreur téléchargement album', error);
    downloadState.set(albumId, { albumId, status: 'error', progress: 0, downloadedTracks: 0, totalTracks: tracks.length, error: error instanceof Error ? error.message : String(error) });
    return 'error';
  }
}
