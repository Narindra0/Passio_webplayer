/**
 * listeningHistory.ts — Traqueur d'écoute local.
 *
 * Enregistre le nombre de lectures par artiste dans localStorage.
 * Utilisé par le système de recommandation pour proposer
 * les artistes les plus écoutés et découvrir des artistes similaires.
 */

import { logger } from '@/utils/logger';

const STORAGE_KEY = 'passio_listening_history';
const MAX_ARTISTS = 100;

export interface ListeningHistoryEntry {
  artistId: string;
  artistName: string;
  playCount: number;
  lastPlayedAt: string; // ISO timestamp
}

export type ListeningHistory = Record<string, ListeningHistoryEntry>;

/**
 * Lit l'historique d'écoute depuis localStorage.
 */
export function readListeningHistory(): ListeningHistory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ListeningHistory;
    // Validation basique : s'assurer que c'est un objet
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Sauvegarde l'historique d'écoute dans localStorage.
 */
function writeListeningHistory(history: ListeningHistory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    logger.warn('[ListeningHistory] Sauvegarde impossible:', err);
  }
}

/**
 * Enregistre la lecture d'un artiste.
 * Incrémente le compteur et met à jour le timestamp.
 *
 * @param artistId  Identifiant unique de l'artiste
 * @param artistName Nom affiché de l'artiste
 */
export function recordArtistPlay(artistId: string, artistName: string): void {
  if (!artistId) return;

  const history = readListeningHistory();
  const existing = history[artistId];

  history[artistId] = {
    artistId,
    artistName,
    playCount: (existing?.playCount ?? 0) + 1,
    lastPlayedAt: new Date().toISOString(),
  };

  // Élaguer si on dépasse le maximum d'artistes
  const entries = Object.values(history);
  if (entries.length > MAX_ARTISTS) {
    // Trier par lastPlayedAt (plus récent d'abord) et garder MAX_ARTISTS
    entries.sort((a, b) => new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime());
    const pruned: ListeningHistory = {};
    entries.slice(0, MAX_ARTISTS).forEach((e) => { pruned[e.artistId] = e; });
    writeListeningHistory(pruned);
    return;
  }

  writeListeningHistory(history);
}

/**
 * Retourne les artistes les plus écoutés, triés par nombre de lectures décroissant.
 *
 * @param limit Nombre maximum d'artistes à retourner (défaut: 10)
 */
export function getTopArtists(limit: number = 10): ListeningHistoryEntry[] {
  const history = readListeningHistory();
  return Object.values(history)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, limit);
}

/**
 * Retourne le nombre de lectures pour un artiste donné.
 */
export function getArtistPlayCount(artistId: string): number {
  if (!artistId) return 0;
  const history = readListeningHistory();
  return history[artistId]?.playCount ?? 0;
}

/**
 * Retourne les identifiants des artistes déjà écoutés (pour exclusion).
 */
export function getListenedArtistIds(): Set<string> {
  const history = readListeningHistory();
  return new Set(Object.keys(history));
}

/**
 * Vide complètement l'historique d'écoute.
 */
export function clearListeningHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
