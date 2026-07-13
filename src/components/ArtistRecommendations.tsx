import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Sparkles, TrendingUp, Compass } from 'lucide-react';
import { ArtistCard } from '@/components/ArtistCard';
import { readFreeCatalogCache, type FreeCatalogCache } from '@/services/freeCatalogCache';
import { getTopArtists, getListenedArtistIds, type ListeningHistoryEntry } from '@/services/listeningHistory';
import { buildArtistsFromAlbums } from '@/services/freeCatalogSearch';
import { normalizeArtistName, parseFeatArtists, hasFeatArtists } from '@/utils/featArtists';
import type { PublicAlbumSummary, PublicAlbumDetails } from '@/types/backend';

export interface ArtistRecommendationsProps {
  /** IDs d'artistes à exclure (optionnel, pour éviter de se recommander soi-même) */
  excludeArtistIds?: string[];
  /** Nombre maximum d'artistes recommandés au total (défaut: 12) */
  maxArtists?: number;
  /** Nombre d'artistes "découverte" aléatoires à inclure (défaut: 3) */
  discoveryCount?: number;
  /** Titre personnalisé de la section (défaut: "Artistes recommandés") */
  sectionTitle?: string;
  /** Masquer le lien "Voir tout" (utile quand on est déjà sur la page artistes) */
  hideViewAll?: boolean;
  /**
   * ID d'un artiste source pour les recommandations "similaires".
   * Quand fourni, l'algorithme utilise le graphe de co-occurrences (feats)
   * pour trouver les artistes liés à cet artiste, au lieu de l'historique
   * d'écoute personnel.
   */
  sourceArtistId?: string;
}

interface ArtistResult {
  id: string;
  name: string;
  profile_picture_url?: string | null;
  fallback_image_url?: string | null;
  /** Score de pertinence : plus c'est haut, plus c'est recommandé */
  relevanceScore: number;
  /** Catégorie de la recommandation */
  category: 'frequent' | 'similar' | 'discovery';
  /** Nombre de lectures (si issu de l'historique) */
  playCount?: number;
}

interface FlatArtist {
  id: string;
  name: string;
  profile_picture_url?: string | null;
  fallback_image_url?: string | null;
}

// ── PRNG seedé par la date (découverte stable sur la journée) ───────────────

/**
 * Générateur pseudo-aléatoire Mulberry32.
 * Produit une séquence déterministe de nombres entre 0 et 1 à partir d'un seed.
 */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Calcule un seed numérique stable pour la journée en cours (YYYY-MM-DD).
 * Le même seed est retourné toute la journée, et change automatiquement le lendemain.
 */
function getDailySeed(): number {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    const char = dateStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // force 32-bit integer
  }
  return Math.abs(hash);
}

// ── Graphe de co-occurrences ───────────────────────────────────────────────

/**
 * Construit un map nom normalisé → ID d'artiste à partir des albums du catalogue.
 * Sert à résoudre les noms d'artistes "feat." en IDs.
 * Copié de ArtistLookupContext (évite la dépendance React).
 */
function buildNameToIdMap(albums: PublicAlbumSummary[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const album of albums) {
    // Main artist
    const mainName = album.artist_name || album.artist?.name;
    const mainId = album.artist_id || album.artist?.id;
    if (mainName && mainId) {
      const key = normalizeArtistName(mainName);
      if (!map.has(key)) map.set(key, mainId);
    }
    // artists[] array (feat artists at album level)
    if (album.artists) {
      for (const a of album.artists) {
        if (a.id && a.name) {
          const key = normalizeArtistName(a.name);
          if (!map.has(key)) map.set(key, a.id);
        }
      }
    }
  }
  return map;
}

/**
 * Récupère tous les IDs d'artistes associés à un album :
 * - L'artiste principal
 * - Les feat artists du tableau album.artists[]
 * - Les feat artists parsés depuis les titres de pistes
 */
function collectAlbumArtistIds(
  album: PublicAlbumSummary,
  details: PublicAlbumDetails | undefined,
  nameToId: Map<string, string>,
): string[] {
  const ids = new Set<string>();

  // 1. Artiste principal
  const mainId = album.artist_id || album.artist?.id;
  if (mainId) ids.add(mainId);

  // 2. Feat artists depuis album.artists[]
  if (album.artists) {
    for (const a of album.artists) {
      if (a.id) ids.add(a.id);
    }
  }

  // 3. Feat artists depuis les titres de pistes
  if (details?.tracks) {
    for (const track of details.tracks) {
      if (hasFeatArtists(track.title)) {
        const { featNames } = parseFeatArtists(track.title);
        for (const name of featNames) {
          const key = normalizeArtistName(name);
          const id = nameToId.get(key);
          if (id) ids.add(id);
        }
      }
    }
  }

  return Array.from(ids);
}

