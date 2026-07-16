import type {
  ApiHealth,
  PassCodeActivationResponse,
  PublicAlbumDetails,
  PublicAlbumSummary
} from '@/types/backend';
import { getOrCreateDeviceId } from './device';
import { logger } from '@/utils/logger';

function getDefaultApiUrl(): string {
  return 'http://localhost:3001';
}

const API_URL = (import.meta.env.VITE_API_URL ?? getDefaultApiUrl()).replace(/\/+$/, '');

type RequestInitWithJson = Omit<RequestInit, 'body'> & { body?: unknown };

function isGetLikeRequest(init: RequestInitWithJson): boolean {
  return (init.method ?? 'GET').toUpperCase() === 'GET';
}

async function fetchWithCacheBypass(
  url: string,
  init: RequestInitWithJson,
  deviceId: string | null,
): Promise<Response> {
  const isGetLike = isGetLikeRequest(init);
  const requestHeaders = new Headers(init.headers);

  if (deviceId) {
    requestHeaders.set('x-passio-device-id', deviceId);
  }

  if (typeof init.body !== 'undefined') {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const requestInit: RequestInit = {
    ...init,
    headers: requestHeaders,
    body: typeof init.body === 'undefined' ? undefined : JSON.stringify(init.body),
    credentials: 'include',
    mode: 'cors',
    cache: isGetLike ? 'no-store' : init.cache,
  };

  const response = await fetch(url, requestInit);
  if (response.status !== 304 || !isGetLike) {
    return response;
  }

  logger.error('[API] 304 Not Modified on GET request, retrying without cache', {
    url,
    method: init.method ?? 'GET',
  });

  const retryHeaders = new Headers(requestHeaders);
  retryHeaders.set('Cache-Control', 'no-cache');
  retryHeaders.set('Pragma', 'no-cache');

  const retryResponse = await fetch(url, {
    ...requestInit,
    headers: retryHeaders,
    cache: 'reload',
  });

  if (retryResponse.status === 304) {
    logger.error('[API] 304 Not Modified persisted after cache-bypass retry', {
      url,
      method: init.method ?? 'GET',
    });
  }

  return retryResponse;
}

async function request<T>(path: string, init: RequestInitWithJson = {}): Promise<T> {
  const deviceId = await getOrCreateDeviceId().catch(() => null);

  // Cloudflare reverse proxy: use credentials so custom headers reach the API.
  // GET requests are forced through a cache-bypass path so 304 responses do not
  // break JSON parsing in production.
  const response = await fetchWithCacheBypass(`${API_URL}${path}`, init, deviceId);

  if (response.status === 304) {
    throw new Error(`Request failed with status 304 for ${path}`);
  }

  let data: unknown = null;
  try {
    // Toujours tenter le parsing JSON, même si Content-Type n'est pas
    // application/json. Cloudflare peut modifier/stripper les en-têtes,
    // mais le corps reste valide.
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    // Diagnostic 403: album key rejected
    if (response.status === 403) {
      const via = response.headers.get('cf-ray') ? 'cloudflare' : 'direct';
      logger.warn('[API] 403 Forbidden:', {
        path,
        via,
        deviceId: deviceId?.slice(0, 8) + '…',
        statusCode: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('Content-Type'),
        albumData: data && typeof data === 'object' ? 'yes' : 'no',
        hasAlbumKey: data && typeof data === 'object' && 'decryption_key' in (data as Record<string, unknown>),
        responseBody: data && typeof data === 'object' ? JSON.stringify(data).slice(0, 300) : '(non-JSON)',
      });
      if (data && typeof data === 'object' && 'album' in data) {
        return data as T;
      }
      throw new Error(`Accès refusé (403) — la clé de l'album semble invalide ou expirée. Path: ${path}`);
    }
    throw new Error(`Request failed with status ${response.status}`);
  }

  return data as T;
}

export function getApiBaseUrl(): string {
  return API_URL;
}

export function unwrapAlbumDetails(
  raw: PublicAlbumDetails | { album?: PublicAlbumDetails; message?: string } | null | undefined,
): PublicAlbumDetails {
  if (!raw) {
    throw new Error('unwrapAlbumDetails: received null/undefined response');
  }
  return (raw as { album?: PublicAlbumDetails }).album ?? (raw as PublicAlbumDetails);
}

export async function getHealth(): Promise<ApiHealth> {
  return request<ApiHealth>('/api/health', { method: 'GET' });
}

export async function listAlbums(): Promise<PublicAlbumSummary[]> {
  return request<PublicAlbumSummary[]>('/api/albums', { method: 'GET' });
}

export async function listOwnedAlbums(): Promise<PublicAlbumSummary[]> {
  return request<PublicAlbumSummary[]>('/api/albums/owned', { method: 'GET' });
}

export async function getAlbum(albumId: string): Promise<PublicAlbumDetails> {
  return request<PublicAlbumDetails>(`/api/albums/${albumId}`, { method: 'GET' });
}

export async function activatePassCode(passCode: string, deviceId: string): Promise<PassCodeActivationResponse> {
  return request<PassCodeActivationResponse>('/api/passcodes/activate', {
    method: 'POST',
    body: { code: passCode, device_id: deviceId },
  });
}

export async function refreshAlbumTracks(albumId: string): Promise<PublicAlbumDetails> {
  return request<PublicAlbumDetails>(`/api/albums/${albumId}`, { method: 'GET' });
}

export async function getAlbumDecryptionKey(albumId: string): Promise<{ decryption_key: string }> {
  return request<{ decryption_key: string }>(`/api/albums/${albumId}/key`, { method: 'GET' });
}

export async function fetchTrackLyricsText(trackId: string): Promise<string> {
  const deviceId = await getOrCreateDeviceId().catch(() => null);
  const headers: Record<string, string> = {};
  if (deviceId) headers['X-Passio-Device-Id'] = deviceId;

  const response = await fetch(
    `${API_URL}/api/albums/tracks/${encodeURIComponent(trackId)}/lyrics`,
    { method: 'GET', headers },
  );

  if (!response.ok) {
    throw new Error(`Lyrics request failed: ${response.status}`);
  }

  return response.text();
}

export async function fetchLyricsByUrl(lyricsUrl: string): Promise<string> {
  const deviceId = await getOrCreateDeviceId().catch(() => null);
  const headers: Record<string, string> = {};
  if (deviceId) headers['X-Passio-Device-Id'] = deviceId;

  const url = /^https?:\/\//i.test(lyricsUrl) ? lyricsUrl : `${API_URL}${lyricsUrl}`;
  const response = await fetch(url, { method: 'GET', headers });

  if (!response.ok) {
    throw new Error(`Lyrics request failed: ${response.status}`);
  }

  return response.text();
}

export async function getAudioToken(trackId: string): Promise<{ token: string; trackId: string }> {
  return request<{ token: string; trackId: string }>(`/api/stream/tracks/${encodeURIComponent(trackId)}/token`, { method: 'GET' });
}

/**
 * Récupère une URL signée (HMAC + timestamp) pour le streaming d'une piste.
 * L'URL est valide 1 heure et ne peut pas être partagée.
 * Nécessite que le backend soit configuré avec CLOUDFLARE_TOKEN_SECRET
 * et que Cloudflare WAF valide la signature via is_timed_hmac_valid_v0().
 */
export async function getSignedStreamUrl(trackId: string): Promise<{ url: string; expiresAt: number }> {
  return request<{ url: string; expiresAt: number }>(
    `/api/stream/signed/${encodeURIComponent(trackId)}`,
    { method: 'POST' },
  );
}
