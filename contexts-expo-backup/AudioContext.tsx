/**
 * AudioContext.tsx — État audio global de l'application Pass'io.
 * Progression throttlée via AudioProgressContext pour limiter les re-renders.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  playDeviceFile,
  playRemoteTrack,
  playStream,
  playTrack,
  stopCurrentTrack,
  togglePlayPause as toggleAudioPlayPause,
  seekTo as audioSeekTo,
  seekToSeconds,
  prefetchRemoteTrack,
} from '@/services/audio';
import {
  getAlbum,
  listOwnedAlbums,
  getApiBaseUrl,
  unwrapAlbumDetails,
} from '@/services/api';
import { isAlbumReadyOffline } from '@/services/downloadManager';
import { isAlbumOwnedByDevice, resolveAlbumDecryptionKey } from '@/services/albumOwnership';
import { readLocalDecryptionKey, resolveOfflinePlayback } from '@/services/offlineAccess';
import {
  getTrackIndexInQueue,
  getTrackStartOffsetSeconds,
  sortTracksByPosition,
} from '@/utils/tracks';
import type { PublicAlbumDetails, PublicAlbumSummary, PublicTrack } from '@/types/backend';
import type { DeviceTrack } from '@/types/localLibrary';
import { logger } from '@/utils/logger';

export type PlayMode = 'hls' | 'stream' | 'local' | 'remote' | 'device';
export type QueueMode = 'sequential' | 'shuffle';
export type RepeatMode = 'off' | 'one' | 'all';
export type QueueScope = 'album' | 'trackList';

export interface TrackListPlayItem {
  id: string;
  album_id: string;
}

export interface AudioPlaybackState {
  queueScope: QueueScope;
  album: PublicAlbumDetails | null;
  queue: PublicTrack[];
  currentIndex: number;
  currentTrack: PublicTrack | null;
  isPlaying: boolean;
  isLoading: boolean;
  playMode: PlayMode | null;
  decryptionKey: string | null;
  isFullPlayerVisible: boolean;
  queueMode: QueueMode;
  repeatMode: RepeatMode;
  library: PublicAlbumSummary[];
  libraryIndex: number;
  isLibraryLoaded: boolean;
  deviceQueue: DeviceTrack[];
  deviceCurrentIndex: number;
  deviceCurrentTrack: DeviceTrack | null;
  /** Album associé à chaque entrée de la file (file d'attente multi-albums / shuffle). */
  queueAlbums: PublicAlbumDetails[];
  /** Dernière erreur de lecture (null si aucune). */
  playbackError: string | null;
}

export interface AudioProgressState {
  progress: number;
  duration: number;
}

export interface AudioActions {
  loadAlbum: (album: PublicAlbumDetails, decryptionKey?: string | null) => void;
  /** File d'attente = liste des titres affichée (ex. onglet Titres). */
  playFromTrackList: (
    items: TrackListPlayItem[],
    albumById: Map<string, PublicAlbumDetails>,
    startTrackId: string,
  ) => Promise<void>;
  playTrackAtIndex: (index: number) => Promise<void>;
  togglePlayPause: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  stop: () => Promise<void>;
  setFullPlayerVisible: (visible: boolean) => void;
  toggleQueueMode: () => void;
  toggleRepeat: () => void;
  loadLibrary: () => Promise<void>;
  seekTo: (position: number) => void;
  playDeviceTrackAtIndex: (tracks: DeviceTrack[], index: number) => Promise<void>;
  clearPlaybackError: () => void;
}

interface AudioPlaybackContextValue extends AudioPlaybackState, AudioActions {}

const AudioPlaybackContext = createContext<AudioPlaybackContextValue | null>(null);
const AudioProgressContext = createContext<AudioProgressState | null>(null);

const PROGRESS_THROTTLE_MS = 250;

