/**
 * dailyMix.ts — Générateur de playlist « Daily Mix ».
 *
 * Algorithme :
 *   1. Prend les 3 artistes les plus écoutés (topArtists)
 *   2. Prend les 3 meilleurs artistes recommandés (scoredArtists via graphe de collabs)
 *   3. Pour chaque artiste source, pioche jusqu'à 4 de ses titres
 *   4. Pour chaque artiste recommandé, pioche jusqu'à 2 de ses titres
 *   5. Mélange le tout avec un seed journalier → même mix toute la journée
 *   6. Limite à 20 titres maximum
 *   7. Cache le résultat dans localStorage (clé = date du jour)
 *
 * Le cache permet d'éviter de recalculer le mix à chaque rendu et garantit
 * la stabilité visuelle : l'utilisateur voit le même mix jusqu'à minuit.
 */

import type { TrackWithAlbum } from '@/components/TrackListItem';
import type { ScoredArtist } from '@/services/graphRecommendations';
import type { ListeningHistoryEntry } from '@/services/listeningHistory';
import { normalizeArtistName } from '@/utils/featArtists';
import { logger } from '@/utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DailyMixTrack {
  /** ID de la piste */
  trackId: string;
  /** ID de l'album parent */
  albumId: string;
  /** Titre de la piste */
  title: string;
  /** Nom de l'artiste */
  artistName: string;
  /** URL de la cover (pour l'affichage) */
  coverUrl: string | null | undefined;
}

export interface DailyMix {
  /** Identifiant unique du mix (date YYYY-MM-DD) */
  id: string;
  /** Liste des pistes du mix */
  tracks: DailyMixTrack[];
  /** Label lisible du jour (ex: « Lundi 14 Juillet ») */
  dayLabel: string;
  /** Timestamp de génération */
  generatedAt: number;
  /** Nombre total de pistes */
  trackCount: number;
}

// ── Constantes ─────────────────────────────────────────────────────────────

const DAILY_MIX_CACHE_KEY = 'passio_daily_mix';
const MAX_TOP_ARTISTS = 3;       // Artistes les plus écoutés
const MAX_RECOMMENDED_ARTISTS = 3; // Artistes recommandés via collabs
const MAX_TRACKS_PER_TOP_ARTIST = 4;
const MAX_TRACKS_PER_RECOMMENDED_ARTIST = 2;
const MAX_TOTAL_TRACKS = 20;

// ── PRNG seedé par la date (stable toute la journée) ───────────────────────

/**
 * Générateur pseudo-aléatoire Mulberry32.
 * Produit une séquence déterministe à partir d'un seed.
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
 * Calcule un seed pour la date d'aujourd'hui (YYYY-MM-DD).
 * Le même seed est retourné toute la journée → mêmes choix aléatoires.
 */
function getDailySeed(): number {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    const char = dateStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Retourne le label du jour en français.
 * Exemple : « Lundi 14 Juillet 2026 »
 */
function getDayLabel(): string {
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const months = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  ];
  const now = new Date();
  const dayName = days[now.getDay()];
  const day = now.getDate();
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  return `${dayName} ${day} ${month} ${year}`;
}

/**
 * Retourne l'ID du mix pour aujourd'hui (YYYY-MM-DD).
 */
