/**
 * streamTracker.ts — Service client pour le tracking d'écoutes
 *                     et les recommandations collaboratives.
 *
 * Principes fondamentaux :
 *   🔥 Fire & Forget : les requêtes réseau ne bloquent JAMAIS la lecture
 *   🛡️ Silencieux : toutes les erreurs sont ignorées (try/catch partout)
 *   ⏱️ Timeout : 3s max pour les recommandations (AbortSignal.timeout)
 *   🔁 keepalive : les requêtes POST survivent à la fermeture de la page
 */

import { getOrCreateDeviceId } from './device';
import { isTrackingAllowed } from './consentManager';
import { logger } from '@/utils/logger';

// ─── Configuration ────────────────────────────────────────────────────────

let workerBaseUrl: string | null = null;

/**
 * Surcharge l'URL de base du Worker (utile pour les tests ou custom domain).
 */
export function setStreamTrackerBaseUrl(url: string): void {
  workerBaseUrl = url;
}

/**
 * Retourne l'URL de base du Worker selon l'environnement.
 *
 * - DEV (Vite)    → localhost:8787 (port par défaut de wrangler dev)
 * - Production    → chaîne vide = même origine (le Worker sert les assets)
 */
function getBaseUrl(): string {
  if (workerBaseUrl) return workerBaseUrl.replace(/\/+$/, '');
  if (import.meta.env.DEV) {
    return 'http://localhost:8787';
  }
  return '';
}

// ─── API Publique (V1 — existant, mis à jour avec consentement) ────────────

/**
 * Enregistre la fin d'une piste auprès du Worker Cloudflare.
 *
 * 🔥 Fire & Forget : la promesse n'est pas attendue.
 * 📡 keepalive: true pour que la requête survive à la fermeture de page.
 * 🛡️ Silencieux : en cas d'erreur (réseau, Worker down), rien ne se passe.
 * 🚫 Bloqué si consentement !== 'granted' (aucun envoi réseau).
 *
 * @param trackId     - Piste qui vient de se terminer
 * @param fromTrackId - Piste précédente (pour la transition collaborative)
 */
export function recordTrackEnded(
  trackId: string,
  fromTrackId?: string,
): void {
  // 🚫 Vérification consentement : pas de tracking sans consentement explicite
  if (!isTrackingAllowed()) return;

  // Fire & Forget : on lance la requête sans l'await
  doRecordTrackEnded(trackId, fromTrackId).catch(() => {
    // Totalement silencieux
  });
}

/**
 * Interroge le moteur de recommandation collaborative.
 *
 * 🔄 Timeout 3s : si le Worker ne répond pas, on retourne null
 *    et l'appelant (handleAutoplay) bascule sur son fallback.
 * 🛡️ Silencieux : les erreurs réseau retournent null.
 *
 * @param fromTrackId - Piste de référence pour la recommandation
 * @returns La piste recommandée ou null si indisponible
 */
export async function fetchCollaborativeRecommendation(
  fromTrackId: string,
): Promise<{ trackId: string; score: number } | null> {
  try {
    const baseUrl = getBaseUrl();
    if (!baseUrl && !import.meta.env.DEV) {
      // En production, baseUrl est vide → même origine
      // On utilise l'origine courante
    }
    const effectiveBase = baseUrl || '';
    const url = `${effectiveBase}/api/v1/recommend?fromTrackId=${encodeURIComponent(fromTrackId)}`;

    // Retirer le header device_id si pas de consentement (le Worker le gère sans)
    const isAllowed = isTrackingAllowed();
    const headers: Record<string, string> = {};
    if (isAllowed) {
      headers['x-passio-device-id'] = await getOrCreateDeviceId();
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      // Timeout 3s : ne pas bloquer l'autoplay plus longtemps
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      trackId: string | null;
      score?: number;
      source: string;
    };

    if (data.trackId && data.source === 'collaborative') {
      return { trackId: data.trackId, score: data.score ?? 0 };
    }

    return null;
  } catch (err) {
    // Timeout, réseau, Worker down → fallback silencieux
    logger.warn('[StreamTracker] Recommendation fetch failed:', err);
    return null;
  }
}

/**
 * Récupère le nombre d'écoutes enregistrées pour une piste.
 * Utile pour afficher un badge "🔥 N écoutes" dans l'UI.
 *
 * @returns Le nombre d'écoutes ou 0 si non trouvé / erreur
 */
