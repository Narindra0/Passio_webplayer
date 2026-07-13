// SVG placeholder fallback (gris neutre avec une icône simple)
const FALLBACK_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="%23ccc" stroke="%23999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';

export function getOptimizedImageUrl(url: string | null | undefined): string {
  if (!url) return FALLBACK_IMAGE;

  // Optimisation Cloudinary si l'URL vient de Cloudinary et n'a pas déjà été optimisée
  let optimizedUrl = url;
  if (optimizedUrl.includes('res.cloudinary.com')) {
    if (!optimizedUrl.includes('f_auto') && optimizedUrl.includes('/upload/')) {
      optimizedUrl = optimizedUrl.replace('/upload/', '/upload/f_auto,q_auto/');
    }
    
    // Proxy wsrv.nl pour mettre en cache l'image et contourner le quota Cloudinary
    // On nettoie l'URL pour wsrv.nl (enlever https://)
    const cleanUrl = optimizedUrl.replace(/^https?:\/\//, '');
    return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp&we`;
  }

  return optimizedUrl;
}

export function handleImageError(e: React.SyntheticEvent<HTMLImageElement, Event>) {
  const target = e.target as HTMLImageElement;
  if (target.src !== FALLBACK_IMAGE) {
    target.src = FALLBACK_IMAGE;
  }
}