/**
 * Construit un graphe de co-occurrences d'artistes à partir du catalogue.
 *
 * Pour chaque album, on collecte TOUS les artistes impliqués (principal + feats),
 * et on incrémente le compteur pour chaque paire d'artistes distincts.
 *
 * Résultat : Map< artistA, Map< artistB, nombreDeCollaborations >>
 *
 * Exemple : si "Rantso" et "Balz" apparaissent ensemble sur 3 albums,
 *           le graphe contiendra coOccurrences["rantso"]["balz"] = 3
 */
function buildCoOccurrenceGraph(
  cache: FreeCatalogCache,
): Map<string, Map<string, number>> {
  const graph = new Map<string, Map<string, number>>();
  const nameToId = buildNameToIdMap(cache.albums);
  const processedAlbums = new Set<string>();

  for (const album of cache.albums) {
    if (processedAlbums.has(album.id)) continue;
    processedAlbums.add(album.id);

    const details = cache.albumDetails[album.id];
    const artistIds = collectAlbumArtistIds(album, details, nameToId);
    if (artistIds.length < 2) continue; // Pas de paire possible

    // Incrémenter le compteur pour chaque paire d'artistes distincts
    for (let i = 0; i < artistIds.length; i++) {
      for (let j = i + 1; j < artistIds.length; j++) {
        const a = artistIds[i];
        const b = artistIds[j];
        if (!a || !b || a === b) continue;

        // Direction a → b
        let rowA = graph.get(a);
        if (!rowA) {
          rowA = new Map<string, number>();
          graph.set(a, rowA);
        }
        rowA.set(b, (rowA.get(b) ?? 0) + 1);

        // Direction b → a
        let rowB = graph.get(b);
        if (!rowB) {
          rowB = new Map<string, number>();
          graph.set(b, rowB);
        }
        rowB.set(a, (rowB.get(a) ?? 0) + 1);
      }
    }
  }

  return graph;
}

// ── Algorithme de recommandation (général) ─────────────────────────────────

/**
 * Calcule les recommandations d'artistes à partir du cache catalogue et de l'historique local.
 * Pure function — synchrone après lecture du cache.
 */
