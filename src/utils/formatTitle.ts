/**
 * Nettoie et formate un titre :
 * 1. Supprime le préfixe numérique (ex: "1 - ", "04 - ")
 * 2. Convertit en Sentence Case (première lettre majuscule, le reste minuscule)
 *
 * Exemples :
 *   "1 - ANKATSO"       → "Ankatso"
 *   "04 - TRACK TITLE"  → "Track title"
 *   "MON ALBUM"         → "Mon album"
 *   "Titre (feat. Artiste)" → "Titre (feat. Artiste)"  (inchangé)
 */
export function formatTitle(title: string | null | undefined): string {
  if (!title) return '';

  let cleaned = title.trim();

  // 1. Supprimer le préfixe numérique : chiffres + espace? + tiret + espace?
  cleaned = cleaned.replace(/^\d+\s*-\s*/, '');

  // 2. Sentence case : première lettre en majuscule, reste en minuscule
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }

  return cleaned;
}