export { getTrackIndexInQueue, sortTracksByPosition };

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AudioProvider({ children }: { children: ReactNode }) {
  const [album, setAlbum] = useState<PublicAlbumDetails | null>(null);
  const [queue, setQueue] = useState<PublicTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playMode, setPlayMode] = useState<PlayMode | null>(null);
  const [decryptionKey, setDecryptionKey] = useState<string | null>(null);
  const [isFullPlayerVisible, setFullPlayerVisible] = useState(false);
  const [queueMode, setQueueMode] = useState<QueueMode>('sequential');
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [library, setLibrary] = useState<PublicAlbumSummary[]>([]);
  const [libraryIndex, setLibraryIndex] = useState(-1);
  const [isLibraryLoaded, setIsLibraryLoaded] = useState(false);
  const [queueScope, setQueueScope] = useState<QueueScope>('album');
  const [deviceQueue, setDeviceQueue] = useState<DeviceTrack[]>([]);
  const [deviceCurrentIndex, setDeviceCurrentIndex] = useState(-1);
  const [queueAlbums, setQueueAlbums] = useState<PublicAlbumDetails[]>([]);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const currentIndexRef = useRef(-1);
  const deviceQueueRef = useRef<DeviceTrack[]>([]);
  const deviceCurrentIndexRef = useRef(-1);
  const isDevicePlaybackRef = useRef(false);
  const queueScopeRef = useRef<QueueScope>('album');
  const queueParallelRef = useRef<{
    albums: PublicAlbumDetails[];
    keys: (string | null)[];
  } | null>(null);
  const trackAdvanceLockRef = useRef(false);
  const playAtIndexRef = useRef<(index: number) => Promise<void>>(async () => {});
  const queueRef = useRef<PublicTrack[]>([]);
  const albumRef = useRef<PublicAlbumDetails | null>(null);
  const decryptionKeyRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const libraryRef = useRef<PublicAlbumSummary[]>([]);
  const libraryIndexRef = useRef(-1);
  const queueModeRef = useRef<QueueMode>('sequential');
  const repeatModeRef = useRef<RepeatMode>('off');
  const keyCacheRef = useRef<Map<string, string>>(new Map());
  const pendingHlsSeekSecondsRef = useRef<number | null>(null);
  const progressThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgressRef = useRef(0);
  const lastDurationRef = useRef(0);

  const currentTrack =
    currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const deviceCurrentTrack =
    deviceCurrentIndex >= 0 && deviceCurrentIndex < deviceQueue.length
      ? deviceQueue[deviceCurrentIndex]
      : null;

  const reportPlaybackError = useCallback((scope: string, err: unknown) => {
    const message =
      err instanceof Error ? err.message : 'Erreur de lecture inconnue';
    logger.error(scope, message, err);
    setPlaybackError(message);
  }, []);

  const clearPlaybackError = useCallback(() => {
    setPlaybackError(null);
  }, []);

  const updateProgressThrottled = useCallback((currentTime: number, dur: number) => {
    lastProgressRef.current = dur > 0 ? currentTime / dur : 0;
    lastDurationRef.current = dur;

    if (progressThrottleRef.current) return;

    progressThrottleRef.current = setTimeout(() => {
      progressThrottleRef.current = null;
      setProgress(lastProgressRef.current);
      setDuration(lastDurationRef.current);
    }, PROGRESS_THROTTLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (progressThrottleRef.current) {
        clearTimeout(progressThrottleRef.current);
      }
    };
  }, []);

  async function resolveLocalKey(
    albumId: string,
    keyInMemory: string | null,
  ): Promise<string | null> {
    if (keyInMemory) return keyInMemory;
    const cached = keyCacheRef.current.get(albumId);
    if (cached) return cached;
    const local = await readLocalDecryptionKey(albumId);
    if (local) {
      keyCacheRef.current.set(albumId, local);
    }
    return local;
  }

  async function resolveKeyForAlbum(
    albumData: PublicAlbumDetails,
    keyHint?: string | null,
  ): Promise<string | null> {
    const fromHint = keyHint ?? (albumData as PublicAlbumDetails & { decryption_key?: string })
      .decryption_key;
    if (fromHint) {
      keyCacheRef.current.set(albumData.id, fromHint);
      return fromHint;
    }
    const local = await resolveLocalKey(albumData.id, null);
    if (local) return local;

    const resolved = await resolveAlbumDecryptionKey(albumData.id, null);
    if (resolved) {
      keyCacheRef.current.set(albumData.id, resolved);
    }
    return resolved;
  }

  async function resolvePlayMode(
    track: PublicTrack,
    albumData: PublicAlbumDetails,
    key: string | null,
  ): Promise<PlayMode> {
    const isFreeRelease = Boolean(albumData.is_free);
    const effectiveKey = await resolveKeyForAlbum(albumData, key);

    // Priorité 1 : vault local complet (clé optionnelle — pistes peuvent être en clair)
    const offlineReady = await isAlbumReadyOffline(albumData.id);
    if (offlineReady) {
      return 'local';
    }

    const ownedPaid =
      !isFreeRelease &&
      (libraryRef.current.some((entry) => entry.id === albumData.id) ||
        (await isAlbumOwnedByDevice(albumData.id)));

    // Priorité 2 : proxy premium (clé locale ou album possédé — le serveur peut déchiffrer / envoyer le brut)
    if (!isFreeRelease && (effectiveKey || ownedPaid)) {
      return 'remote';
    }

    // Priorité 2b : proxy (gratuit avec URL ou preview)
    if (
      effectiveKey &&
      (track.encrypted_audio_url || track.preview_url)
    ) {
      return 'remote';
    }

    // Priorité 3 : flux direct (preview / stream non chiffré)
    if (track.preview_url || track.stream_url) {
      return 'stream';
    }

    // Priorité 4 : HLS album (dernier recours gratuit)
    if (isFreeRelease && albumData.stream_status === 'ready' && albumData.stream_url) {
      return 'hls';
    }

    throw new Error(
      "Aucune URL de lecture disponible pour ce titre. L'album doit être activé ou disposer d'un stream.",
    );
  }

  function setParallelQueue(albums: PublicAlbumDetails[], keys: (string | null)[]) {
    queueParallelRef.current = { albums, keys };
    setQueueAlbums(albums);
  }

  function clearParallelQueue() {
    queueParallelRef.current = null;
    setQueueAlbums([]);
  }

  /** Mélange uniquement les indices [0..length) via Fisher-Yates. */
  function shuffleIndexOrder(length: number): number[] {
    const order = Array.from({ length }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  /**
   * Mélange uniquement les morceaux à venir (après le titre en cours).
   * Ne modifie pas currentIndex / deviceCurrentIndex et ne relance pas la lecture.
   */
  function shuffleRemainingQueue() {
    if (isDevicePlaybackRef.current) {
      const currentIdx = deviceCurrentIndexRef.current;
      const q = deviceQueueRef.current;
      if (currentIdx < 0 || currentIdx >= q.length - 1) return;

      const head = q.slice(0, currentIdx + 1);
      const tail = q.slice(currentIdx + 1);
      const order = shuffleIndexOrder(tail.length);
      const shuffledTail = order.map((i) => tail[i]!);
      deviceQueueRef.current = [...head, ...shuffledTail];
      setDeviceQueue(deviceQueueRef.current);
      return;
    }

    const currentIdx = currentIndexRef.current;
    const q = queueRef.current;
    if (currentIdx < 0 || currentIdx >= q.length - 1) return;

    const headEnd = currentIdx + 1;
    const tailTracks = q.slice(headEnd);
    if (tailTracks.length < 2) return;

    const order = shuffleIndexOrder(tailTracks.length);
    const shuffledTail = order.map((i) => tailTracks[i]!);
    queueRef.current = [...q.slice(0, headEnd), ...shuffledTail];

    const parallel = queueParallelRef.current;
    if (parallel && parallel.albums.length === q.length) {
      const tailAlbums = parallel.albums.slice(headEnd);
      const tailKeys = parallel.keys.slice(headEnd);
      const shuffledAlbums = order.map((i) => tailAlbums[i]!);
      const shuffledKeys = order.map((i) => tailKeys[i]!);
      setParallelQueue(
        [...parallel.albums.slice(0, headEnd), ...shuffledAlbums],
        [...parallel.keys.slice(0, headEnd), ...shuffledKeys],
      );
    }

    setQueue([...queueRef.current]);
  }

  async function advanceToNextDeviceTrack() {
    if (trackAdvanceLockRef.current) return;
    trackAdvanceLockRef.current = true;
    try {
      const repeat = repeatModeRef.current;
      if (repeat === 'one') {
        await playDeviceAtIndexRef.current(deviceCurrentIndexRef.current);
        return;
      }

      const nextIdx = deviceCurrentIndexRef.current + 1;
      if (nextIdx < deviceQueueRef.current.length) {
        await playDeviceAtIndexRef.current(nextIdx);
        return;
      }

      if (repeat === 'all' && deviceQueueRef.current.length > 0) {
        await playDeviceAtIndexRef.current(0);
        return;
      }

      setIsPlaying(false);
      setProgress(0);
      isPlayingRef.current = false;
    } finally {
      trackAdvanceLockRef.current = false;
    }
  }

  const playDeviceAtIndexRef = useRef<(index: number) => Promise<void>>(async () => {});

  async function advanceToNextTrack() {
    if (isDevicePlaybackRef.current) {
      await advanceToNextDeviceTrack();
      return;
    }

    if (trackAdvanceLockRef.current) return;
    trackAdvanceLockRef.current = true;
    try {
      const repeat = repeatModeRef.current;
      if (repeat === 'one') {
        await playAtIndexRef.current(currentIndexRef.current);
        return;
      }

      const nextIdx = currentIndexRef.current + 1;
      if (nextIdx < queueRef.current.length) {
        await playAtIndexRef.current(nextIdx);
        return;
      }

      if (repeat === 'all') {
        await playAtIndexRef.current(0);
        return;
      }

      if (queueModeRef.current === 'shuffle' && libraryRef.current.length > 0) {
        await generateShuffledQueue();
        if (queueRef.current.length > 0) {
          await playAtIndexRef.current(0);
        }
        return;
      }

      if (queueScopeRef.current === 'trackList') {
        setIsPlaying(false);
        setProgress(0);
        isPlayingRef.current = false;
        return;
      }

      await playNextAlbum();
    } finally {
      trackAdvanceLockRef.current = false;
    }
  }

  async function fetchAndCacheKey(albumId: string): Promise<string | null> {
    const fromMemory = await resolveLocalKey(albumId, decryptionKeyRef.current);
    if (fromMemory) return fromMemory;

    const offline = await resolveOfflinePlayback(albumId);
    if (offline.decryptionKey) {
      keyCacheRef.current.set(albumId, offline.decryptionKey);
      return offline.decryptionKey;
    }

    const resolved = await resolveAlbumDecryptionKey(albumId, null);
    if (resolved) {
      keyCacheRef.current.set(albumId, resolved);
    }
    return resolved;
  }

  async function playNextAlbum() {
    const lib = libraryRef.current;
    const currentLibIdx = libraryIndexRef.current;
    const mode = queueModeRef.current;

    if (mode === 'shuffle') return;

    if (lib.length === 0 || currentLibIdx < 0) {
      setIsPlaying(false);
      setProgress(0);
      isPlayingRef.current = false;
      return;
    }

    const nextLibIdx = currentLibIdx + 1;
    if (nextLibIdx >= lib.length) {
      setIsPlaying(false);
      setProgress(0);
      isPlayingRef.current = false;
      return;
    }

    const nextAlbumSummary = lib[nextLibIdx];
    try {
      const offline = await resolveOfflinePlayback(nextAlbumSummary.id);
      const nextAlbum =
        offline.metadata ?? unwrapAlbumDetails(await getAlbum(nextAlbumSummary.id));
      const nextKey =
        offline.decryptionKey ?? (await fetchAndCacheKey(nextAlbum.id));

      const sorted = sortTracksByPosition(nextAlbum.tracks || []);

      albumRef.current = nextAlbum;
      queueRef.current = sorted;
      decryptionKeyRef.current = nextKey;
      libraryIndexRef.current = nextLibIdx;

      setAlbum(nextAlbum);
      setQueue(sorted);
      setDecryptionKey(nextKey);
      setLibraryIndex(nextLibIdx);

      if (sorted.length > 0) {
        await startPlayback(sorted[0], 0, nextAlbum, nextKey);
      }
    } catch (err) {
      reportPlaybackError('AudioContext', err);
      setIsPlaying(false);
      setProgress(0);
      isPlayingRef.current = false;
    }
  }

  async function startDevicePlayback(track: DeviceTrack, index: number) {
    setPlaybackError(null);
    setIsLoading(true);
    setIsPlaying(false);
    pendingHlsSeekSecondsRef.current = null;
    isDevicePlaybackRef.current = true;

    try {
      await stopCurrentTrack();
      setPlayMode('device');
      clearParallelQueue();
      albumRef.current = null;
      queueRef.current = [];
      setAlbum(null);
      setQueue([]);
      setDecryptionKey(null);
      decryptionKeyRef.current = null;
      currentIndexRef.current = -1;
      setCurrentIndex(-1);

      const handleStatus = (status: {
        currentTime?: number;
        duration?: number;
        playing?: boolean;
        playbackState?: string;
        isLoaded?: boolean;
      }) => {
        const currentTime: number = status.currentTime ?? 0;
        const dur: number = status.duration ?? 0;

        if (dur > 0) {
          updateProgressThrottled(currentTime, dur);
        }

        if (dur > 0 && currentTime >= dur - 0.35 && !status.playing) {
          void advanceToNextDeviceTrack();
        }

        if (status.playing !== undefined) {
          const isActuallyPlaying = Boolean(status.playing);
          setIsPlaying(isActuallyPlaying);
          isPlayingRef.current = isActuallyPlaying;
        }
      };

      const player = await playDeviceFile(track.uri, handleStatus);
      if (!player) throw new Error('Impossible de lire ce fichier local.');

      deviceCurrentIndexRef.current = index;
      setDeviceCurrentIndex(index);
      setIsPlaying(true);
      isPlayingRef.current = true;
    } catch (err) {
      reportPlaybackError('AudioContext.device', err);
      setIsPlaying(false);
      isPlayingRef.current = false;
      throw err;
    } finally {
      setIsLoading(false);
    }
  }

  async function startPlayback(
    track: PublicTrack,
    index: number,
    albumData: PublicAlbumDetails,
    key: string | null,
    retryCount: number = 0,
  ) {
    if (retryCount === 0) setPlaybackError(null);
    isDevicePlaybackRef.current = false;
    setDeviceCurrentIndex(-1);
    deviceCurrentIndexRef.current = -1;

    setIsLoading(true);
    setIsPlaying(false);
    pendingHlsSeekSecondsRef.current = null;

    try {
      await stopCurrentTrack();

      const effectiveKey = await resolveLocalKey(albumData.id, key);
      if (effectiveKey && !decryptionKeyRef.current) {
        decryptionKeyRef.current = effectiveKey;
        setDecryptionKey(effectiveKey);
      }

      const mode = await resolvePlayMode(track, albumData, effectiveKey);
      setPlayMode(mode);

      if (mode === 'hls') {
        const sorted = sortTracksByPosition(albumData.tracks || []);
        pendingHlsSeekSecondsRef.current = getTrackStartOffsetSeconds(sorted, index);
      }

      const handleStatus = (status: {
        currentTime?: number;
        duration?: number;
        playing?: boolean;
        playbackState?: string;
        isLoaded?: boolean;
      }) => {
        const currentTime: number = status.currentTime ?? 0;
        const dur: number = status.duration ?? 0;

        if (dur > 0) {
          updateProgressThrottled(currentTime, dur);

          const pendingSeek = pendingHlsSeekSecondsRef.current;
          if (pendingSeek !== null && pendingSeek > 0) {
            if (seekToSeconds(pendingSeek)) {
              pendingHlsSeekSecondsRef.current = null;
              const ratio = pendingSeek / dur;
              lastProgressRef.current = ratio;
              setProgress(ratio);
            }
          }
        }

        if (dur > 0 && currentTime >= dur - 0.35 && !status.playing) {
          void advanceToNextTrack();
        }

        if (status.playing !== undefined) {
          const isActuallyPlaying = Boolean(status.playing);
          setIsPlaying(isActuallyPlaying);
          isPlayingRef.current = isActuallyPlaying;
        }

        if (
          status.playbackState === 'idle' &&
          status.isLoaded === false &&
          dur === 0 &&
          currentTime === 0
        ) {
          if (retryCount >= 2) {
            if (albumData.stream_status === 'ready' && albumData.stream_url) {
              const sorted = sortTracksByPosition(albumData.tracks || []);
              pendingHlsSeekSecondsRef.current = getTrackStartOffsetSeconds(sorted, index);
              void playStream(albumData.stream_url, handleStatus);
            } else {
              setIsLoading(false);
            }
            return;
          }

          void getAlbum(albumData.id)
            .then((raw) => {
              const freshAlbum = unwrapAlbumDetails(raw);
              const freshTrack = freshAlbum.tracks.find((t) => t.id === track.id);
              const freshUrl = freshTrack?.preview_url ?? freshTrack?.encrypted_audio_url;
              if (freshUrl && freshTrack) {
                queueRef.current = sortTracksByPosition(freshAlbum.tracks || []);
                setQueue(queueRef.current);
                void startPlayback(freshTrack, index, freshAlbum, effectiveKey, retryCount + 1);
              } else {
                setIsLoading(false);
              }
            })
            .catch(() => setIsLoading(false));
        }
      };

      if (mode === 'local') {
        const player = await playTrack(track.id, effectiveKey, handleStatus);
        if (!player) throw new Error('Fichier local introuvable.');
      } else if (mode === 'hls' && albumData.stream_url) {
        await playStream(albumData.stream_url, handleStatus);
      } else if (mode === 'remote') {
        const useEncryption =
          Boolean(effectiveKey) &&
          (track.is_encrypted === undefined || track.is_encrypted === true);
        const proxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(track.id)}/audio`;
        // Ne pas prioriser les URLs B2 expirées avant le proxy (évite 401)
        const fallbackUrls = [track.preview_url, track.encrypted_audio_url].filter(
          (candidate): candidate is string => Boolean(candidate),
        );
        const player = await playRemoteTrack(
          proxyUrl,
          track.id,
          effectiveKey ?? '',
          useEncryption,
          handleStatus,
          fallbackUrls,
        );
        if (!player) throw new Error('Impossible de lire ce titre.');
      } else {
        const url = track.preview_url ?? track.encrypted_audio_url ?? track.stream_url;
        if (!url) {
          throw new Error(
            "L'aperçu de cette piste n'est pas disponible. Veuillez acheter l'album pour l'écouter.",
          );
        }

        try {
          await playStream(url, handleStatus);
        } catch {
          const freshAlbum = unwrapAlbumDetails(await getAlbum(albumData.id));
          const freshTrack = freshAlbum.tracks.find((t) => t.id === track.id);
          const freshUrl =
            freshTrack?.preview_url ?? freshTrack?.encrypted_audio_url ?? freshTrack?.stream_url;
          if (!freshUrl) throw new Error('Impossible de rafraîchir les URLs de lecture.');
          queueRef.current = sortTracksByPosition(freshAlbum.tracks || []);
          setQueue(queueRef.current);
          await playStream(freshUrl, handleStatus);
        }
      }

      currentIndexRef.current = index;
      setCurrentIndex(index);
      setIsPlaying(true);
      isPlayingRef.current = true;

      const nextIndex = index + 1;
      if (nextIndex < queueRef.current.length) {
        const nextTrack = queueRef.current[nextIndex];
        const nextUrl = nextTrack.encrypted_audio_url || nextTrack.preview_url;
        if (nextUrl) {
          const proxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(nextTrack.id)}/audio`;
          const fallbackUrls = [nextTrack.preview_url, nextTrack.encrypted_audio_url].filter(
            (candidate): candidate is string => Boolean(candidate),
          );
          void prefetchRemoteTrack(proxyUrl, nextTrack.id, fallbackUrls);
        }
      }
    } catch (err) {
      reportPlaybackError('AudioContext.playback', err);
      setIsPlaying(false);
      isPlayingRef.current = false;
      throw err;
    } finally {
      setIsLoading(false);
    }
  }

  async function generateShuffledQueue(startAlbumId?: string, startTrackIndex?: number) {
    const lib = libraryRef.current;
    if (lib.length === 0) return;

    const allTracks: {
      track: PublicTrack;
      album: PublicAlbumDetails;
      albumIndex: number;
    }[] = [];

    for (let i = 0; i < lib.length; i++) {
      const albumSummary = lib[i];
      try {
        const offline = await resolveOfflinePlayback(albumSummary.id);
        const albumDetails =
          offline.metadata ?? (await getAlbum(albumSummary.id));
        const sorted = sortTracksByPosition(albumDetails.tracks || []);
        for (const t of sorted) {
          allTracks.push({ track: t, album: albumDetails, albumIndex: i });
        }
      } catch (err) {
        logger.error('AudioContext.shuffle', `Album ${albumSummary.id}`, err);
      }
    }

    for (let i = allTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }

    if (startAlbumId && startTrackIndex !== undefined) {
      const startIdx = allTracks.findIndex(
        (t) =>
          t.album.id === startAlbumId &&
          t.track.id === queueRef.current[startTrackIndex]?.id,
      );
      if (startIdx > 0) {
        const [startItem] = allTracks.splice(startIdx, 1);
        allTracks.unshift(startItem);
      }
    }

    const shuffledQueue = allTracks.map((t) => t.track);
    const shuffledAlbums = allTracks.map((t) => t.album);
    const shuffledKeys = await Promise.all(
      shuffledAlbums.map((a) => resolveKeyForAlbum(a)),
    );

    queueRef.current = shuffledQueue;
    setParallelQueue(shuffledAlbums, shuffledKeys);

    setQueue(shuffledQueue);
  }

  const playDeviceAtIndex = useCallback(async (index: number) => {
    const q = deviceQueueRef.current;
    if (index < 0 || index >= q.length) return;
    await startDevicePlayback(q[index], index);
  }, [updateProgressThrottled]);

  playDeviceAtIndexRef.current = playDeviceAtIndex;

  const playDeviceTrackAtIndex = useCallback(
    async (tracks: DeviceTrack[], index: number) => {
      if (tracks.length === 0) return;
      const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
      deviceQueueRef.current = tracks;
      setDeviceQueue(tracks);
      queueScopeRef.current = 'album';
      setQueueScope('album');
      await playDeviceAtIndex(safeIndex);
    },
    [playDeviceAtIndex],
  );

  const playAtIndex = useCallback(async (index: number) => {
    if (isDevicePlaybackRef.current) {
      await playDeviceAtIndex(index);
      return;
    }

    const q = queueRef.current;
    const alb = albumRef.current;

    if (index < 0 || index >= q.length) return;

    const parallel = queueParallelRef.current;
    const useParallel =
      parallel &&
      parallel.albums[index] &&
      (queueScopeRef.current === 'trackList' || queueModeRef.current === 'shuffle');

    if (useParallel) {
      const targetAlbum = parallel.albums[index];
      let nextKey =
        parallel.keys[index] ?? keyCacheRef.current.get(targetAlbum.id) ?? null;
      if (!nextKey) {
        nextKey = await resolveKeyForAlbum(targetAlbum);
        parallel.keys[index] = nextKey;
      }
      if (!nextKey && !targetAlbum.is_free) {
        nextKey = await fetchAndCacheKey(targetAlbum.id);
        parallel.keys[index] = nextKey;
      }

      albumRef.current = targetAlbum;
      decryptionKeyRef.current = nextKey;
      setAlbum(targetAlbum);
      setDecryptionKey(nextKey);

      if (queueModeRef.current === 'shuffle') {
        const albumIndices = parallel.albums.map((a, i) =>
          libraryRef.current.findIndex((lib) => lib.id === a.id),
        );
        const libIdx = albumIndices[index];
        if (libIdx >= 0) {
          libraryIndexRef.current = libIdx;
          setLibraryIndex(libIdx);
        }
      }

      await startPlayback(q[index], index, targetAlbum, nextKey);
      return;
    }

    if (!alb) return;

    let key = decryptionKeyRef.current;
    if (!key) {
      key = await resolveKeyForAlbum(alb, null);
    }
    if (!key && !alb.is_free) {
      key = await fetchAndCacheKey(alb.id);
    }
    if (key) {
      decryptionKeyRef.current = key;
      setDecryptionKey(key);
    }

    await startPlayback(q[index], index, alb, key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateProgressThrottled]);

  playAtIndexRef.current = playAtIndex;

  const loadAlbum = useCallback((albumData: PublicAlbumDetails, key?: string | null) => {
    const sorted = sortTracksByPosition(albumData.tracks || []);
    queueScopeRef.current = 'album';
    setQueueScope('album');
    clearParallelQueue();

    albumRef.current = albumData;
    queueRef.current = sorted;
    decryptionKeyRef.current = key ?? null;

    const libIdx = libraryRef.current.findIndex((a) => a.id === albumData.id);
    if (libIdx >= 0) {
      libraryIndexRef.current = libIdx;
      setLibraryIndex(libIdx);
    }

    if (key && albumData.id) {
      keyCacheRef.current.set(albumData.id, key);
    }

    setAlbum(albumData);
    setQueue(sorted);
    setDecryptionKey(key ?? null);
    setCurrentIndex(-1);
    currentIndexRef.current = -1;
    setProgress(0);
    setDuration(0);
    lastProgressRef.current = 0;
    lastDurationRef.current = 0;
    setPlayMode(null);
  }, []);

  const playFromTrackList = useCallback(
    async (
      items: TrackListPlayItem[],
      albumById: Map<string, PublicAlbumDetails>,
      startTrackId: string,
    ) => {
      const tracks: PublicTrack[] = [];
      const albums: PublicAlbumDetails[] = [];
      const keys: (string | null)[] = [];

      for (const item of items) {
        let albumData = albumById.get(item.album_id);
        if (!albumData) {
          try {
            albumData = unwrapAlbumDetails(await getAlbum(item.album_id));
            albumById.set(item.album_id, albumData);
          } catch {
            continue;
          }
        }

        const sorted = sortTracksByPosition(albumData.tracks || []);
        const fullTrack = sorted.find((t) => t.id === item.id);
        if (!fullTrack) continue;

        let key = await resolveKeyForAlbum(albumData);
        if (!key && !albumData.is_free) {
          key = await fetchAndCacheKey(albumData.id);
        }

        tracks.push(fullTrack);
        albums.push(albumData);
        keys.push(key);
      }

      if (tracks.length === 0) {
        throw new Error('Aucun titre disponible dans cette liste.');
      }

      let startIndex = tracks.findIndex((t) => t.id === startTrackId);
      if (startIndex < 0) startIndex = 0;

      queueScopeRef.current = 'trackList';
      setQueueScope('trackList');
      queueModeRef.current = 'sequential';
      setQueueMode('sequential');

      queueRef.current = tracks;
      setParallelQueue(albums, keys);
      setQueue(tracks);

      const startAlbum = albums[startIndex];
      const startKey = keys[startIndex];
      albumRef.current = startAlbum;
      decryptionKeyRef.current = startKey;
      setAlbum(startAlbum);
      setDecryptionKey(startKey);
      setCurrentIndex(-1);
      currentIndexRef.current = -1;

      await playAtIndex(startIndex);
    },
    [playAtIndex],
  );

  const playTrackAtIndex = useCallback(
    async (index: number) => {
      await playAtIndex(index);
    },
    [playAtIndex],
  );

  const togglePlayPause = useCallback(() => {
    const newState = toggleAudioPlayPause();
    setIsPlaying(newState);
    isPlayingRef.current = newState;
  }, []);

  const next = useCallback(async () => {
    if (isDevicePlaybackRef.current) {
      const len = deviceQueueRef.current.length;
      if (len === 0) return;
      let nextIdx = deviceCurrentIndexRef.current + 1;
      if (nextIdx >= len) {
        if (repeatModeRef.current === 'all') nextIdx = 0;
        else return;
      }
      await playDeviceAtIndex(nextIdx);
      return;
    }

    const q = queueRef.current;
    const len = q.length;
    if (len === 0) return;

    let nextIdx = currentIndexRef.current + 1;
    if (nextIdx >= len) {
      if (repeatModeRef.current === 'all') {
        nextIdx = 0;
      } else {
        return;
      }
    }
    await playAtIndex(nextIdx);
  }, [playAtIndex, playDeviceAtIndex]);

  const previous = useCallback(async () => {
    if (isDevicePlaybackRef.current) {
      const len = deviceQueueRef.current.length;
      if (len === 0) return;
      let prevIdx = deviceCurrentIndexRef.current - 1;
      if (prevIdx < 0) {
        if (repeatModeRef.current === 'all') prevIdx = len - 1;
        else return;
      }
      await playDeviceAtIndex(prevIdx);
      return;
    }

    const q = queueRef.current;
    const len = q.length;
    if (len === 0) return;

    let prevIdx = currentIndexRef.current - 1;
    if (prevIdx < 0) {
      if (repeatModeRef.current === 'all') {
        prevIdx = len - 1;
      } else {
        return;
      }
    }
    await playAtIndex(prevIdx);
  }, [playAtIndex, playDeviceAtIndex]);

  const toggleRepeat = useCallback(() => {
    const order: RepeatMode[] = ['off', 'one', 'all'];
    const i = order.indexOf(repeatModeRef.current);
    const nextMode = order[(i + 1) % order.length];
    repeatModeRef.current = nextMode;
    setRepeatMode(nextMode);
  }, []);

  const stop = useCallback(async () => {
    await stopCurrentTrack();
    setIsPlaying(false);
    setProgress(0);
    currentIndexRef.current = -1;
    setCurrentIndex(-1);
    isPlayingRef.current = false;
    isDevicePlaybackRef.current = false;
    deviceCurrentIndexRef.current = -1;
    setDeviceCurrentIndex(-1);
    setPlayMode(null);
  }, []);

  const toggleQueueMode = useCallback(() => {
    const newMode = queueModeRef.current === 'sequential' ? 'shuffle' : 'sequential';
    queueModeRef.current = newMode;
    setQueueMode(newMode);

    if (newMode === 'shuffle') {
      shuffleRemainingQueue();
    } else if (newMode === 'sequential' && queueScopeRef.current === 'album' && albumRef.current) {
      // Retrouve la position du morceau en cours dans la queue originale triée
      const currentTrackId = queueRef.current[currentIndexRef.current]?.id;
      clearParallelQueue();
      const sorted = sortTracksByPosition(albumRef.current.tracks || []);
      queueRef.current = sorted;
      setQueue(sorted);
      if (currentTrackId) {
        const newIdx = sorted.findIndex((t) => t.id === currentTrackId);
        if (newIdx >= 0) {
          currentIndexRef.current = newIdx;
          setCurrentIndex(newIdx);
        }
      }
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      const ownedAlbums = await listOwnedAlbums();
      const sorted = ownedAlbums.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });
      libraryRef.current = sorted;
      setLibrary(sorted);
      setIsLibraryLoaded(true);
    } catch (err) {
      logger.error('AudioContext.loadLibrary', err);
    }
  }, []);

  const seekTo = useCallback((position: number) => {
    const success = audioSeekTo(position);
    if (success) {
      lastProgressRef.current = position;
      setProgress(position);
    }
  }, []);

  const playbackValue = useMemo<AudioPlaybackContextValue>(
    () => ({
      album,
      queue,
      currentIndex,
      currentTrack,
      isPlaying,
      isLoading,
      playMode,
      decryptionKey,
      isFullPlayerVisible,
      queueMode,
      repeatMode,
      library,
      libraryIndex,
      isLibraryLoaded,
      queueScope,
      deviceQueue,
      deviceCurrentIndex,
      deviceCurrentTrack,
      queueAlbums,
      playbackError,
      loadAlbum,
      playFromTrackList,
      playTrackAtIndex,
      togglePlayPause,
      next,
      previous,
      stop,
      setFullPlayerVisible,
      toggleQueueMode,
      toggleRepeat,
      loadLibrary,
      seekTo,
      playDeviceTrackAtIndex,
      clearPlaybackError,
    }),
    [
      album,
      queue,
      currentIndex,
      currentTrack,
      isPlaying,
      isLoading,
      playMode,
      decryptionKey,
      isFullPlayerVisible,
      queueMode,
      repeatMode,
      library,
      libraryIndex,
      isLibraryLoaded,
      queueScope,
      deviceQueue,
      deviceCurrentIndex,
      deviceCurrentTrack,
      queueAlbums,
      playbackError,
      loadAlbum,
      playFromTrackList,
      playTrackAtIndex,
      togglePlayPause,
      next,
      previous,
      stop,
      toggleQueueMode,
      toggleRepeat,
      loadLibrary,
      seekTo,
      playDeviceTrackAtIndex,
      clearPlaybackError,
    ],
  );

  const progressValue = useMemo<AudioProgressState>(
    () => ({ progress, duration }),
    [progress, duration],
  );

  return (
    <AudioPlaybackContext.Provider value={playbackValue}>
      <AudioProgressContext.Provider value={progressValue}>
        {children}
      </AudioProgressContext.Provider>
    </AudioPlaybackContext.Provider>
  );
}

export function useAudioPlayback(): AudioPlaybackContextValue {
  const ctx = useContext(AudioPlaybackContext);
  if (!ctx) {
    throw new Error("useAudioPlayback doit être utilisé à l'intérieur d'<AudioProvider>");
  }
  return ctx;
}

export function useAudioProgress(): AudioProgressState {
  const ctx = useContext(AudioProgressContext);
  if (!ctx) {
    throw new Error("useAudioProgress doit être utilisé à l'intérieur d'<AudioProvider>");
  }
  return ctx;
}

/** Compatibilité : combine playback + progression (préférer les hooks séparés). */
export function useAudio(): AudioPlaybackContextValue & AudioProgressState & AudioActions {
  return { ...useAudioPlayback(), ...useAudioProgress() };
}