function computeRecommendations(
  cache: FreeCatalogCache,
  topListened: ListeningHistoryEntry[],
  listenedIds: Set<string>,
  excludeArtistIds: string[],
  maxArtists: number,
  discoveryCount: number,
): ArtistResult[] {
  const excluded = new Set(excludeArtistIds);
  const allArtists: FlatArtist[] = buildArtistsFromAlbums(cache.albums);
  const artistMap = new Map<string, FlatArtist>(allArtists.map((a) => [a.id, a]));

  // Construire le graphe de co-occurrences (collaborations)
  const coOccurrenceGraph = buildCoOccurrenceGraph(cache);

  const selectedIds = new Set<string>();
  const results: ArtistResult[] = [];

  // ── PASSE 1 : Artistes les plus écoutés ──
  for (const entry of topListened) {
    if (selectedIds.has(entry.artistId) || excluded.has(entry.artistId)) continue;
    const artist = artistMap.get(entry.artistId);
    if (!artist) continue;

    selectedIds.add(entry.artistId);
    results.push({
      id: artist.id,
      name: artist.name,
      profile_picture_url: artist.profile_picture_url,
      fallback_image_url: artist.fallback_image_url,
      relevanceScore: entry.playCount * 100,
      category: 'frequent',
      playCount: entry.playCount,
    });
  }

  // ── PASSE 2 : Artistes similaires via le GRAPHE DE CO-OCCURRENCES ──
  //    Les artistes qui ont collaboré avec les plus écoutés sont recommandés en priorité
  if (results.length < maxArtists && topListened.length > 0) {
    const collaboratorScores = new Map<string, { artist: FlatArtist; score: number }>();

    for (const entry of topListened) {
      const collabs = coOccurrenceGraph.get(entry.artistId);
      if (!collabs) continue;

      for (const [collabId, count] of collabs) {
        if (selectedIds.has(collabId) || excluded.has(collabId)) continue;
        const collabArtist = artistMap.get(collabId);
        if (!collabArtist) continue;

        const existing = collaboratorScores.get(collabId);
        const newScore = (existing?.score ?? 0) + count * 20;
        collaboratorScores.set(collabId, { artist: collabArtist, score: newScore });
      }
    }

    // Trier par score décroissant (plus de collaborations = plus pertinent)
    const sortedCollabs = Array.from(collaboratorScores.values())
      .sort((a, b) => b.score - a.score);

    const similarBudget = Math.min(sortedCollabs.length, maxArtists - results.length - discoveryCount);
    for (let i = 0; i < similarBudget; i++) {
      const entry = sortedCollabs[i];
      if (!entry) break;
      selectedIds.add(entry.artist.id);
      results.push({
        id: entry.artist.id,
        name: entry.artist.name,
        profile_picture_url: entry.artist.profile_picture_url,
        fallback_image_url: entry.artist.fallback_image_url,
        relevanceScore: entry.score,
        category: 'similar',
      });
    }
  }

  // ── PASSE 3 : Découverte — artistes aléatoires jamais écoutés ──
  if (results.length < maxArtists) {
    const unheardArtists = allArtists.filter(
      (a) => !selectedIds.has(a.id) && !excluded.has(a.id) && !listenedIds.has(a.id),
    );
    // Fisher-Yates shuffle avec seed journalier (mêmes artistes toute la journée)
    const rng = mulberry32(getDailySeed());
    for (let i = unheardArtists.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [unheardArtists[i], unheardArtists[j]] = [unheardArtists[j], unheardArtists[i]];
    }
    const discoveryBudget = Math.min(discoveryCount, maxArtists - results.length, unheardArtists.length);
    for (let i = 0; i < discoveryBudget; i++) {
      const artist = unheardArtists[i];
      if (!artist) break;
      selectedIds.add(artist.id);
      results.push({
        id: artist.id,
        name: artist.name,
        profile_picture_url: artist.profile_picture_url,
        fallback_image_url: artist.fallback_image_url,
        relevanceScore: 10,
        category: 'discovery',
      });
    }
  }

  return results;
}

// ── Algorithme de recommandation (similaires à un artiste) ────────────────

/**
 * Calcule les artistes similaires à un artiste source via le graphe de co-occurrences.
 *
 * Stratégie :
 * 1. **Collaborateurs directs** : Artistes ayant collaboré avec l'artiste source (score × poids fort)
 * 2. **Second degré** : Artistes ayant collaboré AVEC les collaborateurs de l'artiste source
 * 3. **Aucune découverte aléatoire** — tout est basé sur le graphe
 *
 * @param cache Catalogue complet
 * @param sourceArtistId ID de l'artiste de référence
 * @param maxArtists Nombre maximum de résultats
 */
