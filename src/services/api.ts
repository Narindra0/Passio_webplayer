import type {
  ApiHealth,
  PassCodeActivationResponse,
  PublicAlbumDetails,
  PublicAlbumSummary
} from '@/types/backend';
import { getOrCreateDeviceId } from './device';

function getDefaultApiUrl(): string {
  return 'http://localhost:3001';
}

const API_URL = (import.meta.env.VITE_API_URL ?? getDefaultApiUrl()).replace(/\/+$/, '');

type RequestInitWithJson = Omit<RequestInit, 'body'> & { body?: unknown };

async function request<T>(path: string, init: RequestInitWithJson = {}): Promise<T> {
  const deviceId = await getOrCreateDeviceId().catch(() => null);

  const headers: Record<string, string> = {
    ...(deviceId ? { 'x-passio-device-id': deviceId } : {}),
  };

  if (typeof init.body !== 'undefined') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...((init.headers as Record<string, string>) ?? {}),
    },
    body: typeof init.body === 'undefined' ? undefined : JSON.stringify(init.body),
  });

  const isJson = response.headers.get('Content-Type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    if (response.status === 403 && data && (data as any).album) {
      return data as T;
    }
    throw new Error(`Request failed with status ${response.status}`);
  }

  return data as T;
}

export function getApiBaseUrl(): string {
  return API_URL;
}

export function unwrapAlbumDetails(
  raw: PublicAlbumDetails | { album?: PublicAlbumDetails; message?: string },
): PublicAlbumDetails {
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
