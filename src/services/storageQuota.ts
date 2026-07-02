import { getAllStoredTrackIds, getTrackFromDB } from './indexedDB';
import { getLocalAlbumMetadata } from './downloadManager';
import { logger } from '@/utils/logger';

export interface StorageStats {
  /** Nombre d'albums téléchargés */
  albumCount: number;
  /** Nombre de pistes en cache */
  trackCount: number;
  /** Taille totale estimée en octets */
  usedBytes: number;
  /** Formattage humain (ex: "1.2 Go") */
  usedFormatted: string;
  /** Quota disponible estimé (null si non disponible) */
  availableBytes: number | null;
  /** Quota formaté */
  availableFormatted: string;
  /** Ratio d'utilisation (0..1) */
  usageRatio: number;
}

const DOWNLOAD_QUEUE_PREFIX = 'passio_dl_queue_';

/**
 * Formate des octets en taille lisible.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

/**
 * Estime l'espace de stockage utilisé par les pistes audio en IndexedDB
 * et les métadonnées en localStorage.
 *
 * Utilise `navigator.storage.estimate()` pour le quota navigateur,
 * et échantillonne les pistes pour estimer la taille totale.
 */
export async function getStorageStats(): Promise<StorageStats> {
  let usedBytes = 0;
  let trackCount = 0;
  let availableBytes: number | null = null;

  try {
    // 1. Compter les pistes dans IndexedDB
    const trackIds = await getAllStoredTrackIds();
    trackCount = trackIds.length;

    // 2. Échantillonner : lire la taille des 10 premières + estimer le reste
    const SAMPLE_SIZE = Math.min(10, trackIds.length);
    let sampleBytes = 0;
    let sampleCount = 0;

    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const data = await getTrackFromDB(trackIds[i]);
      if (data) {
        sampleBytes += data instanceof Uint8Array ? data.byteLength : data.byteLength;
        sampleCount++;
      }
    }

    // Si on a des pistes, estimer la taille totale
    if (sampleCount > 0) {
      const avgBytes = sampleBytes / sampleCount;
      usedBytes += avgBytes * trackCount;
    }

    // 3. Ajouter la taille des métadonnées localStorage
    //    (chaque album ~2-5 Ko, on estime 3 Ko par album)
    let albumCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('passio_album_metadata_')) {
        albumCount++;
        const val = localStorage.getItem(key);
        if (val) usedBytes += val.length * 2; // UTF-16 → 2 octets par caractère
      }
    }

    // 4. Récupérer le quota navigateur via StorageManager
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota) {
          availableBytes = estimate.quota - (estimate.usage ?? 0);
          // Ajuster avec notre mesure plus précise
          const totalEstimated = estimate.usage ?? usedBytes;
          if (estimate.usage) usedBytes = estimate.usage;
        }
      }
    } catch {
      // StorageManager non disponible (certains navigateurs)
    }

    // Fallback : quota par défaut si non disponible
    if (availableBytes === null) {
      // La plupart des navigateurs allouent ~50% de l'espace disque
      // Mais on ne peut pas le savoir sans StorageManager
      availableBytes = null;
    }

    // Éviter la division par zéro
    const quota = availableBytes !== null ? usedBytes + availableBytes : 0;
    const usageRatio = availableBytes !== null
      ? Math.min(1, usedBytes / (usedBytes + availableBytes))
      : 0;

    return {
      albumCount,
      trackCount,
      usedBytes: Math.round(usedBytes),
      usedFormatted: formatBytes(usedBytes),
      availableBytes: availableBytes !== null ? Math.round(availableBytes) : null,
      availableFormatted: availableBytes !== null ? formatBytes(availableBytes) : 'N/A',
      usageRatio,
    };
  } catch (err) {
    logger.warn('[StorageQuota] Erreur estimation:', err);
    return {
      albumCount: 0,
      trackCount: 0,
      usedBytes: 0,
      usedFormatted: '0 o',
      availableBytes: null,
      availableFormatted: 'N/A',
      usageRatio: 0,
    };
  }
}

/**
 * Sauvegarde l'état d'avancement d'un téléchargement pour reprise.
 */
export function saveDownloadQueue(
  albumId: string,
  downloadedTrackIds: string[],
  totalTracks: number,
): void {
  try {
    localStorage.setItem(
      DOWNLOAD_QUEUE_PREFIX + albumId,
      JSON.stringify({ downloadedTrackIds, totalTracks, updatedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

/**
 * Récupère l'état d'avancement d'un téléchargement.
 */
export function getDownloadQueue(
  albumId: string,
): { downloadedTrackIds: string[]; totalTracks: number } | null {
  try {
    const raw = localStorage.getItem(DOWNLOAD_QUEUE_PREFIX + albumId);
    if (!raw) return null;
    return JSON.parse(raw) as { downloadedTrackIds: string[]; totalTracks: number };
  } catch {
    return null;
  }
}

/**
 * Supprime l'état d'avancement d'un téléchargement.
 */
export function clearDownloadQueue(albumId: string): void {
  localStorage.removeItem(DOWNLOAD_QUEUE_PREFIX + albumId);
}
