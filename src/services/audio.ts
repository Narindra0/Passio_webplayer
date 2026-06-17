/**
 * audio.ts — Lecteur audio web (HTML5 Audio API + HLS.js)
 */

import Hls from 'hls.js';
import { getApiBaseUrl } from './api';
import { getOrCreateDeviceId } from './device';
import { secureAudioPlayer } from './secureAudioPlayer';
import { mseSecurePlayer, MSESecurePlayer } from './mseSecurePlayer';

type StatusCallback = (status: {
  currentTime?: number;
  duration?: number;
  playing?: boolean;
  playbackState?: string;
  isLoaded?: boolean;
}) => void;

let currentAudio: HTMLAudioElement | null = null;
let currentHls: Hls | null = null;
let currentStatusCallback: StatusCallback | null = null;
let currentTrackEndHandler: (() => void) | null = null;
let animationFrameId: number | null = null;
let prefetchAbortController: AbortController | null = null;
let isSecureAudio: boolean = false;
let currentBlobUrl: string | null = null;

// Cache de préchargement pour transition fluide entre pistes
interface PrefetchEntry {
  trackId: string;
  objectUrl: string;
}
let prefetchEntry: PrefetchEntry | null = null;
let prefetchingTrackId: string | null = null;
let prefetchTrackPromise: Promise<boolean> | null = null;

// Cache de préchargement sécurisé (Uint8Array en RAM — pas de blob URL exposé)
let securePrefetchBuffer: Uint8Array | null = null;
let securePrefetchTrackId: string | null = null;
let securePrefetchController: AbortController | null = null;
let securePrefetchPromise: Promise<boolean> | null = null;

// ── Authentification appareil pour le streaming ──
let streamDeviceId: string | null = null;
let deviceIdInitPromise: Promise<string | null> | null = null;

/**
 * Initialise l'ID appareil pour les requêtes de streaming.
 * Appelé automatiquement avant la première lecture.
 */
async function ensureStreamDeviceId(): Promise<string | null> {
  if (streamDeviceId) return streamDeviceId;
  if (deviceIdInitPromise) return deviceIdInitPromise;
  deviceIdInitPromise = getOrCreateDeviceId().then(id => {
    streamDeviceId = id;
    // Propager aux deux lecteurs audio
    mseSecurePlayer.setDeviceId(id);
    secureAudioPlayer.setDeviceId(id);
    console.log('[Audio] 🆔 Device ID initialisé pour le streaming:', id.slice(0, 8) + '…');
    return id;
  }).catch(err => {
    console.warn('[Audio] Impossible de récupérer deviceId:', err);
    return null;
  });
  return deviceIdInitPromise;
}

/**
 * Reset l'ID appareil (utile si l'ID change).
 */
export function resetStreamDeviceId() {
  streamDeviceId = null;
  deviceIdInitPromise = null;
}

export function cancelCurrentPrefetch(skipTrackId?: string) {
  if (prefetchAbortController) {
    if (skipTrackId && prefetchingTrackId === skipTrackId) return;
    prefetchAbortController.abort();
    prefetchAbortController = null;
  }
}

/**
 * Consomme le blob préchargé pour une piste donnée.
 * Retourne l'objectUrl ou null si pas de cache correspondant.
 */
export function consumePrefetchedTrack(trackId: string): string | null {
  if (prefetchEntry?.trackId === trackId) {
    const url = prefetchEntry.objectUrl;
    prefetchEntry = null;
    return url;
  }
  return null;
}

export function clearPrefetchCache() {
  if (prefetchEntry) {
    URL.revokeObjectURL(prefetchEntry.objectUrl);
    prefetchEntry = null;
  }
}

// ── Secure prefetch (Uint8Array en RAM, pas de blob URL) ──

/** Nettoyer le buffer de préchargement sécurisé en RAM. */
export function clearSecurePrefetch() {
  if (securePrefetchBuffer) {
    securePrefetchBuffer.fill(0);
    securePrefetchBuffer = null;
  }
  securePrefetchTrackId = null;
}

/** Limite du prefetch en octets (2 chunks × 512 Ko). */
const PREFETCH_MAX_BYTES = 2 * 512 * 1024;

