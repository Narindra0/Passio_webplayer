/**
 * networkUtils.ts — Utilitaires réseau partagés entre les lecteurs audio.
 *
 * Centralise la logique de retry avec keepalive pour éviter la duplication
 * entre mseSecurePlayer.ts et secureAudioPlayer.ts.
 *
 * keepalive: true maintient la connexion TCP/TLS ouverte entre les requêtes,
 * ce qui évite la renégociation HTTP/3 ↔ HTTP/2 sur Render.
 */

/** Délai exponentiel avec jitter pour les retries. */
export function getRetryDelay(attempt: number): number {
  const baseDelay = 500;
  const delay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 200;
  return Math.min(delay + jitter, 5000);
}

/**
 * Vérifie si une erreur fetch est probablement liée à QUIC/HTTP3.
 */
export function isQuicRelatedError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('networkerror') ||
      msg.includes('failed to fetch') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      (msg.includes('abort') === false) // pas une simple annulation
    );
  }
  return false;
}

/**
 * Options pour fetchWithRetry.
 */
export interface FetchWithRetryOptions extends RequestInit {
  retries?: number;
}

/**
 * Fetch avec keepalive + retry pour les erreurs réseau QUIC/HTTP3.
 *
 * - keepalive: true évite la renégociation HTTP/3 ↔ HTTP/2
 * - Exponential backoff avec jitter sur les erreurs réseau
 * - Les AbortError sont immédiatement propagées (pas de retry)
 *
 * @param url URL à fetcher
 * @param options Options RequestInit + retries optionnel (défaut: 3)
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxRetries = options.retries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 🔒 credentials: 'include' requis pour les requêtes cross-origin vers l'API.
      // Mais pour le Cloudflare B2 proxy (/audio/artists/...), on doit utiliser 'omit'
      // car le proxy retourne Access-Control-Allow-Origin: * (incompatible avec 'include').
      const defaultCredentials = url.includes('/audio/artists/') ? 'omit' : 'include';

      const response = await fetch(url, {
        credentials: defaultCredentials,
        ...options,
      });
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // AbortError = arrêt volontaire, on ne réessaie pas
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }

      // Erreur réseau QUIC/HTTP3 ou autre → on réessaie avec backoff
      if (attempt < maxRetries) {
        const delay = getRetryDelay(attempt);
        const type = isQuicRelatedError(err) ? '⚡ QUIC' : 'réseau';
        console.warn(
          `[Network] ${type} (tentative ${attempt + 1}/${maxRetries + 1}), ` +
          `reconnexion dans ${Math.round(delay)}ms:`,
          lastError.message
        );
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }

  throw lastError ?? new Error('fetchWithRetry: échec après toutes les tentatives');
}
