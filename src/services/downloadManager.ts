import { getApiBaseUrl } from './api';
import { logger } from '@/utils/logger';
import type { PublicAlbumDetails, PublicAlbumSummary, PublicTrack } from '@/types/backend';
import { secureAudioPlayer } from './secureAudioPlayer';
import { saveTrackToDB, isTrackInDB } from './indexedDB';

export type DownloadStatus = 'idle' | 'downloading' | 'completed' | 'error';

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
  downloadState.set(albumId, { albumId, status: 'downloading', progress: 0, downloadedTracks: 0, totalTracks: album.tracks?.length ?? 0 });

  try {
    const tracks = album.tracks ?? [];
    if (tracks.length === 0) throw new Error('Aucune piste à télécharger.');

    localStorage.setItem(`passio_album_metadata_${albumId}`, JSON.stringify(album));
    if (decryptionKey) localStorage.setItem(`passio_key_${albumId}`, decryptionKey);

    let completedTracks = 0;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const existing = await isTrackInDB(track.id);
      if (!existing) {
        // Try to fetch the track data via secure chunking
        try {
          const proxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(track.id)}/audio`;
          const chunkedData = await secureAudioPlayer.downloadInChunks(proxyUrl);
          await saveTrackToDB(track.id, chunkedData);
        } catch (err) {
          logger.warn('DownloadManager', `Failed to download track ${track.id}`, err);
        }
      }
      completedTracks += 1;
      if (onTrackReady) onTrackReady(track, i);
      downloadState.set(albumId, { albumId, status: 'downloading', progress: ((i + 1) / tracks.length) * 100, downloadedTracks: completedTracks, totalTracks: tracks.length });
    }

    downloadState.set(albumId, { albumId, status: 'completed', progress: 100, downloadedTracks: tracks.length, totalTracks: tracks.length });
    return 'completed';
  } catch (error) {
    logger.error('DownloadManager', 'Erreur téléchargement album', error);
    downloadState.set(albumId, { albumId, status: 'error', progress: 0, downloadedTracks: 0, totalTracks: album.tracks?.length ?? 0, error: error instanceof Error ? error.message : String(error) });
    return 'error';
  }
}