function computeSimilarArtists(
  cache: FreeCatalogCache,
  sourceArtistId: string,
  maxArtists: number,
): ArtistResult[] {
  const allArtists: FlatArtist[] = buildArtistsFromAlbums(cache.albums);
  const artistMap = new Map<string, FlatArtist>(allArtists.map((a) => [a.id, a]));

  // Construire le graphe de co-occurrences
  const coOccurrenceGraph = buildCoOccurrenceGraph(cache);

  // Vérifier que l'artiste source existe dans le graphe
  const sourceCollabs = coOccurrenceGraph.get(sourceArtistId);
  if (!sourceCollabs || sourceCollabs.size === 0) {
    // Pas de collaborations → impossible de trouver des similaires
    return [];
  }

  const selectedIds = new Set<string>([sourceArtistId]);
  const results: ArtistResult[] = [];

  // ── PASSE 1 : Collaborateurs directs (artistes ayant fait un feat avec la source) ──
  const directCollabs: { artist: FlatArtist; collabCount: number }[] = [];
  for (const [collabId, count] of sourceCollabs) {
    const collabArtist = artistMap.get(collabId);
    if (!collabArtist) continue;
    directCollabs.push({ artist: collabArtist, collabCount: count });
  }
  // Trier par nombre de collaborations décroissant
  directCollabs.sort((a, b) => b.collabCount - a.collabCount);

  const directBudget = Math.min(directCollabs.length, Math.ceil(maxArtists * 0.6)); // 60% max pour les directs
  for (let i = 0; i < directBudget; i++) {
    const entry = directCollabs[i];
    if (!entry) break;
    selectedIds.add(entry.artist.id);
    results.push({
      id: entry.artist.id,
      name: entry.artist.name,
      profile_picture_url: entry.artist.profile_picture_url,
      fallback_image_url: entry.artist.fallback_image_url,
      relevanceScore: entry.collabCount * 100,
      category: 'similar',
    });
  }

  // ── PASSE 2 : Second degré (collaborateurs des collaborateurs) ──
  if (results.length < maxArtists) {
    const secondDegreeScores = new Map<string, { artist: FlatArtist; score: number }>();

    for (const [directCollabId] of sourceCollabs) {
      if (selectedIds.has(directCollabId)) continue;
      const secondCollabs = coOccurrenceGraph.get(directCollabId);
      if (!secondCollabs) continue;

      for (const [secondId, count] of secondCollabs) {
        if (selectedIds.has(secondId)) continue;
        const secondArtist = artistMap.get(secondId);
        if (!secondArtist) continue;

        const existing = secondDegreeScores.get(secondId);
        // Poids réduit pour le second degré (×5 au lieu de ×100)
        const newScore = (existing?.score ?? 0) + count * 5;
        secondDegreeScores.set(secondId, { artist: secondArtist, score: newScore });
      }
    }

    const sortedSecondDegree = Array.from(secondDegreeScores.values())
      .sort((a, b) => b.score - a.score);

    const secondBudget = Math.min(sortedSecondDegree.length, maxArtists - results.length);
    for (let i = 0; i < secondBudget; i++) {
      const entry = sortedSecondDegree[i];
      if (!entry) break;
      selectedIds.add(entry.artist.id);
      results.push({
        id: entry.artist.id,
        name: entry.artist.name,
        profile_picture_url: entry.artist.profile_picture_url,
        fallback_image_url: entry.artist.fallback_image_url,
        relevanceScore: entry.score,
        category: 'similar',
      });
    }
  }

  return results;
}

// ── Composant ──────────────────────────────────────────────────────────────

/**
 * Section Bento « Artistes Recommandés » — 100% côté client.
 *
 * Algorithme en 3 passes :
 * 1. **Fréquents** : Les artistes les plus écoutés par l'utilisateur (via localStorage)
 * 2. **Similaires** : Artistes ayant collaboré avec les plus écoutés (graphe de co-occurrences)
 * 3. **Découverte** : Artistes aléatoires jamais écoutés, pour renouveler les suggestions
 */
