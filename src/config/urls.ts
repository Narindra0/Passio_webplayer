const DEFAULT_PURCHASE_BASE_URL = 'https://passiio.shop';
const DEFAULT_CLOUDFLARE_AUDIO_BASE_URL = 'https://api.passiio.shop/audio';

/** URL d'achat d'un album sur la boutique fan (passiio.shop/album/:id). */
export function getPurchaseAlbumUrl(albumId: string): string {
  const base = (
    import.meta.env.VITE_PURCHASE_BASE_URL ?? DEFAULT_PURCHASE_BASE_URL
  ).replace(/\/+$/, '');
  const albumBase = base.endsWith('/album') ? base : `${base}/album`;
  return `${albumBase}/${encodeURIComponent(albumId)}`;
}

/** URL de base pour les fichiers audio via Cloudflare CDN. */
export function getCloudflareAudioBaseUrl(): string {
  return (import.meta.env.VITE_CLOUDFLARE_AUDIO_BASE_URL ?? DEFAULT_CLOUDFLARE_AUDIO_BASE_URL).replace(/\/+$/, '');
}

/** Génère une URL Cloudflare pour un fichier audio à partir de sa storage key. */
export function getCloudflareAudioUrl(storageKey: string): string | null {
  if (!storageKey) return null;
  const baseUrl = getCloudflareAudioBaseUrl();
  // Encode les segments individuels pour préserver les slashes
  const encodedKey = storageKey.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/${encodedKey}`;
}
