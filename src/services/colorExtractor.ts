import { getColor, getPalette, getSwatches } from 'colorthief';

const colorCache = new Map<string, ExtractedColors>();

/**
 * Charge une image en mémoire pour l'extraction des couleurs.
 * ⚡ Cloudinary n'est plus utilisé — les URLs sont déjà converties
 *    en ImageKit avant d'arriver ici (via getOptimizedImageUrl).
 *    Plus de fallback vers Cloudinary pour éviter les erreurs 401.
 */
function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = imageUrl;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${imageUrl}`));
  });
}

export interface ExtractedColors {
  dominant: string;       // hex — main color
  vibrant: string;        // hex — vibrant variant
  muted: string;          // hex — muted variant
  darkMuted: string;      // hex — dark muted for deep gradients
  lightVibrant: string;   // hex — light variant for gradients
  isDark: boolean;        // whether dominant is dark (for text contrast)
  contrastWhite: number;  // WCAG contrast ratio against white
  contrastBlack: number;  // WCAG contrast ratio against black
}

/**
 * Convertit une composante sRGB 8-bit en valeur linéaire (norme WCAG).
 * La correction gamma est essentielle pour évaluer correctement
 * la luminance perçue des couleurs, notamment les bleus et les rouges.
 *
 * Voir https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function srgbToLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045
    ? s / 12.92
    : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Calcule la luminance relative WCAG d'une couleur hexadécimale.
 * Retourne une valeur entre 0 (noir) et 1 (blanc).
 */
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/**
 * Calcule le ratio de contraste WCAG entre deux couleurs hex.
 * Ratio ≥ 4.5:1 est requis pour le texte normal (AA).
 * Ratio ≥ 3:1 est requis pour le texte large (AA).
 * Ratio ≥ 7:1 est recommandé (AAA).
 */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE_HEX = '#ffffff';
const BLACK_HEX = '#000000';

/**
 * Détermine si une couleur est "foncée" en utilisant la luminance relative WCAG.
 * Le seuil 0.2 est plus strict que 0.5 car il garantit un meilleur contraste
 * avec le texte blanc (ratio ≥ 3:1 pour les grands textes).
 *
 * Pour les couleurs proches du seuil, on utilise le ratio de contraste
 * pour choisir la couleur de texte la plus lisible.
 */
function isDark(hex: string): boolean {
  return relativeLuminance(hex) < 0.2;
}

/**
 * Retourne la couleur de texte (blanc #FFFFFF ou noir #111111)
 * qui offre le meilleur ratio de contraste WCAG avec la couleur donnée.
 */
function getReadableTextColor(
  hex: string,
  darkText: string = '#111111',
  lightText: string = '#ffffff',
): string {
  const contrastWithWhite = contrastRatio(hex, WHITE_HEX);
  const contrastWithBlack = contrastRatio(hex, BLACK_HEX);
  return contrastWithWhite > contrastWithBlack ? lightText : darkText;
}

function adjustBrightness(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.min(255, Math.max(0, Math.round(r * factor)));
  const ng = Math.min(255, Math.max(0, Math.round(g * factor)));
  const nb = Math.min(255, Math.max(0, Math.round(b * factor)));
  return '#' + [nr, ng, nb].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract dominant colors from an image URL.
 * Uses colorthief v3 async API with semantic swatches.
 * Results are cached by URL to avoid re-extraction.
 */
export async function extractColorsFromImageUrl(imageUrl: string): Promise<ExtractedColors | null> {
  if (!imageUrl) return null;

  // Check cache
  const cached = colorCache.get(imageUrl);
  if (cached) return cached;

  try {
    // Charger l'image (URL déjà convertie en ImageKit par getOptimizedImageUrl)
    const img = await loadImage(imageUrl);

    // Get dominant color
    const dominantColor = await getColor(img);
    const dominantHex = dominantColor?.hex() ?? '#8B0000';

    // Get semantic swatches (Vibrant, Muted, DarkVibrant, etc.)
    const swatches = await getSwatches(img);

    const vibrantHex = swatches?.Vibrant?.color.hex() ?? dominantHex;
    const mutedHex = swatches?.Muted?.color.hex() ?? adjustBrightness(vibrantHex, 0.7);
    const darkVibrantHex = swatches?.DarkVibrant?.color.hex() ?? adjustBrightness(vibrantHex, 0.5);
    const lightVibrantHex = swatches?.LightVibrant?.color.hex() ?? adjustBrightness(vibrantHex, 1.3);
    const darkMutedHex = swatches?.DarkMuted?.color.hex() ?? adjustBrightness(mutedHex, 0.35);

    const colors: ExtractedColors = {
      dominant: dominantHex,
      vibrant: vibrantHex,
      muted: mutedHex,
      darkMuted: darkMutedHex,
      lightVibrant: lightVibrantHex,
      isDark: isDark(dominantHex),
      contrastWhite: contrastRatio(dominantHex, WHITE_HEX),
      contrastBlack: contrastRatio(dominantHex, BLACK_HEX),
    };

    // Cache the result
    colorCache.set(imageUrl, colors);

    return colors;
  } catch {
    return null;
  }
}

/**
 * Generate a Spotify-style hero gradient string from extracted colors.
 */
export function buildGradientFromColors(
  colors: ExtractedColors | null,
  fallback: string = 'linear-gradient(180deg, rgba(139,0,0,0.15) 0%, transparent 100%)',
): string {
  if (!colors) return fallback;
  return `linear-gradient(180deg, ${colors.darkMuted} 0%, ${colors.muted} 40%, var(--color-bg-dark) 100%)`;
}

/**
 * Build a lighter overlay gradient for the FullPlayer right panel.
 */
export function buildPlayerGradient(colors: ExtractedColors | null): string {
  if (!colors) {
    return 'linear-gradient(180deg, rgba(139,0,0,0.18) 0%, rgba(220,20,60,0.06) 30%, transparent 100%)';
  }
  return `linear-gradient(180deg, ${colors.dominant}40 0%, ${colors.vibrant}15 30%, transparent 100%)`;
}

/**
 * Get a vibrant color with alpha for box shadows and accents.
 * Returns a valid CSS color string.
 */
export function buildVibrantWithAlpha(
  colors: ExtractedColors | null,
  alpha: number,
  fallback: string = 'rgba(220,20,60,0.4)',
): string {
  if (!colors) return fallback;
  // Convert hex to rgba
  const hex = colors.vibrant;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Clear the color cache.
 */
export function clearColorCache(): void {
  colorCache.clear();
}

/**
 * Retourne la couleur de texte primaire avec le meilleur contraste.
 * Si les couleurs ne sont pas encore extraites, utilise le fallback.
 * Pour un fond sombre → texte blanc ; fond clair → texte sombre (#111).
 */
export function getPrimaryTextColor(colors: ExtractedColors | null, fallback: string = '#fff'): string {
  if (!colors) return fallback;
  return getReadableTextColor(colors.dominant, '#111111', '#ffffff');
}

/**
 * Retourne la couleur de texte secondaire selon la luminosité du fond.
 * Version avec opacité pour un rendu plus subtil.
 */
export function getSecondaryTextColor(colors: ExtractedColors | null, fallback: string = 'rgba(255,255,255,0.65)'): string {
  if (!colors) return fallback;
  return colors.isDark
    ? 'rgba(255,255,255,0.65)'
    : 'rgba(0,0,0,0.6)';
}

/**
 * Retourne la couleur pour les séparateurs / dots / textes très discrets.
 */
export function getMutedTextColor(colors: ExtractedColors | null, fallback: string = 'rgba(255,255,255,0.35)'): string {
  if (!colors) return fallback;
  return colors.isDark
    ? 'rgba(255,255,255,0.35)'
    : 'rgba(0,0,0,0.3)';
}

/**
 * Retourne une couleur d'accent dérivée du vibrant pour les badges et éléments interactifs,
 * avec un fallback vers le rouge Pass'io.
 */
export function getAccentColor(colors: ExtractedColors | null, fallback: string = 'var(--color-accent)'): string {
  if (!colors) return fallback;
  return colors.vibrant;
}

/**
 * Retourne le background avec opacité pour un badge, adapté à la luminosité.
 */
export function getBadgeBackground(colors: ExtractedColors | null, isDarkBg: boolean, isPremium: boolean = false): string {
  if (isPremium) {
    return 'rgba(255,215,0,0.12)';
  }
  if (!colors) return isDarkBg ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  if (isDarkBg) {
    return `${colors.vibrant}15`;
  }
  return `${colors.vibrant}0C`;
}

/**
 * Retourne la couleur de bordure pour un badge, adaptée à la luminosité.
 */
export function getBadgeBorder(colors: ExtractedColors | null, isDarkBg: boolean, isPremium: boolean = false): string {
  if (isPremium) {
    return 'rgba(255,215,0,0.2)';
  }
  if (!colors) return isDarkBg ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' ;
  if (isDarkBg) {
    return `${colors.vibrant}25`;
  }
  return `${colors.vibrant}15`;
}

/**
 * Retourne une couleur de fond adaptative pour les conteneurs
 * qui utilisent la couleur dominante comme arrière-plan.
 * Pour les fonds clairs → fond semi-transparent noir
 * Pour les fonds sombres → fond semi-transparent blanc
 */
export function getAdaptiveSurfaceColor(colors: ExtractedColors | null, isDarkBg: boolean): string {
  if (!colors) return isDarkBg ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  return isDarkBg ? `${colors.vibrant}15` : `${colors.dominant}15`;
}