/**
 * Précharge seulement les 2 premiers chunks du fichier audio.
 * Suffisant pour un démarrage instantané, sans gaspiller la bande passante.
 * Économie : -80% vs téléchargement complet (1 Mo au lieu de 5 Mo).
 */
export async function prefetchSecureTrack(url: string, trackId: string): Promise<boolean> {
  // Annuler un éventuel préchargement sécurisé en cours
  if (securePrefetchController) {
    securePrefetchController.abort();
    securePrefetchController = null;
  }

  if (securePrefetchTrackId === trackId && securePrefetchBuffer) return true;

  clearSecurePrefetch();

  // S'assurer que le device ID est initialisé avant le préchargement
  await ensureStreamDeviceId();

  await secureAudioPlayer.fetchToken(trackId);

  // Probe préalable : vérifier que le endpoint répond avant de lancer le téléchargement
  // (identique au probe que fait mseSecurePlayer.loadAndPlay pour la lecture normale)
  try {
    const probeResp = await fetch(url, {
      method: 'HEAD',
      headers: secureAudioPlayer.getAuthHeaders(),
      credentials: 'include',
    });
    if (!probeResp.ok) {
      console.warn('[Audio] ⚠️ Prefetch probe failed for', trackId, ':', probeResp.status, probeResp.statusText);
      return false;
    }
  } catch (probeErr) {
    console.warn('[Audio] ⚠️ Prefetch probe error for', trackId, ':', probeErr);
    return false;
  }

  const controller = new AbortController();
  securePrefetchController = controller;

  const promise = (async () => {
    try {
      // ⚡ Limité à PREFETCH_MAX_BYTES (2 chunks) pour économiser la bande passante
      const buffer = await secureAudioPlayer.downloadInChunks(url, undefined, PREFETCH_MAX_BYTES);
      if (controller.signal.aborted) return false;
      securePrefetchBuffer = buffer;
      securePrefetchTrackId = trackId;
      console.log('[Audio] ⚡ Secure prefetch (2 chunks) for track:', trackId, 'size:', buffer.length);
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      // Log détaillé pour diagnostiquer les erreurs 404/403
      console.warn('[Audio] ❌ Secure prefetch failed:', trackId, err);
      return false;
    } finally {
      if (securePrefetchController === controller) {
        securePrefetchController = null;
      }
      securePrefetchPromise = null;
    }
  })();

  securePrefetchPromise = promise;
  return promise;
}

/**
 * Consomme le buffer préchargé pour une piste donnée.
 * Nettoie la RAM après consommation.
 */
export function consumeSecurePrefetch(trackId: string): Uint8Array | null {
  if (securePrefetchTrackId === trackId && securePrefetchBuffer) {
    const buffer = securePrefetchBuffer;
    securePrefetchBuffer = null;
    securePrefetchTrackId = null;
    return buffer;
  }
  return null;
}

function startProgressInterval(callback: StatusCallback) {
  stopProgressInterval();
  const tick = () => {
    if (isSecureAudio) {
      if (secureAudioPlayer.isCurrentlyPlaying()) {
        callback({
          currentTime: secureAudioPlayer.getCurrentTime(),
          duration: secureAudioPlayer.getDuration(),
          playing: true,
        });
      }
    } else if (currentAudio && !currentAudio.paused) {
      callback({
        currentTime: currentAudio.currentTime,
        duration: currentAudio.duration || 0,
        playing: !currentAudio.paused,
      });
    }
    animationFrameId = requestAnimationFrame(tick);
  };
  animationFrameId = requestAnimationFrame(tick);
}

function stopProgressInterval() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function cleanupCurrentBlobUrl() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}

export async function stopCurrentTrack(): Promise<void> {
  cleanupCurrentBlobUrl();
  clearSecurePrefetch(); // Nettoyer le buffer RAM sécurisé

  // Arrêter le MSE player si actif
  mseSecurePlayer.stop();

  if (isSecureAudio) {
    secureAudioPlayer.stop();
    isSecureAudio = false;
  }
  if (currentHls) {
    currentHls.destroy();
    currentHls = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio.load();
    currentAudio = null;
  }
  currentStatusCallback = null;
  stopProgressInterval();
}

