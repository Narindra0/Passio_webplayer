/**
 * graphRecommendations.ts — Moteur de recommandation par rebond de collaborations
 * et par contexte d'album.
 *
 * ## Collaborations (graph)
 * Construit un graphe pondéré des artistes à partir des featurings,
 * puis score les artistes jusqu'à 2 degrés de séparation avec atténuation.
 *   Degré 0 (écouté)  → score = playCount × 10
 *   Degré 1 (direct)   → score = avg(playCount voisins) × 3.0
 *   Degré 2 (indirect) → score = avg(score degré1) × 0.3
 *
 * ## Contexte d'album (albumContext)
 * Pour chaque artiste favori, trouve tous les albums où il apparaît,
 * puis recommande les autres morceaux du même album (en excluant ceux déjà écoutés).
 */

import type { TrackWithAlbum } from '@/components/TrackListItem';
import type { ListeningHistory } from '@/services/listeningHistory';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';

// ── Types publics ──

export interface ScoredArtist {
  /** Nom normalisé de l'artiste */
  artistName: string;
  /** Score de recommandation (plus haut = plus recommandé) */
  score: number;
  /** Degré de séparation : 0 = écouté, 1 = collab directe, 2 = collab de collab */
  degree: 0 | 1 | 2;
  /** Chemin de recommandation : artistes intermédiaires (pour affichage) */
  via: string[];
}

export interface FeatGraph {
  /** Graphe d'adjacence pondéré : artisteNormalisé → { voisin → poids } */
  adjacency: Map<string, Map<string, number>>;
  /** Timestamp de construction */
  buildTime: number;
  /** Nombre d'arêtes */
  edgeCount: number;
}

// ── Cache ―――――――――――――――――――――――――――――――――――――――――――――――――――――――

let cachedGraph: FeatGraph | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Vide le cache du graphe (utile après un rechargement des données).
 */
export function clearGraphCache(): void {
  cachedGraph = null;
}

// ── Construction du graphe ──

/**
 * Construit le graphe de collaborations à partir des titres.
 * Chaque arête est pondérée par le nombre de featurings entre deux artistes.
 *
 * @param tracks - Tous les titres disponibles (freeTracks)
 * @returns Le graphe de collaborations
 */
export function buildFeatGraph(tracks: TrackWithAlbum[]): FeatGraph {
  const adjacency = new Map<string, Map<string, number>>();

  for (const track of tracks) {
    if (!hasFeatArtists(track.title)) continue;

    const { featNames } = parseFeatArtists(track.title);
    const mainArtist = normalizeArtistName(track.artist_name);
    if (!mainArtist) continue;

    // S'assurer que le nœud principal existe
    if (!adjacency.has(mainArtist)) {
      adjacency.set(mainArtist, new Map());
    }

    for (const featName of featNames) {
      const featNorm = normalizeArtistName(featName);
      if (!featNorm || featNorm === mainArtist) continue;

      // S'assurer que le nœud feat existe
      if (!adjacency.has(featNorm)) {
        adjacency.set(featNorm, new Map());
      }

      // Incrémenter le poids de l'arête (bidirectionnelle)
      const mainEdges = adjacency.get(mainArtist)!;
      mainEdges.set(featNorm, (mainEdges.get(featNorm) ?? 0) + 1);

      const featEdges = adjacency.get(featNorm)!;
      featEdges.set(mainArtist, (featEdges.get(mainArtist) ?? 0) + 1);
    }
  }

  // Compter les arêtes
  let edgeCount = 0;
  for (const edges of adjacency.values()) {
    edgeCount += edges.size;
  }
  // Chaque arête est comptée 2 fois (bidirectionnelle)
  edgeCount = Math.floor(edgeCount / 2);

  return {
    adjacency,
    buildTime: Date.now(),
    edgeCount,
  };
}

/**
 * Retourne le graphe en cache, ou le reconstruit si nécessaire.
 *
 * @param tracks - Les titres pour construire le graphe (si reconstruction)
 * @param force - Forcer la reconstruction
 * @returns Le graphe de collaborations
 */
export function getFeatGraph(
  tracks: TrackWithAlbum[],
  force = false,
): FeatGraph {
  if (!cachedGraph || force || Date.now() - cachedGraph.buildTime > CACHE_TTL_MS) {
    cachedGraph = buildFeatGraph(tracks);
  }
  return cachedGraph;
}

// ── Scoring des artistes ──

