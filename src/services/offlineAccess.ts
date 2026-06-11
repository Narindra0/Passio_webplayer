import { readVaultDecryptionKey, vaultHasCredentials } from '@/services/vault';
import type { PublicAlbumDetails } from '@/types/backend';

export type OfflinePlaybackInfo = {
  ready: boolean;
  metadata: PublicAlbumDetails | null;
  decryptionKey: string | null;
};

export async function resolveOfflinePlayback(albumId: string): Promise<OfflinePlaybackInfo> {
  // Web: check localStorage for cached metadata
  try {
    const metadataRaw = localStorage.getItem(`passio_album_metadata_${albumId}`);
    const metadata = metadataRaw ? JSON.parse(metadataRaw) as PublicAlbumDetails : null;
    const hasCredentials = await vaultHasCredentials(albumId);

    if (!metadata || !hasCredentials) {
      return { ready: false, metadata: metadata ?? null, decryptionKey: null };
    }

    const decryptionKey = await readVaultDecryptionKey(albumId);
    return { ready: true, metadata, decryptionKey };
  } catch {
    return { ready: false, metadata: null, decryptionKey: null };
  }
}

export async function readLocalDecryptionKey(albumId: string): Promise<string | null> {
  return readVaultDecryptionKey(albumId);
}
