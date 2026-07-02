import { getColor, getPalette, getSwatches } from 'colorthief';

const colorCache = new Map<string, ExtractedColors>();

export interface ExtractedColors {
  dominant: string;       // hex — main color
  vibrant: string;        // hex — vibrant variant
  muted: string;          // hex — muted variant
  darkMuted: string;      // hex — dark muted for deep gradients
  lightVibrant: string;   // hex — light variant for gradients
  isDark: boolean;        // whether dominant is dark (for text contrast)
}

function isDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
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
    // Load image into an HTMLImageElement
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = imageUrl;
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load image: ${imageUrl}`));
    });

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
 * Retourne la couleur de texte primaire (blanc ou noir) selon si le fond est sombre ou clair.
 */
export function getPrimaryTextColor(colors: ExtractedColors | null, fallback: string = '#fff'): string {
  if (!colors) return fallback;
  return colors.isDark ? '#fff' : '#111';
}

/**
 * Retourne la couleur de texte secondaire/muted selon la luminosité du fond.
 */
export function getSecondaryTextColor(colors: ExtractedColors | null, fallback: string = 'rgba(255,255,255,0.65)'): string {
  if (!colors) return fallback;
  return colors.isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)';
}

/**
 * Retourne la couleur pour les séparateurs / dots.
 */
export function getMutedTextColor(colors: ExtractedColors | null, fallback: string = 'rgba(255,255,255,0.35)'): string {
  if (!colors) return fallback;
  return colors.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
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
  if (!colors) return isDarkBg ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  if (isDarkBg) {
    return `${colors.vibrant}25`;
  }
  return `${colors.vibrant}15`;
}