/**
 * Score les artistes par rebond de collaborations (BFS niveau 2).
 *
 * @param graph - Le graphe de collaborations
 * @param topArtists - Les artistes les plus écoutés (avec playCount)
 * @param excludeSet - Ensemble des noms d'artistes à exclure (déjà écoutés)
 * @returns Liste des artistes scorés, triée par score décroissant
 */
export function scoreArtists(
  graph: FeatGraph,
  topArtists: Array<{ artistName: string; playCount: number }>,
  excludeSet: Set<string>,
): ScoredArtist[] {
  const scored = new Map<string, ScoredArtist>();
  const visited = new Set<string>();
  const topNames = new Map<string, number>(); // nom → playCount

  // Indexer les artistes écoutés
  for (const a of topArtists) {
    const name = normalizeArtistName(a.artistName);
    if (name) {
      topNames.set(name, a.playCount);
    }
  }

  // ── Degré 0 : artistes écoutés (servent de base, ne sont pas retournés) ──
  for (const [name, playCount] of topNames) {
    visited.add(name);
    scored.set(name, {
      artistName: name,
      score: playCount * 10,
      degree: 0,
      via: [],
    });
  }

  // ── Degré 1 : collaborateurs directs ──
  const degree1Map = new Map<string, { totalScore: number; count: number; via: string[] }>();

  for (const [topName, playCount] of topNames) {
    const neighbors = graph.adjacency.get(topName);
    if (!neighbors) continue;

    for (const [neighborName, weight] of neighbors) {
      if (visited.has(neighborName)) continue;

      if (!degree1Map.has(neighborName)) {
        degree1Map.set(neighborName, { totalScore: 0, count: 0, via: [] });
      }
      const entry = degree1Map.get(neighborName)!;
      entry.totalScore += playCount * weight;
      entry.count += weight;
      entry.via.push(topName);
    }
  }

  for (const [name, data] of degree1Map) {
    const avgScore = data.count > 0 ? data.totalScore / data.count : 0;
    const finalScore = avgScore * 3.0;
    visited.add(name);
    scored.set(name, {
      artistName: name,
      score: finalScore,
      degree: 1,
      via: [...new Set(data.via)], // Déduplication
    });
  }

  // ── Degré 2 : collaborateurs de collaborateurs (avec atténuation) ──
  const degree2Map = new Map<string, { totalScore: number; count: number; via: string[] }>();

  for (const [d1Name, d1Data] of degree1Map) {
    const d1Score = scored.get(d1Name)?.score ?? 0;
    const neighbors = graph.adjacency.get(d1Name);
    if (!neighbors) continue;

    for (const [neighborName, weight] of neighbors) {
      if (visited.has(neighborName)) continue;

      if (!degree2Map.has(neighborName)) {
        degree2Map.set(neighborName, { totalScore: 0, count: 0, via: [] });
      }
      const entry = degree2Map.get(neighborName)!;
      entry.totalScore += d1Score * weight;
      entry.count += weight;
      entry.via.push(d1Name);
    }
  }

  for (const [name, data] of degree2Map) {
    const avgScore = data.count > 0 ? data.totalScore / data.count : 0;
    const finalScore = avgScore * 0.3; // Atténuation forte
    scored.set(name, {
      artistName: name,
      score: finalScore,
      degree: 2,
      via: [...new Set(data.via)],
    });
  }

  // Filtrer : exclure les écoutés et les artistes sans score, trier par score
  const results = Array.from(scored.values())
    .filter(a => a.degree > 0 && !excludeSet.has(a.artistName))
    .sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Helper qui combine getFeatGraph + scoreArtists avec cache.
 *
 * @param tracks - Les titres pour le graphe
 * @param topArtists - Les artistes écoutés
 * @param history - L'historique complet (pour exclusion)
 * @param maxResults - Nombre max de résultats (défaut: 20)
 * @returns Liste des artistes recommandés, scorés et triés
 */
export function getRecommendations(
  tracks: TrackWithAlbum[],
  topArtists: Array<{ artistName: string; playCount: number }>,
  history: ListeningHistory,
  maxResults = 20,
): ScoredArtist[] {
  const graph = getFeatGraph(tracks);
  const excludeSet = new Set<string>();

  // Exclure les artistes déjà dans l'historique d'écoute
  for (const entry of Object.values(history)) {
    excludeSet.add(normalizeArtistName(entry.artistName));
  }

  const scored = scoreArtists(graph, topArtists, excludeSet);
  return scored.slice(0, maxResults);
}

// ── Recommandation par contexte d'album ──
// ─── (nouveau moteur : Track → Album → Autres tracks) ────

/**
 * Résultat d'une recommandation par contexte d'album.
 */
export interface AlbumContextRecommendation {
  /** ID de l'album recommandé */
  albumId: string;
  /** Titre de l'album */
  albumTitle: string;
  /** URL de la cover (pour affichage) */
  coverUrl: string | null;
  /** Nom de l'artiste principal de l'album */
  artistName: string;
  /** Le ou les artistes écoutés qui ont déclenché cette recommandation */
  triggerArtists: string[];
  /** Score de recommandation contextuel */
  score: number;
  /** Nombre de nouveaux morceaux recommandés dans cet album */
  newTrackCount: number;
  /** Nombre total de morceaux dans l'album */
  totalTrackCount: number;
}

/**
 * Génère des recommandations par contexte d'album.
 *
 * Principe :
 *   Pour chaque artiste favori de l'utilisateur, on identifie les albums
 *   dans lesquels il apparaît. Pour chaque album, on extrait les autres
 *   morceaux qui ne sont PAS interprétés par un artiste déjà écouté.
 *   Plus l'utilisateur écoute l'artiste déclencheur, plus le score est élevé.
 *
 * @param tracks     Tous les titres disponibles (freeTracks)
 * @param topArtists Les artistes les plus écoutés (avec playCount)
 * @param history    L'historique complet (pour exclusion)
 * @param maxAlbums  Nombre max d'albums à retourner (défaut: 6)
 * @returns          Albums recommandés, triés par score
 */
export function getAlbumContextRecommendations(
  tracks: TrackWithAlbum[],
  topArtists: Array<{ artistName: string; playCount: number }>,
  history: ListeningHistory,
  maxAlbums = 6,
): AlbumContextRecommendation[] {
  if (topArtists.length === 0 || tracks.length === 0) return [];

  // ── 1. Indexer les artistes écoutés ──
  const topNames = new Map<string, number>();
  for (const a of topArtists) {
    const name = normalizeArtistName(a.artistName);
    if (name) topNames.set(name, a.playCount);
  }

  // Artistes exclus (déjà écoutés)
  const listenedNames = new Set<string>();
  for (const entry of Object.values(history)) {
    listenedNames.add(normalizeArtistName(entry.artistName));
  }

  // ── 2. Grouper les tracks par album ──
  const albumsMap = new Map<string, {
    tracks: TrackWithAlbum[];
    triggerArtists: Set<string>;
    maxPlayCount: number;
  }>();

  for (const track of tracks) {
    if (!track.album_id) continue;
    if (!albumsMap.has(track.album_id)) {
      albumsMap.set(track.album_id, {
        tracks: [],
        triggerArtists: new Set(),
        maxPlayCount: 0,
      });
    }
    const entry = albumsMap.get(track.album_id)!;
    entry.tracks.push(track);

    // Vérifier si cet artiste est un top artist
    const normName = normalizeArtistName(track.artist_name);
    if (normName && topNames.has(normName)) {
      entry.triggerArtists.add(normName);
      entry.maxPlayCount = Math.max(entry.maxPlayCount, topNames.get(normName) || 0);
    }
  }

  // ── 3. Pour chaque album, calculer le score et les nouvelles tracks ──
  const recommendations: AlbumContextRecommendation[] = [];

  for (const [albumId, entry] of albumsMap) {
    // Ne garder que les albums où au moins un artiste écouté est présent
    if (entry.triggerArtists.size === 0) continue;

    // Compter les tracks par des artistes NON écoutés (nouveautés)
    const newTracks = entry.tracks.filter(t => {
      const normName = normalizeArtistName(t.artist_name);
      return !listenedNames.has(normName) && !topNames.has(normName);
    });

    if (newTracks.length === 0) continue;

    // Le premier track donne les infos de l'album
    const firstTrack = entry.tracks[0];

    recommendations.push({
      albumId,
      albumTitle: firstTrack.album_title || 'Album',
      coverUrl: firstTrack.cover_url || null,
      artistName: firstTrack.artist_name,
      triggerArtists: Array.from(entry.triggerArtists),
      score: entry.maxPlayCount * (1 + newTracks.length * 0.5),
      newTrackCount: newTracks.length,
      totalTrackCount: entry.tracks.length,
    });
  }

  // ── 4. Trier par score et limiter ──
  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, maxAlbums);
}