export async function togglePlayPause(): Promise<boolean> {
  if (isSecureAudio) {
    if (secureAudioPlayer.isCurrentlyPlaying()) {
      secureAudioPlayer.pause();
      return false;
    } else {
      const started = await secureAudioPlayer.play();
      return started;
    }
  }

  if (!currentAudio) return false;
  try {
    if (currentAudio.paused) {
      await currentAudio.play();
      return true;
    } else {
      currentAudio.pause();
      return false;
    }
  } catch {
    return false;
  }
}

export function seekToSeconds(seconds: number): boolean {
  if (isSecureAudio) {
    secureAudioPlayer.seekTo(seconds);
    return true;
  }
  if (!currentAudio) return false;
  try {
    const duration = currentAudio.duration || 0;
    if (duration <= 0 || seconds < 0) return false;
    currentAudio.currentTime = Math.min(seconds, duration);
    return true;
  } catch {
    return false;
  }
}

export function seekTo(position: number): boolean {
  if (isSecureAudio) {
    const duration = secureAudioPlayer.getDuration();
    if (duration > 0 && position >= 0 && position <= 1) {
      secureAudioPlayer.seekTo(position * duration);
      return true;
    }
    return false;
  }
  if (!currentAudio) return false;
  try {
    const duration = currentAudio.duration || 0;
    if (duration <= 0) return false;
    if (typeof position !== 'number' || isNaN(position) || position < 0 || position > 1) {
      return false;
    }
    currentAudio.currentTime = position * duration;
    return true;
  } catch {
    return false;
  }
}

function setupAudioEvents(audio: HTMLAudioElement, onStatus: StatusCallback) {
  audio.addEventListener('loadedmetadata', () => {
    onStatus({
      currentTime: audio.currentTime,
      duration: audio.duration,
      isLoaded: true,
    });
  });

  audio.addEventListener('timeupdate', () => {
    onStatus({
      currentTime: audio.currentTime,
      duration: audio.duration || 0,
      playing: !audio.paused,
    });
  });

  audio.addEventListener('play', () => {
    onStatus({ playing: true });
    startProgressInterval(onStatus);
  });

  audio.addEventListener('pause', () => {
    onStatus({ playing: false });
    stopProgressInterval();
  });

  audio.addEventListener('ended', () => {
    onStatus({ playing: false, playbackState: 'ended' });
    if (currentTrackEndHandler) {
      currentTrackEndHandler();
    }
  });

  audio.addEventListener('error', () => {
    onStatus({ playbackState: 'idle', isLoaded: false, currentTime: 0, duration: 0 });
  });
}

/**
 * Tente de résoudre une URL de streaming avec keepalive: true.
 * Vérifie la connectivité avant de lancer le streaming complet.
 */
function resolvePlaybackUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, getApiBaseUrl()).toString();
}

/**
 * Vérifie qu'une URL de streaming est accessible avant de lancer la lecture.
 * Lance une erreur descriptive si le endpoint retourne 403 (clé invalide).
 * Utilise keepalive: true pour éviter la renégociation HTTP/3 ↔ HTTP/2.
 */
export async function probeStreamUrl(url: string): Promise<void> {
  const deviceId = await ensureStreamDeviceId();
  const headers: Record<string, string> = { 'X-Passio-Stream': 'secure' };
  if (deviceId) headers['x-passio-device-id'] = deviceId;
  const resp = await fetch(url, {
    method: 'HEAD',
    headers,
    keepalive: true,
  });
  if (resp.status === 403) {
    throw new Error(
      'Accès refusé (403) — la clé de streaming a expiré ou est invalide. ' +
      "Rechargez l'album pour obtenir une nouvelle clé."
    );
  }
  if (!resp.ok) {
    throw new Error(`Stream inaccessible: HTTP ${resp.status}`);
  }
}



