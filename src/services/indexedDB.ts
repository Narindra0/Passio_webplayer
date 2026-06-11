import { set, get, del, keys } from 'idb-keyval';

/**
 * Sauvegarde un fichier audio binaire (ArrayBuffer) dans IndexedDB.
 */
export async function saveTrackToDB(trackId: string, data: ArrayBuffer | Uint8Array): Promise<void> {
  await set(`passio_track_bin_${trackId}`, data);
}

/**
 * Récupère un fichier audio binaire (ArrayBuffer) depuis IndexedDB.
 */
export async function getTrackFromDB(trackId: string): Promise<ArrayBuffer | Uint8Array | undefined> {
  return await get(`passio_track_bin_${trackId}`);
}

/**
 * Supprime un fichier audio de IndexedDB.
 */
export async function deleteTrackFromDB(trackId: string): Promise<void> {
  await del(`passio_track_bin_${trackId}`);
}

/**
 * Vérifie si un titre est disponible dans IndexedDB.
 */
export async function isTrackInDB(trackId: string): Promise<boolean> {
  const data = await get(`passio_track_bin_${trackId}`);
  return data !== undefined;
}

/**
 * Récupère tous les IDs de tracks stockés.
 */
export async function getAllStoredTrackIds(): Promise<string[]> {
  const allKeys = await keys();
  return allKeys
    .filter((k: IDBValidKey) => typeof k === 'string' && k.startsWith('passio_track_bin_'))
    .map((k: IDBValidKey) => (k as string).replace('passio_track_bin_', ''));
}
