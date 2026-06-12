/**
 * audio.ts — Lecteur audio web (HTML5 Audio API + HLS.js)
 */

import Hls from 'hls.js';
import { getApiBaseUrl } from './api';
import { secureAudioPlayer } from './secureAudioPlayer';

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

export function cancelCurrentPrefetch() {
  if (prefetchAbortController) {
    prefetchAbortController.abort();
    prefetchAbortController = null;
  }
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
  if (currentTrackEndHandler) {
    currentTrackEndHandler = null;
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

function resolvePlaybackUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, getApiBaseUrl()).toString();
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
    
    // First, let's try to fetch the URL to check what we're getting
    try {
      console.log('[Audio] Testing URL with fetch:', audioUrl);
      const testResponse = await fetch(audioUrl, { 
        method: 'GET',
        headers: {
          'Range': 'bytes=0-100' // Just fetch the first 100 bytes to test
        }
      });
      console.log('[Audio] Test response:', {
        ok: testResponse.ok,
        status: testResponse.status,
        statusText: testResponse.statusText,
        contentType: testResponse.headers.get('content-type'),
        contentLength: testResponse.headers.get('content-length'),
        acceptRanges: testResponse.headers.get('accept-ranges')
      });
    } catch (fetchErr) {
      console.warn('[Audio] Test fetch failed:', fetchErr);
    }
    
    // Wait for canplay or error with timeout
    await new Promise<void>((resolve, reject) => {
      let timeoutId: number | null = null;
      
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
 * Nouvelle fonction optimisée pour le Web Player.
 * - Ne nécessite aucune modification du backend.
 * - Titres gratuits : lecture directe depuis B2 (HTTP 206 natif, pas de proxy).
 * - Titres premium : téléchargement complet via le proxy, puis création d'un Blob URL pour permettre au lecteur web de faire des "Range Requests" locaux et éviter l'erreur de format.
 */
export async function playWebOptimizedTrack(
  trackId: string,
  previewUrl: string | null | undefined,
  proxyUrl: string,
  isPremium: boolean,
  onStatusUpdate?: StatusCallback
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
    
    return new Promise<HTMLAudioElement>((resolve, reject) => {
      let timeoutId: number | null = null;
      
      const onCanPlay = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(audio);
      };
      
      const onError = (e: Event) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(new Error(audio.error?.message || 'Erreur lors du chargement du fichier audio.'));
      };
      
      timeoutId = setTimeout(() => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        reject(new Error('Audio load timeout'));
      }, 30000);
      
      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.src = audioUrl;
    }).then(async (audio) => {
      await audio.play();
      return audio;
    });
  };

  try {
    // Lecture via le proxy backend uniquement.
    // Note: la lecture directe depuis B2 est désactivée car Backblaze B2
    // n'autorise pas les requêtes CORS depuis le navigateur.
    // Le proxy télécharge le fichier et le convertit en Blob URL,
    // ce qui permet au navigateur de faire des Range Requests locaux.
    console.log('[WebAudio] Utilisation du proxy backend :', proxyUrl);
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      if (response.status === 404 || response.status === 500) {
        throw new Error('Fichier audio introuvable sur le serveur (Erreur 404/500).');
      }
      throw new Error(`Erreur proxy: HTTP ${response.status}`);
    }

    // Vérifier que le Content-Type est bien un type audio
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith('audio/') && !contentType.startsWith('application/octet-stream') && !contentType.includes('binary') && !contentType.includes('mp3')) {
      console.warn('[WebAudio] Content-Type inattendu du proxy:', contentType);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    currentBlobUrl = objectUrl;
    console.log('[WebAudio] Blob URL créé avec succès, lancement de la lecture.');

    const audio = await playWithHtmlAudio(objectUrl);

    // On libère la mémoire quand la piste se termine naturellement
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      if (currentBlobUrl === objectUrl) currentBlobUrl = null;
    };
    audio.addEventListener('ended', cleanup, { once: true });

    return audio;

  } catch (err) {
    // Nettoyer le Blob URL en cas d'erreur (play échoué, fetch échoué, etc.)
    cleanupCurrentBlobUrl();
    console.error('[WebAudio] Echec total de lecture optimisée:', err);
    throw err;
  }
}

export async function prefetchRemoteTrack(
  url: string,
  trackId: string,
  fallbackUrls: string[] = []
): Promise<boolean> {
  // Web: just fetch and cache in memory/browser cache
  try {
    const resolved = resolvePlaybackUrl(url);
    const resp = await fetch(resolved, { method: 'HEAD' });
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
      let timeoutId: number | null = null;
      
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
        let timeoutId: number | null = null;
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
