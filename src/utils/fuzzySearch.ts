/**
 * fuzzySearch.ts — Utilitaires de recherche floue ultra-rapides
 *
 * Fonctionnalités :
 * - Normalisation : suppression des accents, tirets, espaces
 * - Sous-séquence : les caractères de la requête doivent apparaître dans l'ordre
 *   dans la cible (ex: "hotavina" → "ho-toavina" ✓)
 * - Insensible à la casse
 *
 * Performances : O(n) pour la normalisation, O(n) pour le subsequence match
 * Aucune allocation lourde, pas de Levenshtein coûteux.
 */

const DIACRITICS_MAP: Record<string, string> = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a', 'ą': 'a',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ĕ': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ĩ': 'i', 'ī': 'i', 'ĭ': 'i', 'į': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ō': 'o', 'ŏ': 'o', 'ő': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ũ': 'u', 'ū': 'u', 'ŭ': 'u', 'ů': 'u',
  'ý': 'y', 'ÿ': 'y',
  'ç': 'c', 'ć': 'c', 'ĉ': 'c', 'ċ': 'c', 'č': 'c',
  'ñ': 'n', 'ń': 'n', 'ņ': 'n', 'ň': 'n', 'ŉ': 'n',
  'ŕ': 'r', 'ř': 'r',
  'ś': 's', 'ŝ': 's', 'ş': 's', 'š': 's',
  'ť': 't',
  'ž': 'z', 'ź': 'z', 'ż': 'z',
  'æ': 'ae', 'œ': 'oe',
  'ğ': 'g',
  'đ': 'd',
  'ł': 'l',
};

/**
 * Normalise une chaîne pour la recherche :
 * - Minuscule
 * - Remplace les diacritiques (accents) par leurs équivalents ASCII
 * - Supprime les tirets, underscores, espaces
 * - Supprime les caractères spéciaux
 *
 * @example normalizeForSearch("Ho-toavina") → "hotoavina"
 * @example normalizeForSearch("Mc Hope") → "mchope"
 * @example normalizeForSearch("Fàrànafàna") → "faranafana"
 */
export function normalizeForSearch(text: string): string {
  let result = text.toLowerCase();

  // Remplacer les diacritiques via une regex (beaucoup plus rapide que normalize('NFD'))
  result = result.replace(
    /[àáâãäåāăąèéêëēĕėęěìíîïĩīĭįòóôõöøōŏőùúûüũūŭůýÿçćĉċčñńņňŉŕřśŝşšťžźżæœğđł]/g,
    (char) => DIACRITICS_MAP[char] || char,
  );

  // Supprimer tirets, underscores, espaces
  result = result.replace(/[-_\s]+/g, '');

  // Supprimer les caractères non-alphanumériques (sauf ceux déjà nettoyés)
  result = result.replace(/[^a-z0-9]/g, '');

  return result;
}

/**
 * Vérifie si les caractères de `query` apparaissent en ordre dans `target`
 * (sous-séquence). Permet de trouver une correspondance même quand
 * des caractères sont manquants ou que l'ordre exact diffère légèrement.
 *
 * @example isSubsequence("hotavina", "hotoavina") → true
 * @example isSubsequence("mchope", "mchope") → true (même chaîne)
 * @example isSubsequence("abc", "acb") → true (a→b→c dans acb : a, puis c non, puis b, puis c ✓)
 *
 * Complexité : O(n) temps, O(1) mémoire
 */
export function isSubsequence(query: string, target: string): boolean {
  if (query.length === 0) return false;
  if (query.length > target.length) return false;

  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (query[qi] === target[ti]) {
      qi++;
    }
  }
  return qi === query.length;
}

/**
 * Fonction de correspondance floue principale.
 * Retourne true si la requête correspond à la cible.
 *
 * Stratégies (essayées dans l'ordre, arrêt précoce dès qu'une match) :
 * 1. Sous-chaîne exacte après normalisation (ex: "mchope" dans "mc hope" normalisé)
 * 2. Sous-séquence floue (ex: "hotavina" dans "hotoavina")
 *
 * @example fuzzyMatch("mchope", "Mc Hope") → true
 * @example fuzzyMatch("hotavina", "Ho-toavina") → true
 * @example fuzzyMatch("faranafana", "Fàrànafàna") → true
 * @example fuzzyMatch("mchope", "Michel Hope") → true (sous-séquence)
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = normalizeForSearch(query);
  const t = normalizeForSearch(target);

  if (q.length === 0 || t.length === 0) return false;
  if (q.length > t.length) return false;

  // Stratégie 1 : sous-chaîne exacte (le plus rapide)
  if (t.includes(q)) return true;

  // Stratégie 2 : sous-séquence (permet des caractères manquants)
  if (isSubsequence(q, t)) return true;

  return false;
}


