// SVG placeholder fallback (gris neutre avec une icône simple)
const FALLBACK_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="%23ccc" stroke="%23999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';

/**
 * Identifiant du compte ImageKit utilisé pour construire les URLs.
 * Visible dans l'URL : ik.imagekit.io/{IMAGEKIT_ID}/...
 * Surchargeable via VITE_IMAGEKIT_ID dans l'environnement.
 */
const IMAGEKIT_ID = import.meta.env.VITE_IMAGEKIT_ID ?? 'a6ywpqgqor';

/**
 * Convertit une URL Cloudinary en URL ImageKit en extrayant le nom de fichier.
 *
 * Les images ont été migrées de Cloudinary vers ImageKit avec conservation
 * du nom de fichier. La structure diffère entre les deux services :
 *
 * Cloudinary : res.cloudinary.com/{cloud}/image/upload/{transform}/v{TIMESTAMP}/{folder}/{subfolder}/{filename}
 * ImageKit   : ik.imagekit.io/{IMAGEKIT_ID}/{folder}/{filename}?tr=f-auto,q-auto
 *
 * Exemple :
 *   Cloudinary : res.cloudinary.com/dv00yefcq/image/upload/f_auto,q_auto/v1778487893/Covers/artist-xxx/cover-mp0xrsat.jpg
 *   ImageKit   : ik.imagekit.io/a6ywpqgqor/Covers/cover-mp0xrsat.jpg?tr=f-auto,q-auto
 *
 * ⚡ Si l'extraction échoue, retourne le SVG placeholder directement
 *    (plus de fallback vers Cloudinary qui retourne des 401).
 */
export function cloudinaryToImageKitUrl(cloudinaryUrl: string): string {
  try {
    // Extraire le nom de fichier via regex, plus robuste que full URL parsing
    // Pattern : capture le dernier segment après le dernier / (avant ?) 
    const filenameMatch = cloudinaryUrl.match(/\/([^/?]+)(?:\?|$)/);
    const filename = filenameMatch ? filenameMatch[1] : null;
    
    if (!filename) {
      // Pas de filename trouvé → SVG placeholder (Cloudinary est décommissionné)
      return FALLBACK_IMAGE;
    }
    
    // Construire l'URL ImageKit avec le bon ID et le dossier Covers/
    return `https://ik.imagekit.io/${IMAGEKIT_ID}/Covers/${filename}?tr=f-auto,q-auto`;
  } catch {
    // Fallback extrême : SVG placeholder (Cloudinary est décommissionné)
    return FALLBACK_IMAGE;
  }
}

/**
 * Vérifie si une URL de photo de profil est valide.
 * 
 * Certaines photos de profil retournées par l'API sont en réalité des images
 * de couverture (dossier "Covers" sur ImageKit) qui ne sont pas de vraies
 * photos de profil. Les vraies photos de profil sont stockées dans le dossier
 * "ProfilePic".
 * 
 * Exemple d'URL invalide :
 *   https://ik.imagekit.io/a6ywpqgqor/Covers/profile-picture.jpg?tr=f-auto,q-auto
 * 
 * Exemple d'URL valide :
 *   https://ik.imagekit.io/a6ywpqgqor/ProfilePic/profile_47ymuzP0b.jpg
 * 
 * @returns true si l'URL est une vraie photo de profil, false sinon
 */
export function isValidProfilePicture(url: string | null | undefined): boolean {
  if (!url) return false;
  // Si l'URL pointe vers le dossier "Covers" sur ImageKit, ce n'est pas une vraie photo de profil
  if (url.includes('ik.imagekit.io') && url.includes('/Covers/')) {
    return false;
  }
  return true;
}

export function getOptimizedImageUrl(url: string | null | undefined): string {
  if (!url) return FALLBACK_IMAGE;

  let optimizedUrl = url;

  // ── DÉJÀ un proxy wsrv.nl → ne pas retransformer ──
  // Évite le double-wrap quand useCachedImage (qui appelle déjà getOptimizedImageUrl)
  // est combiné avec un appel explicite dans le composant.
  if (optimizedUrl.includes('wsrv.nl')) {
    return optimizedUrl;
  }

  // ── Cloudinary → ImageKit direct (les images ont été migrées) ──
  // Au lieu de passer par wsrv.nl qui échoue (Cloudinary ne sert plus les images),
  // on extrait le nom de fichier et on construit l'URL ImageKit correcte.
  if (optimizedUrl.includes('res.cloudinary.com')) {
    return cloudinaryToImageKitUrl(optimizedUrl);
  }

  // ── ImageKit : transformations auto ──
  if (optimizedUrl.includes('ik.imagekit.io')) {
    // Ajouter les transformations auto si pas déjà présentes
    if (!optimizedUrl.includes('tr=f-auto')) {
      const separator = optimizedUrl.includes('?') ? '&' : '?';
      optimizedUrl += `${separator}tr=f-auto,q-auto`;
    }
    return optimizedUrl;
  }

  return optimizedUrl;
}

/**
 * Gère les erreurs de chargement d'images.
 * 
 * ⚡ Cloudinary n'est plus utilisé — toutes les images sont servies via ImageKit.
 *    Plus de fallback vers Cloudinary pour éviter les erreurs 401 qui saturent les logs.
 *    En cas d'échec ImageKit → SVG placeholder directement.
 */
export function handleImageError(e: React.SyntheticEvent<HTMLImageElement, Event>) {
  const target = e.target as HTMLImageElement;
  // Afficher directement le SVG placeholder sans tentative de fallback
  target.src = FALLBACK_IMAGE;
}
