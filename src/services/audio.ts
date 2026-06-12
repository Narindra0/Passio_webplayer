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

export async function stopCurrentTrack(): Promise<void> {
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
    audio.src = audioUrl;
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    
    console.log('[Audio] Loading audio from:', audioUrl);
    
    // Wait for canplay or error with timeout
    await new Promise<void>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null;
      
      const onCanPlay = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };
      
      const onError = (e: Event) => {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[Audio] Audio error event:', e);
        reject(new Error('Failed to load audio'));
      };
      
      timeoutId = setTimeout(() => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        reject(new Error('Audio load timeout'));
      }, 30000); // 30 second timeout
      
      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('error', onError, { once: true });
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
    audio.src = audioUrl;
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    
    console.log('[Audio] Loading stream from:', audioUrl);
    
    // Wait for canplay or error with timeout
    await new Promise<void>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null;
      
      const onCanPlay = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };
      
      const onError = (e: Event) => {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[Audio] Stream error event:', e);
        reject(new Error('Failed to load stream'));
      };
      
      timeoutId = setTimeout(() => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        reject(new Error('Stream load timeout'));
      }, 30000); // 30 second timeout
      
      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('error', onError, { once: true });
    });
    
    await audio.play();
    console.log('[Audio] Started playing stream');
    return audio;
  };

  // Use HTML5 audio directly for all streams
  return await playWithHtmlAudio(resolvedUrl);
}

export function setTrackEndHandler(handler: () => void) {
  currentTrackEndHandler = handler;
}