export async function fetchTrackStreamCount(trackId: string): Promise<number> {
  try {
    const baseUrl = getBaseUrl();
    const effectiveBase = baseUrl || '';
    const url = `${effectiveBase}/api/v1/streams/count/${encodeURIComponent(trackId)}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return 0;

    const data = await response.json() as { trackId: string; count: number };
    return data.count;
  } catch {
    return 0;
  }
}

/**
 * Récupère le top 50 des pistes les plus écoutées.
 *
 * @returns Liste des { trackId, count } triés du plus streamé au moins streamé
 */
export async function fetchPopularTracks(): Promise<{ trackId: string; count: number }[]> {
  try {
    const baseUrl = getBaseUrl();
    const effectiveBase = baseUrl || '';
    const url = `${effectiveBase}/api/v1/streams/popular`;

    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return [];

    const data = await response.json() as { tracks: { trackId: string; count: number }[] };
    return data.tracks?.slice(0, 50) ?? [];
  } catch {
    return [];
  }
}

// ─── API Publique (V2 — analytics enrichi, consentement obligatoire) ────

/**
 * Enregistre la progression d'une piste (pour mesurer le taux de complétion).
 *
 * 🔥 Fire & Forget
 * 🚫 Bloqué si consentement !== 'granted'
 *
 * @param trackId    - Piste en cours
 * @param progressPct - Ratio de progression (0.0 à 1.0)
 * @param durationSec - Durée écoutée en secondes
 */
export function recordTrackProgress(
  trackId: string,
  progressPct: number,
  durationSec: number,
): void {
  if (!isTrackingAllowed()) return;

  doRecordTrackEvent(trackId, 'progress', progressPct, durationSec).catch(() => {
    // Silencieux
  });
}

/**
 * Enregistre un skip de piste (l'utilisateur passe à la suivante avant la fin).
 *
 * 🔥 Fire & Forget
 * 🚫 Bloqué si consentement !== 'granted'
 *
 * @param trackId     - Piste skippée
 * @param progressPct - Progression au moment du skip
 * @param durationSec - Durée écoutée avant le skip
 */
export function recordTrackSkip(
  trackId: string,
  progressPct: number,
  durationSec: number,
): void {
  if (!isTrackingAllowed()) return;

  doRecordTrackEvent(trackId, 'skip', progressPct, durationSec).catch(() => {
    // Silencieux
  });
}

/**
 * Enregistre une page vue (navigation).
 *
 * 🔥 Fire & Forget
 * 🚫 Bloqué si consentement !== 'granted'
 *
 * @param path     - Chemin de la page visitée (ex: /album/abc123)
 * @param referrer - Page précédente (document.referrer)
 */
export function recordPageView(path: string, referrer?: string): void {
  if (!isTrackingAllowed()) return;

  doRecordPageView(path, referrer).catch(() => {
    // Silencieux
  });
}

/**
 * Enregistre les informations techniques de l'appareil.
 * Appelé une fois lors de la première session après consentement.
 *
 * 🔥 Fire & Forget
 * 🚫 Bloqué si consentement !== 'granted'
 */
export function recordDeviceInfo(): void {
  if (!isTrackingAllowed()) return;

  doRecordDeviceInfo().catch(() => {
    // Silencieux
  });
}

// ─── Interne (V1) ─────────────────────────────────────────────────────────

async function doRecordTrackEnded(
  trackId: string,
  fromTrackId?: string,
): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const baseUrl = getBaseUrl();
    const effectiveBase = baseUrl || '';
    const url = `${effectiveBase}/api/v1/streams`;

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-passio-device-id': deviceId,
        'x-passio-consent': 'granted',
      },
      body: JSON.stringify({
        trackId,
        fromTrackId: fromTrackId || undefined,
      }),
      // keepalive: la requête survit à la fermeture de l'onglet
      keepalive: true,
    });
  } catch {
    // 🔥 Fire & Forget garanti : aucune erreur ne remonte
  }
}

// ─── Interne (V2) ─────────────────────────────────────────────────────────

async function doRecordTrackEvent(
  trackId: string,
  eventType: 'ended' | 'progress' | 'skip',
  progressPct: number,
  durationSec: number,
): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const baseUrl = getBaseUrl();
    const effectiveBase = baseUrl || '';
    const url = `${effectiveBase}/api/v2/events`;

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-passio-device-id': deviceId,
        'x-passio-consent': 'granted',
      },
      body: JSON.stringify({
        eventType,
        trackId,
        progressPct,
        durationSec,
      }),
      keepalive: true,
    });
  } catch {
    // 🔥 Fire & Forget garanti
  }
}

async function doRecordPageView(
  path: string,
  referrer?: string,
): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const baseUrl = getBaseUrl();
    const effectiveBase = baseUrl || '';
    const url = `${effectiveBase}/api/v2/events`;

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-passio-device-id': deviceId,
        'x-passio-consent': 'granted',
      },
      body: JSON.stringify({
        eventType: 'page_view',
        path,
        referrer: referrer || null,
      }),
      keepalive: true,
    });
  } catch {
    // 🔥 Fire & Forget garanti
  }
}

async function doRecordDeviceInfo(): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const baseUrl = getBaseUrl();
    const effectiveBase = baseUrl || '';
    const url = `${effectiveBase}/api/v2/device`;

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-passio-device-id': deviceId,
        'x-passio-consent': 'granted',
      },
      body: JSON.stringify({
        screenW: window.screen?.width || 0,
        screenH: window.screen?.height || 0,
        platform: navigator.platform || '',
        language: navigator.language || '',
        browser: getBrowserName(),
        os: getOSName(),
      }),
      keepalive: true,
    });
  } catch {
    // 🔥 Fire & Forget garanti
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getBrowserName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  if (ua.includes('OPR/')) return 'Opera';
  return 'Unknown';
}

function getOSName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('Linux') && !ua.includes('Android')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('CrOS')) return 'ChromeOS';
  return 'Unknown';
}