export async function playTrack(
  trackId: string,
  decryptionKey: string | null,
  onStatusUpdate?: StatusCallback
): Promise<HTMLAudioElement | null> {
  cancelCurrentPrefetch();
  await stopCurrentTrack();

  // Web: we need to fetch the encrypted file, decrypt it, and create a blob URL
  // For now, fall back to remote streaming
  try {
    const proxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(trackId)}/audio`;
    return playStream(proxyUrl, onStatusUpdate);
  } catch (err) {
    console.error('[Audio] Failed to play track:', err);
    return null;
  }
}

/**
 * Télécharge un blob avec keepalive et retry pour le préchargement.
 */
export async function prefetchTrackBlob(url: string, trackId: string): Promise<boolean> {
  cancelCurrentPrefetch();

  if (prefetchEntry?.trackId === trackId) return true;

  clearPrefetchCache();

  const controller = new AbortController();
  prefetchAbortController = controller;
  prefetchingTrackId = trackId;

  const promise = (async () => {
    try {
      const response = await fetch(url, { signal: controller.signal, keepalive: true });
      if (!response.ok) return false;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      prefetchEntry = { trackId, objectUrl };
      console.log('[Audio] Prefetched blob for track:', trackId);
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      console.warn('[Audio] Prefetch failed for track:', trackId, err);
      return false;
    } finally {
      if (prefetchAbortController === controller) {
        prefetchAbortController = null;
      }
      prefetchingTrackId = null;
      prefetchTrackPromise = null;
    }
  })();

  prefetchTrackPromise = promise;
  return promise;
}

export async function playRemoteTrack(
  url: string,
  trackId: string,
  decryptionKey: string,
  isEncrypted: boolean = true,
  onStatusUpdate?: StatusCallback,
  fallbackUrls: string[] = []
): Promise<HTMLAudioElement | any> {
  cancelCurrentPrefetch();
  await stopCurrentTrack();

  const playWithHtmlAudio = async (audioUrl: string) => {
    const audio = new Audio();
    currentAudio = audio;
    isSecureAudio = false;
    currentStatusCallback = onStatusUpdate || null;
    if (onStatusUpdate) setupAudioEvents(audio, onStatusUpdate);
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    
    console.log('[Audio] Loading audio from:', audioUrl);
    
    // Wait for canplay or error with timeout
    await new Promise<void>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      
      const onCanPlay = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };
      
      const onError = (e: Event) => {
        if (timeoutId) clearTimeout(timeoutId);
        const error = audio.error;
        let errorMessage = 'Failed to load audio';
        if (error) {
          switch (error.code) {
            case error.MEDIA_ERR_ABORTED:
              errorMessage = 'Audio loading aborted';
              break;
            case error.MEDIA_ERR_NETWORK:
              errorMessage = 'Network error while loading audio';
              break;
            case error.MEDIA_ERR_DECODE:
              errorMessage = 'Audio decoding failed';
              break;
            case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
              errorMessage = 'Audio format not supported';
              break;
          }
          console.error('[Audio] Audio error details:', { code: error.code, message: error.message, event: e });
        }
        reject(new Error(errorMessage));
      };
      
      timeoutId = setTimeout(() => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        reject(new Error('Audio load timeout'));
      }, 30000); // 30 second timeout
      
      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('error', onError, { once: true });
      
      // Set src after adding event listeners
      audio.src = audioUrl;
    });
    
    await audio.play();
    console.log('[Audio] Started playing');
    return audio;
  };

  try {
    const resolvedUrl = resolvePlaybackUrl(url);
    
    // Skip secure player entirely, use HTML5 audio directly
    // Try main URL
    try {
      console.log('[Audio] Trying main URL:', resolvedUrl);
      return await playWithHtmlAudio(resolvedUrl);
    } catch (err) {
      console.warn('[Audio] Main URL failed, trying fallbacks:', err);
    }
    
    // Try fallback URLs
    for (const fallback of fallbackUrls) {
      try {
        const resolved = resolvePlaybackUrl(fallback);
        console.log('[Audio] Trying fallback URL:', resolved);
        return await playWithHtmlAudio(resolved);
      } catch {
        continue;
      }
    }
    
    // All attempts failed, throw error
    throw new Error('All playback attempts failed');
  } catch (err) {
    console.error('[Audio] Failed to play remote track:', err);
    throw err; // Re-throw so caller can handle it
  }
}

/**
 * Lecture via MSE (Media Source Extensions) — streaming progressif sécurisé.
 *
 * 1. Crée un MediaSource + <audio> avec blob URL (pas d'URL réseau exposée)
 * 2. Télécharge les chunks en séquence via Range requests + header X-Passio-Stream
 * 3. Les append au SourceBuffer au fur et à mesure
 * 4. Le navigateur joue dès les premières secondes bufferisées (~1-2s)
 *
 * IDM ne peut pas intercepter : le src <audio> est un blob: URL (MediaSource),
 * les données transitent en JS via appendBuffer().
 */
export async function playSecureTrackMSE(
  proxyUrl: string,
  onStatusUpdate?: StatusCallback
): Promise<boolean> {
  await ensureStreamDeviceId();
  await stopCurrentTrack();
  currentStatusCallback = onStatusUpdate || null;

  try {
    const match = proxyUrl.match(/\/api\/stream\/tracks\/([^/]+)\/audio/);
    if (match) {
      const trackId = decodeURIComponent(match[1]);
      await secureAudioPlayer.fetchToken(trackId);
      mseSecurePlayer.currentToken = secureAudioPlayer.currentToken;
    }

    // 1. Lancer le streaming MSE (télécharge + append progressif)
    console.log('[MSE] 🎯 Streaming MSE sécurisé:', proxyUrl);
    const audio = await mseSecurePlayer.loadAndPlay(proxyUrl);

    // 2. Définir currentAudio pour que togglePlayPause / seekTo / progress marchent
    currentAudio = audio;
    isSecureAudio = false;

    // 3. Brancher les événements de progression / état
    if (onStatusUpdate) {
      setupAudioEvents(audio, onStatusUpdate);
    }

    // 4. Brancher la fin de piste (via ended sur <audio>)
    // setupAudioEvents gère déjà 'ended' → currentTrackEndHandler

    // 5. Brancher onEnded sur le player MSE pour les cas où l'ended du <audio> ne suffit pas
    mseSecurePlayer.onEnded = () => {
      if (currentTrackEndHandler) {
        currentTrackEndHandler();
      }
    };

    // 6. Démarrer la lecture dès que le premier chunk est bufferisé
    // Le MediaSource commence à bufferiser, le navigateur joue dès que possible
    try {
      await audio.play();
    } catch (playErr) {
      // Si autoplay bloqué, on attend une interaction utilisateur
      console.warn('[MSE] ⚠️ autoplay may be blocked, retrying...');
      await audio.play();
    }

    // 7. Signaler que la lecture est lancée
    if (onStatusUpdate) {
      onStatusUpdate({ playing: true });
    }
    startProgressInterval(onStatusUpdate || (() => {}));

    console.log('[MSE] ✅ Streaming MSE démarré !');
    return true;

  } catch (err) {
    // Nettoyer le player MSE en cas d'échec
    mseSecurePlayer.stop();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    console.warn('[MSE] ❌ Échec, fallback nécessaire:', err);
    throw err;
  }
}

/**
 * Lecture sécurisée via SecureAudioPlayer (Web Audio API).
 * 
 * 1. Télécharge le fichier en chunks (Range requests, header X-Passio-Stream)
 * 2. Décode en mémoire via AudioContext.decodeAudioData()
 * 3. Joue via AudioBufferSourceNode (aucun élément <audio> dans le DOM)
 * 
 * Protège contre : IDM, téléchargement direct, dump mémoire.
 */
export async function playSecureTrack(
  trackId: string,
  proxyUrl: string,
  onStatusUpdate?: StatusCallback
): Promise<boolean> {
  await ensureStreamDeviceId();
  await stopCurrentTrack();
  currentStatusCallback = onStatusUpdate || null;

  try {
    // 1. Vérifier le secure prefetch
    const prefetched = consumeSecurePrefetch(trackId);

    if (prefetched) {
      console.log('[SecureAudio] ⚡ Utilisation du buffer préchargé pour:', trackId);
      try {
        await secureAudioPlayer.loadFromBuffer(prefetched);
      } catch {
        // Buffer partiel (prefetch 2 chunks seulement) → full download
        console.warn('[SecureAudio] ⚠️ Buffer partiel, fallback download complet');
        await secureAudioPlayer.loadTrack(proxyUrl, (progress) => {
          if (onStatusUpdate) {
            onStatusUpdate({ playbackState: progress < 100 ? 'loading' : 'loaded' });
          }
        }, trackId);
      }
    } else {
      // 2. Téléchargement chunké + décodage
      console.log('[SecureAudio] 🔒 Téléchargement sécurisé (chunks + Range):', proxyUrl);
      await secureAudioPlayer.loadTrack(proxyUrl, (progress) => {
        if (onStatusUpdate) {
          onStatusUpdate({ playbackState: progress < 100 ? 'loading' : 'loaded' });
        }
      }, trackId);
    }

    // 3. Signaler que le fichier est chargé
    if (onStatusUpdate) {
      onStatusUpdate({
        isLoaded: true,
        currentTime: 0,
        duration: secureAudioPlayer.getDuration(),
      });
    }

    // 4. Brancher l'événement de fin de piste
    secureAudioPlayer.onEnded = () => {
      if (currentTrackEndHandler) {
        currentTrackEndHandler();
      }
    };

    // 5. Démarrer la lecture
    isSecureAudio = true;
    const started = await secureAudioPlayer.play();

    if (started) {
      console.log('[SecureAudio] ✅ Lecture démarrée via Web Audio API');
      if (onStatusUpdate) onStatusUpdate({ playing: true });
      startProgressInterval(onStatusUpdate || (() => {}));
      return true;
    }

    throw new Error('Échec du démarrage de la lecture AudioContext');
  } catch (err) {
    isSecureAudio = false;
    console.error('[SecureAudio] ❌ Échec:', err);
    throw err;
  }
}

/**
 * Point d'entrée principal pour la lecture des pistes premium.
 * 
 * Stratégie (par ordre de préférence) :
 * 1. ⚡ Secure prefetch disponible → AudioContext direct (instantané)
 * 2. 🎯 MSE supporté → streaming progressif (1-2s) sans exposer d'URL
 * 3. 🔒 Web Audio API → téléchargement complet puis lecture (3-6s)
 */
export async function playWebOptimizedTrack(
  trackId: string,
  previewUrl: string | null | undefined,
  proxyUrl: string,
  isPremium: boolean,
  onStatusUpdate?: StatusCallback
): Promise<boolean> {
  // ⏳ Si un secure prefetch est en cours pour cette même piste, on attend
  if (securePrefetchTrackId === trackId && securePrefetchPromise) {
    console.log('[WebAudio] ⏳ Attente du secure prefetch pour:', trackId);
    await securePrefetchPromise;
  }

  // 🎯 Essayer MSE (streaming progressif sécurisé) si supporté
  // (playSecureTrack gère déjà le secure prefetch en interne, pas besoin de le vérifier ici)
  if (MSESecurePlayer.isSupported()) {
    try {
      console.log('[WebAudio] 🎯 Tentative MSE streaming...');
      return await playSecureTrackMSE(proxyUrl, onStatusUpdate);
    } catch (mseErr) {
      console.warn('[WebAudio] ❌ MSE échoué, fallback AudioContext:', mseErr);
      // Nettoyer l'état après l'échec MSE
      await stopCurrentTrack();
    }
  }

  // 🔒 Fallback : Web Audio API (téléchargement complet puis lecture)
  console.log('[WebAudio] 🔒 Fallback: téléchargement complet via AudioContext');
  return playSecureTrack(trackId, proxyUrl, onStatusUpdate);
}

export async function prefetchRemoteTrack(
  url: string,
  trackId: string,
  fallbackUrls: string[] = []
): Promise<boolean> {
  // Web: just fetch and cache in memory/browser cache
  try {
    const resolved = resolvePlaybackUrl(url);
    const resp = await fetch(resolved, { method: 'HEAD', keepalive: true });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function playDeviceFile(
  fileUri: string,
  onStatusUpdate?: StatusCallback
): Promise<HTMLAudioElement | null> {
  await stopCurrentTrack();
  try {
    const audio = new Audio(fileUri);
    currentAudio = audio;
    currentStatusCallback = onStatusUpdate || null;
    if (onStatusUpdate) setupAudioEvents(audio, onStatusUpdate);
    await audio.play();
    return audio;
  } catch (err) {
    console.error('[Audio] Failed to play device file:', err);
    return null;
  }
}

export async function playStream(
  streamUrl: string,
  onStatusUpdate?: StatusCallback
): Promise<HTMLAudioElement | any> {
  await stopCurrentTrack();
  const resolvedUrl = resolvePlaybackUrl(streamUrl);

  currentStatusCallback = onStatusUpdate || null;

  const playWithHtmlAudio = async (audioUrl: string) => {
    const audio = new Audio();
    currentAudio = audio;
    isSecureAudio = false;
    if (onStatusUpdate) setupAudioEvents(audio, onStatusUpdate);
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    
    console.log('[Audio] Loading stream from:', audioUrl);
    
    // Wait for canplay or error with timeout
    await new Promise<void>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      
      const onCanPlay = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };
      
      const onError = (e: Event) => {
        if (timeoutId) clearTimeout(timeoutId);
        const error = audio.error;
        let errorMessage = 'Failed to load stream';
        if (error) {
          switch (error.code) {
            case error.MEDIA_ERR_ABORTED:
              errorMessage = 'Stream loading aborted';
              break;
            case error.MEDIA_ERR_NETWORK:
              errorMessage = 'Network error while loading stream';
              break;
            case error.MEDIA_ERR_DECODE:
              errorMessage = 'Stream decoding failed';
              break;
            case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
              errorMessage = 'Stream format not supported';
              break;
          }
          console.error('[Audio] Stream error details:', { code: error.code, message: error.message, event: e });
        }
        reject(new Error(errorMessage));
      };
      
      timeoutId = setTimeout(() => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        reject(new Error('Stream load timeout'));
      }, 30000); // 30 second timeout
      
      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('error', onError, { once: true });
      
      // Set src after adding event listeners
      audio.src = audioUrl;
    });
    
    await audio.play();
    console.log('[Audio] Started playing stream');
    return audio;
  };

  // Try HLS.js first if the URL is an HLS stream
  if (Hls.isSupported() && (resolvedUrl.includes('.m3u8') || resolvedUrl.includes('hls'))) {
    try {
      console.log('[Audio] Trying HLS.js for stream:', resolvedUrl);
      const audio = new Audio();
      currentAudio = audio;
      isSecureAudio = false;
      if (onStatusUpdate) setupAudioEvents(audio, onStatusUpdate);
      
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true
      });
      currentHls = hls;
      
      // Wait for HLS to load or error with timeout
      await new Promise<void>((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let manifestParsed = false;
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          manifestParsed = true;
          if (timeoutId) clearTimeout(timeoutId);
          console.log('[Audio] HLS manifest parsed');
          resolve();
        });
        
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.error('[Audio] HLS fatal error:', data);
            if (timeoutId) clearTimeout(timeoutId);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.warn('[Audio] HLS network error, trying to recover...');
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.warn('[Audio] HLS media error, trying to recover...');
                hls.recoverMediaError();
                break;
              default:
                reject(new Error(`HLS fatal error: ${data.details}`));
                break;
            }
          } else {
            console.warn('[Audio] HLS non-fatal error (will try to recover):', data.details);
          }
        });
        
        timeoutId = setTimeout(() => {
          if (!manifestParsed) {
            reject(new Error('HLS load timeout'));
          }
        }, 30000); // 30 second timeout
        
        hls.loadSource(resolvedUrl);
        hls.attachMedia(audio);
      });
      
      await audio.play();
      console.log('[Audio] Started playing HLS stream');
      return audio;
    } catch (hlsErr) {
      console.warn('[Audio] HLS failed, falling back to HTML5 audio:', hlsErr);
      // Clean up HLS
      if (currentHls) {
        currentHls.destroy();
        currentHls = null;
      }
    }
  }

  // Fallback to HTML5 audio
  return await playWithHtmlAudio(resolvedUrl);
}

export function setTrackEndHandler(handler: () => void) {
  currentTrackEndHandler = handler;
}

export function setVolume(volume: number) {
  const clamped = Math.max(0, Math.min(1, volume));
  if (currentAudio) {
    currentAudio.volume = clamped;
  }
}

export function getVolume(): number {
  if (currentAudio) return currentAudio.volume;
  return 1;
}

export function isMuted(): boolean {
  if (currentAudio) return currentAudio.muted;
  return false;
}

export function setMuted(muted: boolean) {
  if (currentAudio) {
    currentAudio.muted = muted;
  }
}
