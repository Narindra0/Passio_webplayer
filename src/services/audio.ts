/**
 * audio.ts — Lecteur audio web (HTML5 Audio API + HLS.js)
 */

import Hls from 'hls.js';
import { decryptTrackBuffer } from './crypto';
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

export function togglePlayPause(): boolean {
  if (isSecureAudio) {
    if (secureAudioPlayer.isCurrentlyPlaying()) {
      secureAudioPlayer.pause();
      return false;
    } else {
      secureAudioPlayer.play();
      return true;
    }
  }

  if (!currentAudio) return false;
  try {
    if (currentAudio.paused) {
      currentAudio.play();
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
): Promise<HTMLAudioElement | null> {
  cancelCurrentPrefetch();
  await stopCurrentTrack();

  try {
    const resolvedUrl = resolvePlaybackUrl(url);
    
    // Always use secure audio player for remote non-m3u8 tracks to bypass IDM
    if (!resolvedUrl.includes('.m3u8')) {
      isSecureAudio = true;
      currentStatusCallback = onStatusUpdate || null;
      
      (secureAudioPlayer as any).onEnded = () => {
        if (currentStatusCallback) currentStatusCallback({ playing: false, playbackState: 'ended' });
        if (currentTrackEndHandler) currentTrackEndHandler();
      };

      await secureAudioPlayer.loadTrack(resolvedUrl, (progress) => {
         // optional progress update
      });
      secureAudioPlayer.play();

      if (onStatusUpdate) {
        onStatusUpdate({
          isLoaded: true,
          currentTime: 0,
          duration: secureAudioPlayer.getDuration(),
          playing: true
        });
        startProgressInterval(onStatusUpdate);
      }
      return secureAudioPlayer as any;
    }

    // fallback to normal HTML audio for others
    const audio = new Audio();
    currentAudio = audio;
    currentStatusCallback = onStatusUpdate || null;

    if (onStatusUpdate) setupAudioEvents(audio, onStatusUpdate);

    audio.src = resolvedUrl;
    audio.crossOrigin = 'anonymous';
    await audio.play();
    return audio;
  } catch (err) {
    console.error('[Audio] Failed to play remote track:', err);
    for (const fallback of fallbackUrls) {
      try {
        const resolved = resolvePlaybackUrl(fallback);
        
        if (!resolved.includes('.m3u8')) {
          isSecureAudio = true;
          await secureAudioPlayer.loadTrack(resolved);
          secureAudioPlayer.play();
          if (onStatusUpdate) {
            onStatusUpdate({
              isLoaded: true,
              currentTime: 0,
              duration: secureAudioPlayer.getDuration(),
              playing: true
            });
            startProgressInterval(onStatusUpdate);
          }
          return secureAudioPlayer as any;
        }

        const audio = new Audio();
        currentAudio = audio;
        if (onStatusUpdate) setupAudioEvents(audio, onStatusUpdate);
        audio.src = resolved;
        audio.crossOrigin = 'anonymous';
        await audio.play();
        return audio;
      } catch {
        continue;
      }
    }
    return null;
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
): Promise<HTMLAudioElement | null> {
  await stopCurrentTrack();
  const resolvedUrl = resolvePlaybackUrl(streamUrl);

  currentStatusCallback = onStatusUpdate || null;

  // Try HLS.js for m3u8 streams
  if (resolvedUrl.includes('.m3u8')) {
    const audio = new Audio();
    currentAudio = audio;
    if (onStatusUpdate) setupAudioEvents(audio, onStatusUpdate);

    if (Hls.isSupported()) {
      const hls = new Hls();
      currentHls = hls;
      hls.loadSource(resolvedUrl);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        audio.play().catch(console.error);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.error('[Audio] HLS fatal error:', data);
        }
      });
    } else {
      audio.src = resolvedUrl;
      audio.crossOrigin = 'anonymous';
      try {
        await audio.play();
      } catch (err) {
        console.error('[Audio] Error calling play():', err);
      }
    }
    return audio;
  } else {
    // SECURE AUDIO PLAYER FOR MP3/AAC streams
    isSecureAudio = true;
    (secureAudioPlayer as any).onEnded = () => {
      if (currentStatusCallback) currentStatusCallback({ playing: false, playbackState: 'ended' });
      if (currentTrackEndHandler) currentTrackEndHandler();
    };

    try {
      await secureAudioPlayer.loadTrack(resolvedUrl);
      secureAudioPlayer.play();
      
      if (onStatusUpdate) {
        onStatusUpdate({
          isLoaded: true,
          currentTime: 0,
          duration: secureAudioPlayer.getDuration(),
          playing: true
        });
        startProgressInterval(onStatusUpdate);
      }
      return secureAudioPlayer as any;
    } catch (err) {
      console.error('[Audio] Error with secure stream:', err);
      return null;
    }
  }
}

export function setTrackEndHandler(handler: () => void) {
  currentTrackEndHandler = handler;
}
