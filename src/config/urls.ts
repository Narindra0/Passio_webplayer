const DEFAULT_PURCHASE_BASE_URL = 'https://passiio.shop';

/** URL d'achat d'un album sur la boutique fan (passiio.shop/album/:id). */
export function getPurchaseAlbumUrl(albumId: string): string {
  const base = (
    import.meta.env.VITE_PURCHASE_BASE_URL ?? DEFAULT_PURCHASE_BASE_URL
  ).replace(/\/+$/, '');
  const albumBase = base.endsWith('/album') ? base : `${base}/album`;
  return `${albumBase}/${encodeURIComponent(albumId)}`;
}
