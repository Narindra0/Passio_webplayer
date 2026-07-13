/**
 * consentManager.ts — Gestionnaire de consentement RGPD.
 *
 * Fonctions :
 *   - Persistance du statut dans localStorage (sans consentement = pas de tracking)
 *   - Synchronisation asynchrone avec le Worker Cloudflare (table D1 `consents`)
 *   - Fonction de retrait : DELETE en cascade sur toutes les tables liées au device
 *   - API synchrone pour les vérifications instantanées (évite les async dans le hot path)
 *
 * ⚠️ Principe fondamental : tant que getConsentStatus() !== 'granted',
 *    aucune donnée de tracking n'est envoyée au Worker (streamTracker.ts le vérifie).
 */

import { logger } from '@/utils/logger';
import { getOrCreateDeviceId } from './device';

// ─── Types ────────────────────────────────────────────────────────────────

export type ConsentStatus = 'unknown' | 'granted' | 'denied' | 'withdrawn';

// ─── Configuration ────────────────────────────────────────────────────────

const STORAGE_KEY = 'passio_consent';
const WORKER_CONSENT_ROUTE = '/api/v2/consent';
const WORKER_WITHDRAW_ROUTE = '/api/v2/consent/withdraw';

// ─── Cache synchrone (évite les accès localStorage répétés) ───────────────

let cachedStatus: ConsentStatus | null = null;

// ─── API Publique ─────────────────────────────────────────────────────────

/**
 * Retourne le statut de consentement depuis le cache ou localStorage.
 * Fonction synchrone — utilisable dans les hot paths (streamTracker.ts).
 */
export function getConsentStatus(): ConsentStatus {
  if (cachedStatus) return cachedStatus;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'granted') cachedStatus = 'granted';
    else if (raw === 'denied') cachedStatus = 'denied';
    else if (raw === 'withdrawn') cachedStatus = 'withdrawn';
    else cachedStatus = 'unknown';
  } catch {
    cachedStatus = 'unknown';
  }

  return cachedStatus;
}

/**
 * Vérifie rapidement si le tracking est autorisé.
 * C'est la fonction utilisée par streamTracker.ts avant chaque envoi.
 */
export function isTrackingAllowed(): boolean {
  return getConsentStatus() === 'granted';
}

/**
 * Enregistre le consentement localement ET sur le Worker.
 *
 * @param status - 'granted' ou 'denied'
 */
export async function setConsent(status: 'granted' | 'denied'): Promise<void> {
  // 1. Persistance locale immédiate (synchrone, pour les vérifications suivantes)
  try {
    localStorage.setItem(STORAGE_KEY, status);
  } catch { /* ignore */ }
  cachedStatus = status;

  // 2. Sync asynchrone avec le Worker (Fire & Forget — ne bloque pas le rendu)
  syncConsentToWorker(status).catch(() => {
    logger.warn('[Consent] Sync Worker impossible — le consentement reste en local');
  });
}

/**
 * Retire le consentement : envoie une demande de DELETE en cascade au Worker,
 * puis nettoie le localStorage côté client.
 */
export async function withdrawConsent(): Promise<{ success: boolean; message: string }> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const baseUrl = getWorkerBaseUrl();
    const url = `${baseUrl}${WORKER_WITHDRAW_ROUTE}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-passio-device-id': deviceId,
      },
      body: JSON.stringify({ deviceId }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: false,
        message: (data as { error?: string }).error || 'Erreur lors du retrait de consentement',
      };
    }

    // ✅ Nettoyage local
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('passio_device_id');
      localStorage.removeItem('passio_listening_history');
    } catch { /* ignore */ }
    cachedStatus = 'withdrawn';

    return { success: true, message: 'Consentement retiré. Toutes les données ont été supprimées.' };
  } catch (err) {
    logger.error('[Consent] Erreur retrait consentement:', err);
    return {
      success: false,
      message: 'Impossible de contacter le serveur. Veuillez réessayer.',
    };
  }
}

/**
 * Réinitialise le cache (utile après un clear localStorage externe).
 */
export function resetConsentCache(): void {
  cachedStatus = null;
}

// ─── Interne ──────────────────────────────────────────────────────────────

function getWorkerBaseUrl(): string {
  if (import.meta.env.DEV) {
    return 'http://localhost:8787';
  }
  return '';
}

async function syncConsentToWorker(status: ConsentStatus): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const baseUrl = getWorkerBaseUrl();
    const url = `${baseUrl}${WORKER_CONSENT_ROUTE}`;

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-passio-device-id': deviceId,
      },
      body: JSON.stringify({ deviceId, status }),
      keepalive: true,
    });
  } catch {
    // Fire & Forget silencieux
  }
}