export function ArtistRecommendations({
  excludeArtistIds = [],
  maxArtists = 12,
  discoveryCount = 3,
  sectionTitle = 'Artistes recommandés',
  hideViewAll = false,
  sourceArtistId,
}: ArtistRecommendationsProps) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [recommendations, setRecommendations] = useState<ArtistResult[]>([]);

  // Stabilité des dépendances
  const stableExcludeIds = useMemo(() => excludeArtistIds, [JSON.stringify(excludeArtistIds)]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cache = await readFreeCatalogCache();
      if (!cache || cancelled) return;

      let results: ArtistResult[];

      if (sourceArtistId) {
        // Mode "similaires" : basé sur le graphe de co-occurrences uniquement
        results = computeSimilarArtists(cache, sourceArtistId, maxArtists);
      } else {
        // Mode "recommandations" : basé sur l'historique d'écoute
        const topListened = getTopArtists(20);
        const listenedIds = getListenedArtistIds();
        results = computeRecommendations(cache, topListened, listenedIds, stableExcludeIds, maxArtists, discoveryCount);
      }

      if (!cancelled) setRecommendations(results);
    })();

    return () => { cancelled = true; };
  }, [stableExcludeIds, maxArtists, discoveryCount, sourceArtistId]);

  if (recommendations.length === 0) return null;

  const hasFrequent = recommendations.some((r) => r.category === 'frequent');
  const hasDiscovery = recommendations.some((r) => r.category === 'discovery');
  const hasSimilar = recommendations.some((r) => r.category === 'similar');

  return (
    <div className="artist-recommendations-section" style={{ position: 'relative' }}>
      {/* En-tête de section */}
      <div className="section-header" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-full)',
            background: 'linear-gradient(135deg, #FF6B6B, #C084FC)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 12px rgba(192,132,252,0.25)',
          }}>
            <Sparkles size={16} color="#fff" />
          </div>
          <div>
            <h2 className="section-title" style={{ margin: 0, fontSize: 22 }}>
              {sectionTitle}
            </h2>
            <p style={{
              color: 'var(--color-text-muted)',
              fontSize: 13,
              margin: '2px 0 0',
              fontWeight: 500,
            }}>
              {sourceArtistId
                ? 'Basé sur les collaborations et featurings'
                : sectionTitle === 'Artistes'
                  ? hasFrequent
                    ? 'Basé sur vos écoutes · Recommandations personnalisées'
                    : 'Découvrez de nouveaux artistes'
                  : hasFrequent && hasDiscovery
                    ? 'Basé sur vos écoutes · Collaborations et nouveautés'
                    : hasFrequent
                      ? 'Basé sur vos artistes et leurs collaborations'
                      : 'Découvrez de nouveaux artistes'}
            </p>
          </div>
        </div>
        {!hideViewAll && (
          <span
            className="section-link"
            onClick={() => navigate('/artists')}
            style={{ cursor: 'pointer', fontSize: 14 }}
          >
            Voir tout →
          </span>
        )}
      </div>

      {/* Tags de catégorie */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 14,
        flexWrap: 'wrap',
      }}>
        {hasFrequent && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(255,107,107,0.1)',
            border: '1px solid rgba(255,107,107,0.2)',
            color: '#FF6B6B',
            fontSize: 11,
            fontWeight: 700,
          }}>
            <TrendingUp size={12} />
            Les plus écoutés
          </span>
        )}
        {hasSimilar && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.2)',
            color: '#60A5FA',
            fontSize: 11,
            fontWeight: 700,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Collaborations
          </span>
        )}
        {hasDiscovery && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(192,132,252,0.1)',
            border: '1px solid rgba(192,132,252,0.2)',
            color: '#C084FC',
            fontSize: 11,
            fontWeight: 700,
          }}>
            <Compass size={12} />
            À découvrir
          </span>
        )}
      </div>

      {/* Liste horizontale avec scroll */}
      <div style={{ position: 'relative' }}>
        <div
          ref={scrollRef}
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            padding: '4px 2px',
            scrollbarWidth: 'none',
            scrollBehavior: 'smooth',
          }}
        >
          {recommendations.map((artist, index) => (
            <div
              key={artist.id}
              style={{
                minWidth: 170,
                flexShrink: 0,
                animation: 'slideUp 0.35s ease both',
                animationDelay: `${index * 0.05}s`,
              }}
            >
              <div style={{ position: 'relative' }}>
                <ArtistCard
                  artist={artist}
                  onPress={() => navigate(`/artist/${artist.id}`)}
                />
                {artist.category === 'frequent' && artist.playCount && artist.playCount > 2 && (
                  <div style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: 'rgba(255,107,107,0.9)',
                    borderRadius: 'var(--radius-full)',
                    padding: '2px 7px',
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#fff',
                    lineHeight: '16px',
                    backdropFilter: 'blur(4px)',
                  }}>
                    {artist.playCount}
                  </div>
                )}
                {artist.category === 'similar' && !sourceArtistId && (
                  <div style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: 'rgba(59,130,246,0.9)',
                    borderRadius: '12px',
                    padding: '3px 8px',
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    backdropFilter: 'blur(4px)',
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                    Feat
                  </div>
                )}
                {artist.category === 'discovery' && (
                  <div style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: 'rgba(192,132,252,0.9)',
                    borderRadius: '12px',
                    padding: '3px 8px',
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#fff',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}>
                    <Compass size={10} />
                    NEW
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Boutons de défilement */}
        {recommendations.length > 5 && (
          <>
            <button
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollBy({ left: -380, behavior: 'smooth' });
              }}
              className="btn-ghost desktop-only"
              style={{
                position: 'absolute',
                left: -10,
                top: '45%',
                transform: 'translateY(-50%)',
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-full)',
                padding: 0,
                background: 'var(--color-bg-dark)',
                border: '1px solid var(--color-border-subtle)',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => {
                const el = scrollRef.current;
                if (el) el.scrollBy({ left: 380, behavior: 'smooth' });
              }}
              className="btn-ghost desktop-only"
              style={{
                position: 'absolute',
                right: -10,
                top: '45%',
                transform: 'translateY(-50%)',
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-full)',
                padding: 0,
                background: 'var(--color-bg-dark)',

                border: '1px solid var(--color-border-subtle)',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
