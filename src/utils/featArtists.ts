/**
 * featArtists.ts — Extraction des artistes "feat." depuis les titres de pistes.
 * 
 * Patterns supportés :
 *   - "Titre (Feat. Artiste)"     / "Titre (feat. Artiste)"
 *   - "Titre (Ft. Artiste)"       / "Titre (ft. Artiste)"
 *   - "Titre feat. Artiste"       / "Titre ft. Artiste"
 *   - "Titre (Featuring Artiste)" / "Titre featuring Artiste"
 *   - Multiples : "Titre (Feat. A, B & C)" / "Titre (Feat. A, B and C)"
 */

export interface FeatParseResult {
  /** Titre propre sans la mention feat */
  cleanTitle: string;
  /** Noms des artistes en feat (ex: ["Balz", "Ando"]) */
  featNames: string[];
}

/**
 * Normalise un nom d'artiste pour la recherche
 * - Enlève la ponctuation inutile (.,;!?)
 * - Enlève les espaces superflus
 * - Met en minuscules
 * - Préserve les accents, les symboles comme $, #, &, etc.
 */
export function normalizeArtistName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s.,;!?]+/g, ' ') // Remplace espaces multiples ou ponctuation simple par un seul espace
    .trim();
}

// Expressions régulières pour détecter les motifs feat/ft/featuring
// Gère : (Feat. X), (Ft. X), feat. X, ft. X, featuring X, avec ou sans parenthèses
// Les parenthèses sont optionnelles
const FEAT_REGEX = /[(\[]?\s*(?:feat(?:uring)?|ft)[.\s]+([^)\]]+)[)\]]?/i;

/**
 * Sépare les noms d'artistes multiples par virgule, " & " ou " and ".
 * Exemple: "Balz, Ando & Charles" → ["Balz", "Ando", "Charles"]
 */
function splitFeatNames(raw: string): string[] {
  return raw
    .split(/\s*[,&]\s*|\s+and\s+/i)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Extrait les artistes "feat." du titre d'une piste.
 */
export function parseFeatArtists(title: string): FeatParseResult {
  if (!title) return { cleanTitle: '', featNames: [] };

  const match = title.match(FEAT_REGEX);

  if (!match) {
    return { cleanTitle: title, featNames: [] };
  }

  const [fullMatch] = match;
  const rawFeatNames = match[1]?.trim() ?? '';

  // Titre sans la partie feat
  const cleanTitle = title.replace(fullMatch, '').replace(/\s*\(\s*\)\s*$/, '').replace(/[(\[]?\s*\)?\]?\s*$/, '').trim();

  const featNames = splitFeatNames(rawFeatNames);

  return { cleanTitle, featNames };
}

/**
 * Vérifie rapidement si un titre contient une mention feat.
 * Utile pour éviter d'appeler parseFeatArtists inutilement.
 */
export function hasFeatArtists(title: string): boolean {
  return FEAT_REGEX.test(title);
}