function getTodayId(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ── Cache localStorage ─────────────────────────────────────────────────────

function readCachedMix(): DailyMix | null {
  try {
    const raw = localStorage.getItem(DAILY_MIX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyMix;
    // Vérifier que le cache est d'aujourd'hui
    if (parsed.id !== getTodayId()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedMix(mix: DailyMix): void {
  try {
    localStorage.setItem(DAILY_MIX_CACHE_KEY, JSON.stringify(mix));
  } catch (err) {
    logger.warn('[DailyMix] ❌ Sauvegarde du cache impossible:', err);
  }
}

// ── Algorithme de génération ───────────────────────────────────────────────

/**
 * Fisher-Yates shuffle avec seed (déterministe).
 */
function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  const rng = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Génère le Daily Mix du jour.
 *
 * @param freeTracks      Tous les titres disponibles
 * @param topArtists      Les artistes les plus écoutés
 * @param scoredArtists   Les artistes recommandés (via graphe de collabs)
 * @returns               Le Daily Mix du jour (ou null si pas assez de contenu)
 */
export function generateDailyMix(
  freeTracks: TrackWithAlbum[],
  topArtists: ListeningHistoryEntry[],
  scoredArtists: ScoredArtist[],
): DailyMix | null {
  // Vérifier le cache
  const cached = readCachedMix();
  if (cached) return cached;

  if (freeTracks.length === 0) return null;
  if (topArtists.length === 0 && scoredArtists.length === 0) return null;

  // ── 1. Indexer les titres par artiste normalisé ──
  const tracksByArtist = new Map<string, TrackWithAlbum[]>();
  for (const track of freeTracks) {
    const normName = normalizeArtistName(track.artist_name);
    if (!normName) continue;
    if (!tracksByArtist.has(normName)) {
      tracksByArtist.set(normName, []);
    }
    tracksByArtist.get(normName)!.push(track);
  }

  const selectedTracks: DailyMixTrack[] = [];
  const seenTrackIds = new Set<string>();
  const selectedArtistNames = new Set<string>();

  // Helper pour ajouter des tracks d'un artiste
  function addArtistTracks(
    normName: string,
    maxTracks: number,
  ): void {
    if (selectedArtistNames.has(normName)) return;
    selectedArtistNames.add(normName);

    const artistTracks = tracksByArtist.get(normName);
    if (!artistTracks || artistTracks.length === 0) return;

    // Seed pour cet artiste (basé sur le nom + date)
    const artistSeed = getDailySeed() + normName.length * 31;
    const shuffled = seededShuffle(artistTracks, artistSeed);

    let added = 0;
    for (const track of shuffled) {
      if (added >= maxTracks) break;
      if (seenTrackIds.has(track.id)) continue;
      seenTrackIds.add(track.id);
      selectedTracks.push({
        trackId: track.id,
        albumId: track.album_id,
        title: track.title,
        artistName: track.artist_name,
        coverUrl: track.cover_url,
      });
      added++;
    }
  }

  // ── 2. Piocher chez les artistes les plus écoutés ──
  for (const entry of topArtists.slice(0, MAX_TOP_ARTISTS)) {
    const normName = normalizeArtistName(entry.artistName);
    if (normName) addArtistTracks(normName, MAX_TRACKS_PER_TOP_ARTIST);
    if (selectedTracks.length >= MAX_TOTAL_TRACKS) break;
  }

  // ── 3. Piocher chez les artistes recommandés (collaborations) ──
  if (selectedTracks.length < MAX_TOTAL_TRACKS && scoredArtists.length > 0) {
    for (const artist of scoredArtists.slice(0, MAX_RECOMMENDED_ARTISTS)) {
      addArtistTracks(artist.artistName, MAX_TRACKS_PER_RECOMMENDED_ARTIST);
      if (selectedTracks.length >= MAX_TOTAL_TRACKS) break;
    }
  }

  // ── 4. Si pas assez de tracks, compléter avec des tracks aléatoires ──
  if (selectedTracks.length < 5) {
    const seed = getDailySeed() + 999;
    const remaining = freeTracks.filter(t => !seenTrackIds.has(t.id));
    const shuffled = seededShuffle(remaining, seed);
    for (const track of shuffled) {
      if (selectedTracks.length >= MAX_TOTAL_TRACKS) break;
      if (seenTrackIds.has(track.id)) continue;
      seenTrackIds.add(track.id);
      selectedTracks.push({
        trackId: track.id,
        albumId: track.album_id,
        title: track.title,
        artistName: track.artist_name,
        coverUrl: track.cover_url,
      });
    }
  }

  // ── 5. Mélanger le tout avec un seed quotidien ──
  const finalTracks = seededShuffle(selectedTracks, getDailySeed()).slice(0, MAX_TOTAL_TRACKS);

  if (finalTracks.length < 3) return null;

  const mix: DailyMix = {
    id: getTodayId(),
    tracks: finalTracks,
    dayLabel: getDayLabel(),
    generatedAt: Date.now(),
    trackCount: finalTracks.length,
  };

  // Mettre en cache
  writeCachedMix(mix);

  return mix;
}

/**
 * Vide le cache du Daily Mix (utile après un rechargement des données).
 */
export function clearDailyMixCache(): void {
  try {
    localStorage.removeItem(DAILY_MIX_CACHE_KEY);
  } catch {
    // ignore
  }
}
