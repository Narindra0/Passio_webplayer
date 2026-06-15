/**
 * AudioContext.tsx — État audio global de l'application Pass'io (version web).
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

import { isAlbumOwnedByDevice, resolveAlbumDecryptionKey } from '@/services/albumOwnership';
import { getAlbum, getApiBaseUrl, listOwnedAlbums, unwrapAlbumDetails } from '@/services/api';
import {
    seekTo as audioSeekTo,
    playDeviceFile,
    playWebOptimizedTrack,
    playStream,
    prefetchSecureTrack,
    setTrackEndHandler,
    setVolume as setAudioVolume,
    setMuted as setAudioMuted,
    stopCurrentTrack,
    togglePlayPause as toggleAudioPlayPause
} from '@/services/audio';
import { readLocalDecryptionKey, resolveOfflinePlayback } from '@/services/offlineAccess';
import type { PublicAlbumDetails, PublicAlbumSummary, PublicTrack } from '@/types/backend';
import type { DeviceTrack } from '@/types/localLibrary';
import { logger } from '@/utils/logger';
import { getTrackIndexInQueue, sortTracksByPosition } from '@/utils/tracks';

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
  queueAlbums: PublicAlbumDetails[];
  playbackError: string | null;
  lyricsAutoOpen: boolean;
  setLyricsAutoOpen: (v: boolean) => void;
}

export interface AudioProgressState {
  progress: number;
  duration: number;
}

export interface AudioActions {
  loadAlbum: (album: PublicAlbumDetails, decryptionKey?: string | null) => void;
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
  volume: number;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  isMuted: boolean;
}

interface AudioPlaybackContextValue extends AudioPlaybackState, AudioActions {}

const DEFAULT_VOLUME = 1;

const AudioPlaybackContext = createContext<AudioPlaybackContextValue | null>(null);
const AudioProgressContext = createContext<AudioProgressState | null>(null);

const PROGRESS_THROTTLE_MS = 250;

export { getTrackIndexInQueue, sortTracksByPosition };

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
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [isMuted, setIsMuted] = useState(false);
  const [lyricsAutoOpen, setLyricsAutoOpen] = useState(false);

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
  const prefetchTriggeredRef = useRef(false);

  /**
   * Solution C: Précharge immédiatement la piste suivante dans la file.
   * Se déclenche dès qu'une piste commence à jouer, pour une transition
   * sans aucune latence vers la piste suivante.
   */
  function triggerNextTrackPrefetch(currentIdx: number) {
    const q = queueRef.current;
    let nextIdx = currentIdx + 1;
    if (nextIdx >= q.length && repeatModeRef.current === 'all' && q.length > 0) {
      nextIdx = 0;
    }
    if (nextIdx >= 0 && nextIdx < q.length) {
      const nextTrack = q[nextIdx];
      if (nextTrack) {
        // Check if we're in a free album!
        const isFreeAlbum = albumRef.current?.is_free;
        const nextUrl = nextTrack.encrypted_audio_url ?? nextTrack.preview_url ?? `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(nextTrack.id)}/audio`;
        
        if (isFreeAlbum) {
          // 🚀 For FREE tracks: just use a simple fetch to prime the browser cache
          console.log('[AudioContext] ⚡ Préchargement simple pour piste gratuite suivante:', nextTrack.title);
          fetch(nextUrl, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
        } else {
          // For premium tracks: use secure prefetch
          console.log('[AudioContext] ⚡ Préchargement sécurisé pour piste premium suivante:', nextTrack.title);
          prefetchSecureTrack(nextUrl, nextTrack.id);
        }
      }
    }
  }

  const currentTrack =
    currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const deviceCurrentTrack =
    deviceCurrentIndex >= 0 && deviceCurrentIndex < deviceQueue.length
      ? deviceQueue[deviceCurrentIndex]
      : null;

  const reportPlaybackError = useCallback((scope: string, err: unknown) => {
    const message = err instanceof Error ? err.message : 'Erreur de lecture inconnue';
    logger.error(scope, message, err);
    setPlaybackError(message);
  }, []);

  const clearPlaybackError = useCallback(() => setPlaybackError(null), []);

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
      if (progressThrottleRef.current) clearTimeout(progressThrottleRef.current);
    };
  }, []);

  async function resolveLocalKey(albumId: string, keyInMemory: string | null): Promise<string | null> {
    if (keyInMemory) return keyInMemory;
    const cached = keyCacheRef.current.get(albumId);
    if (cached) return cached;
    const local = await readLocalDecryptionKey(albumId);
    if (local) keyCacheRef.current.set(albumId, local);
    return local;
  }

  async function resolveKeyForAlbum(albumData: PublicAlbumDetails, keyHint?: string | null): Promise<string | null> {
    const fromHint = keyHint ?? (albumData as PublicAlbumDetails & { decryption_key?: string }).decryption_key;
    if (fromHint) {
      keyCacheRef.current.set(albumData.id, fromHint);
      return fromHint;
    }
    const local = await resolveLocalKey(albumData.id, null);
    if (local) return local;
    const resolved = await resolveAlbumDecryptionKey(albumData.id, null);
    if (resolved) keyCacheRef.current.set(albumData.id, resolved);
    return resolved;
  }

  async function resolvePlayMode(track: PublicTrack, albumData: PublicAlbumDetails, key: string | null): Promise<PlayMode> {
    const isFreeRelease = Boolean(albumData.is_free);
    const effectiveKey = await resolveKeyForAlbum(albumData, key);
    const ownedPaid = !isFreeRelease && (libraryRef.current.some((entry) => entry.id === albumData.id) || await isAlbumOwnedByDevice(albumData.id));

    // 🚀 For FREE tracks: always use stream mode if we have a URL!
    if (isFreeRelease) {
      if (track.encrypted_audio_url || track.preview_url || track.stream_url) return 'stream';
      if (albumData.stream_status === 'ready' && albumData.stream_url) return 'hls';
    }

    if (!isFreeRelease && (effectiveKey || ownedPaid)) return 'remote';
    if (effectiveKey && (track.encrypted_audio_url || track.preview_url)) return 'remote';
    if (track.preview_url || track.stream_url) return 'stream';
    if (isFreeRelease && albumData.stream_status === 'ready' && albumData.stream_url) return 'hls';

    throw new Error("Aucune URL de lecture disponible pour ce titre.");
  }

  function setParallelQueue(albums: PublicAlbumDetails[], keys: (string | null)[]) {
    queueParallelRef.current = { albums, keys };
    setQueueAlbums(albums);
  }

  function clearParallelQueue() {
    queueParallelRef.current = null;
    setQueueAlbums([]);
  }

  function shuffleIndexOrder(length: number): number[] {
    const order = Array.from({ length }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  function shuffleRemainingQueue() {
    const currentIdx = currentIndexRef.current;
    const q = queueRef.current;
    if (currentIdx < 0 || currentIdx >= q.length - 1) return;

    const headEnd = currentIdx + 1;
    const tailTracks = q.slice(headEnd);
    if (tailTracks.length < 2) return;

    const order = shuffleIndexOrder(tailTracks.length);
    const shuffledTail = order.map((i) => tailTracks[i]!);
    queueRef.current = [...q.slice(0, headEnd), ...shuffledTail];

    setQueue([...queueRef.current]);
  }

  async function advanceToNextTrack() {
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
        if (queueRef.current.length > 0) await playAtIndexRef.current(0);
        return;
      }
      setIsPlaying(false);
      setProgress(0);
      isPlayingRef.current = false;
    } finally {
      trackAdvanceLockRef.current = false;
    }
  }

  useEffect(() => {
    setTrackEndHandler(() => { void advanceToNextTrack(); });
  }, []);

  async function fetchAndCacheKey(albumId: string): Promise<string | null> {
    const fromMemory = await resolveLocalKey(albumId, decryptionKeyRef.current);
    if (fromMemory) return fromMemory;
    const offline = await resolveOfflinePlayback(albumId);
    if (offline.decryptionKey) {
      keyCacheRef.current.set(albumId, offline.decryptionKey);
      return offline.decryptionKey;
    }
    const resolved = await resolveAlbumDecryptionKey(albumId, null);
    if (resolved) keyCacheRef.current.set(albumId, resolved);
    return resolved;
  }

  async function startPlayback(
    track: PublicTrack,
    index: number,
    albumData: PublicAlbumDetails,
    key: string | null,
    isRetry: boolean = false,
  ) {
    console.log('[AudioContext] startPlayback called with:', {
      trackId: track.id,
      trackTitle: track.title,
      previewUrl: track.preview_url,
      streamUrl: track.stream_url,
      encryptedAudioUrl: track.encrypted_audio_url,
      albumId: albumData.id,
      albumTitle: albumData.title,
      isRetry
    });
    
    prefetchTriggeredRef.current = false;
    if (!isRetry) setPlaybackError(null);
    setIsLoading(true);
    setIsPlaying(false);
    pendingHlsSeekSecondsRef.current = null;
    isDevicePlaybackRef.current = false;

    try {
      // Résoudre la clé et le mode AVANT d'arrêter la piste en cours
      // → si resolvePlayMode échoue (aucun mode disponible), on ne perd pas la piste actuelle
      const effectiveKey = await resolveLocalKey(albumData.id, key);
      if (effectiveKey && !decryptionKeyRef.current) {
        decryptionKeyRef.current = effectiveKey;
        setDecryptionKey(effectiveKey);
      }

      const mode = await resolvePlayMode(track, albumData, effectiveKey);

      // Maintenant qu'on sait qu'on peut lire, on arrête la piste précédente
      await stopCurrentTrack();
      console.log('[AudioContext] Resolved playback mode:', mode);
      setPlayMode(mode);

      const handleStatus = (status: {
        currentTime?: number; duration?: number; playing?: boolean;
        playbackState?: string; isLoaded?: boolean;
      }) => {
        const currentTime: number = status.currentTime ?? 0;
        const dur: number = status.duration ?? 0;
        if (dur > 0) updateProgressThrottled(currentTime, dur);
        // L'avancement automatique est déclenché uniquement par l'événement 'ended' du HTMLAudioElement
        // (via currentTrackEndHandler → advanceToNextTrack). Cela évite les doubles appels
        // et le bug où une pause près de la fin avançait la piste.
        
        // Préchargement de la piste suivante quand il reste ≤ 10 secondes
        if (
          dur > 0 &&
          currentTime > 0 &&
          dur - currentTime <= 10 &&
          !prefetchTriggeredRef.current &&
          repeatModeRef.current !== 'one'
        ) {
          prefetchTriggeredRef.current = true;
          const currentIdx = currentIndexRef.current;
          const q = queueRef.current;
          let nextIdx = currentIdx + 1;

          // Gérer le repeat 'all' : reboucler à la première piste
          if (nextIdx >= q.length && repeatModeRef.current === 'all' && q.length > 0) {
            nextIdx = 0;
          }

          if (nextIdx >= 0 && nextIdx < q.length) {
            const nextTrack = q[nextIdx];
            if (nextTrack) {
              const isFreeAlbum = albumRef.current?.is_free;
              const nextUrl = nextTrack.encrypted_audio_url ?? nextTrack.preview_url ?? `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(nextTrack.id)}/audio`;
              
              if (isFreeAlbum) {
                console.log('[AudioContext] Préchargement simple pour piste gratuite suivante (fin de piste):', nextTrack.title);
                fetch(nextUrl, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
              } else {
                console.log('[AudioContext] Préchargement sécurisé pour piste premium suivante (fin de piste):', nextTrack.title);
                prefetchSecureTrack(nextUrl, nextTrack.id);
              }
            }
          }
        }

        if (status.playing !== undefined) {
          setIsPlaying(Boolean(status.playing));
          isPlayingRef.current = Boolean(status.playing);
        }
      };

      // Album-level HLS stream temporarily disabled - causing issues
      // if (
      //   albumData.stream_url && 
      //   albumData.stream_status === 'ready' && 
      //   (albumData.stream_url.includes('.m3u8') || albumData.stream_url.includes('hls'))
      // ) {
      //   console.log('[AudioContext] Trying album HLS stream:', albumData.stream_url);
      //   try {
      //     const streamPlayer = await playStream(albumData.stream_url, handleStatus);
      //     if (streamPlayer) {
      //       console.log('[AudioContext] Playback started with album HLS stream');
      //       currentIndexRef.current = index;
      //       setCurrentIndex(index);
      //       // TODO: Seek to the correct track position in the album stream
      //       return;
      //     }
      //   } catch (err) {
      //     console.warn('[AudioContext] Album HLS stream failed:', err);
      //   }
      // }

      console.log('[AudioContext] Track playback details:', {
        trackId: track.id,
        trackTitle: track.title,
        mode,
        albumStreamUrl: albumData.stream_url,
        albumStreamStatus: albumData.stream_status,
        previewUrl: track.preview_url,
        streamUrl: track.stream_url,
        encryptedAudioUrl: track.encrypted_audio_url
      });

      if (mode === 'remote') {
        const proxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(track.id)}/audio`;
        const isPremium = !albumData.is_free;
        
        try {
          const player = await playWebOptimizedTrack(
            track.id,
            track.preview_url,
            proxyUrl,
            isPremium,
            handleStatus
          );
          if (player) {
            currentIndexRef.current = index;
            setCurrentIndex(index);
            // Solution C: Préchargement immédiat de la piste suivante
            triggerNextTrackPrefetch(index);
            return;
          }
        } catch (err) {
          console.warn('[AudioContext] ❌ playWebOptimizedTrack failed:', err);
          throw new Error('Impossible de lire ce titre.');
        }
      } else {
        // For non-remote modes, try direct URLs first (prioritize encrypted_audio_url which is our Cloudflare CDN!)
        const url = track.encrypted_audio_url ?? track.preview_url ?? track.stream_url;
        console.log('[AudioContext] [1/2] Trying stream mode URL:', url);
        if (!url) throw new Error("L'aperçu de cette piste n'est pas disponible.");
        try {
          const streamPlayer = await playStream(url, handleStatus);
          if (streamPlayer) {
            console.log('[AudioContext] ✅ Playback started with direct Cloudflare URL');
            currentIndexRef.current = index;
            setCurrentIndex(index);
            // Solution C: Préchargement immédiat de la piste suivante
            triggerNextTrackPrefetch(index);
            return;
          }
        } catch (err) {
          console.warn('[AudioContext] ❌ Direct Cloudflare URL failed for stream mode:', err);
        }
        
        // Fallback to proxy if direct fails
        const proxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(track.id)}/audio`;
        console.log('[AudioContext] [2/2] Trying proxy URL for non-remote mode:', proxyUrl);
        const streamPlayer = await playStream(proxyUrl, handleStatus);
        if (!streamPlayer) throw new Error('Impossible de lire ce titre.');
        console.log('[AudioContext] ✅ Playback started with proxy URL');
        // Solution C: Préchargement immédiat de la piste suivante (pour stream)
        triggerNextTrackPrefetch(index);
      }

      currentIndexRef.current = index;
      setCurrentIndex(index);
      // Ne PAS overrider isPlaying ici — handleStatus a déjà été appelé
      // depuis playRemoteTrack/playStream avec la bonne valeur (playing: true/false)
    } catch (err) {
      console.error('[AudioContext] Playback failed with error:', err);
      // Une seule tentative de récupération : rafraîchir les données de l'album et réessayer
      // Si isRetry est déjà true, on affiche directement l'erreur définitive
      if (!isRetry) {
        try {
          console.log('[AudioContext] 🔄 Rafraîchissement des données album pour nouvelles URLs signées');
          const freshAlbum = unwrapAlbumDetails(await getAlbum(albumData.id));
          console.log('[AudioContext] Nouvelles données album recues:', freshAlbum);
          
          // Find the same track in the refreshed data WITHOUT mutating current state
          // → Si la piste n'est pas trouvée dans les données fraîches, on ne touche PAS
          //   à l'album/queue actuel pour éviter de casser l'affichage du lecteur
          const sortedTracks = sortTracksByPosition(freshAlbum.tracks || []);
          const freshTrack = sortedTracks.find(t => t.id === track.id);
          console.log('[AudioContext] Piste fraiche trouvee:', freshTrack?.title);
          if (freshTrack) {
            // Mettre à jour l'album et la queue SEULEMENT si on a trouvé la piste
            albumRef.current = freshAlbum;
            setAlbum(freshAlbum);
            queueRef.current = sortedTracks;
            setQueue(sortedTracks);
            // Une seule tentative de rejeu, isRetry=true bloque toute récursion ultérieure
            await startPlayback(freshTrack, index, freshAlbum, key, true);
            return;
          } else {
            // Piste introuvable dans les données rafraîchies → ne pas muter l'état
            console.warn('[AudioContext] ⚠️ Piste non trouvée dans les données rafraîchies, skip retry');
          }
        } catch (refreshErr) {
          console.error('[AudioContext] Échec du rafraîchissement des données album:', refreshErr);
        }
      }
      
      // Ne PAS réinitialiser l'état de la piste en cours :
      // - currentIndex, album, queue restent intacts → le lecteur reste affiché
      // - Seule l'erreur est transmise à l'UI pour affichage du message
      reportPlaybackError('AudioContext.playback', err);
      // isPlaying est déjà false (set dans playAtIndex)
      // Ne surtout PAS appeler setIsPlaying(false) ici — c'est redondant
      // et ne surtout PAS réinitialiser currentIndex ou album
    } finally {
      setIsLoading(false);
    }
  }

  async function generateShuffledQueue(startAlbumId?: string, startTrackIndex?: number) {
    const lib = libraryRef.current;
    if (lib.length === 0) return;

    const allTracks: { track: PublicTrack; album: PublicAlbumDetails; albumIndex: number }[] = [];

    for (let i = 0; i < lib.length; i++) {
      const albumSummary = lib[i];
      try {
        const albumDetails = await getAlbum(albumSummary.id);
        const sorted = sortTracksByPosition(albumDetails.tracks || []);
        for (const t of sorted) {
          allTracks.push({ track: t, album: albumDetails, albumIndex: i });
        }
      } catch { continue; }
    }

    for (let i = allTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }

    const shuffledQueue = allTracks.map((t) => t.track);
    const shuffledAlbums = allTracks.map((t) => t.album);

    queueRef.current = shuffledQueue;
    setParallelQueue(shuffledAlbums, []);
    setQueue(shuffledQueue);
  }

  const playAtIndex = useCallback(async (index: number) => {
    const q = queueRef.current;
    const alb = albumRef.current;
    if (index < 0 || index >= q.length || !alb) return;

    // Afficher le BottomPlayer IMMÉDIATEMENT avec l'état chargement
    // pour que l'utilisateur ait un retour visuel instantané
    currentIndexRef.current = index;
    setCurrentIndex(index);
    setIsLoading(true);
    setIsPlaying(false);
    setProgress(0);
    setDuration(0);
    lastProgressRef.current = 0;
    lastDurationRef.current = 0;
    setPlaybackError(null);
    setPlayMode(null);
    prefetchTriggeredRef.current = false;
    pendingHlsSeekSecondsRef.current = null;
    isDevicePlaybackRef.current = false;

    let key = decryptionKeyRef.current;
    if (!key) key = await resolveKeyForAlbum(alb, null);
    if (key) {
      decryptionKeyRef.current = key;
      setDecryptionKey(key);
    }
    await startPlayback(q[index], index, alb, key);
  }, []);

  playAtIndexRef.current = playAtIndex;

  const loadAlbum = useCallback((albumData: PublicAlbumDetails, key?: string | null) => {
    const sorted = sortTracksByPosition(albumData.tracks || []);
    queueScopeRef.current = 'album';
    setQueueScope('album');
    clearParallelQueue();

    albumRef.current = albumData;
    queueRef.current = sorted;
    decryptionKeyRef.current = key ?? null;

    // Solution C: Précharger la première piste dès le chargement de l'album
    if (sorted.length > 0) {
      const firstTrack = sorted[0];
      const firstUrl = firstTrack.encrypted_audio_url ?? firstTrack.preview_url ?? `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(firstTrack.id)}/audio`;
      const isFreeAlbum = albumData.is_free;
      
      if (isFreeAlbum) {
        console.log('[AudioContext] Préchargement simple pour première piste gratuite:', firstTrack.title);
        fetch(firstUrl, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
      } else {
        console.log('[AudioContext] Préchargement sécurisé pour première piste premium:', firstTrack.title);
        prefetchSecureTrack(firstUrl, firstTrack.id);
      }
    }

    const libIdx = libraryRef.current.findIndex((a) => a.id === albumData.id);
    if (libIdx >= 0) { libraryIndexRef.current = libIdx; setLibraryIndex(libIdx); }

    if (key && albumData.id) keyCacheRef.current.set(albumData.id, key);

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

  const playFromTrackList = useCallback(async (
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
        } catch { continue; }
      }

      const sorted = sortTracksByPosition(albumData.tracks || []);
      const fullTrack = sorted.find((t) => t.id === item.id);
      if (!fullTrack) continue;
      let key = await resolveKeyForAlbum(albumData);
      if (!key && !albumData.is_free) key = await fetchAndCacheKey(albumData.id);

      tracks.push(fullTrack);
      albums.push(albumData);
      keys.push(key);
    }

    if (tracks.length === 0) throw new Error('Aucun titre disponible dans cette liste.');

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
  }, [playAtIndex]);

  const playTrackAtIndex = useCallback(async (index: number) => { await playAtIndex(index); }, [playAtIndex]);

  const togglePlayPause = useCallback(() => {
    toggleAudioPlayPause().then((newState) => {
      setIsPlaying(newState);
      isPlayingRef.current = newState;
    }).catch(() => {
      // ignore
    });
  }, []);

  const next = useCallback(async () => {
    const q = queueRef.current;
    const len = q.length;
    if (len === 0) return;
    let nextIdx = currentIndexRef.current + 1;
    if (nextIdx >= len) {
      if (repeatModeRef.current === 'all') nextIdx = 0;
      else return;
    }
    await playAtIndex(nextIdx);
  }, [playAtIndex]);

  const previous = useCallback(async () => {
    const q = queueRef.current;
    const len = q.length;
    if (len === 0) return;
    let prevIdx = currentIndexRef.current - 1;
    if (prevIdx < 0) {
      if (repeatModeRef.current === 'all') prevIdx = len - 1;
      else return;
    }
    await playAtIndex(prevIdx);
  }, [playAtIndex]);

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
    setDuration(0);
    currentIndexRef.current = -1;
    setCurrentIndex(-1);
    isPlayingRef.current = false;
    setPlayMode(null);
    prefetchTriggeredRef.current = false;
  }, []);

  const toggleQueueMode = useCallback(() => {
    const newMode = queueModeRef.current === 'sequential' ? 'shuffle' : 'sequential';
    queueModeRef.current = newMode;
    setQueueMode(newMode);
    if (newMode === 'shuffle') shuffleRemainingQueue();
    else if (newMode === 'sequential' && queueScopeRef.current === 'album' && albumRef.current) {
      const currentTrackId = queueRef.current[currentIndexRef.current]?.id;
      clearParallelQueue();
      const sorted = sortTracksByPosition(albumRef.current.tracks || []);
      queueRef.current = sorted;
      setQueue(sorted);
      if (currentTrackId) {
        const newIdx = sorted.findIndex((t) => t.id === currentTrackId);
        if (newIdx >= 0) { currentIndexRef.current = newIdx; setCurrentIndex(newIdx); }
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
    prefetchTriggeredRef.current = false; // Permet de re-déclencher le préchargement si on seek vers la fin
    const success = audioSeekTo(position);
    if (success) {
      lastProgressRef.current = position;
      setProgress(position);
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    setAudioVolume(clamped);
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
      setAudioMuted(false);
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      setIsMuted(false);
      setAudioMuted(false);
      setAudioVolume(volume);
    } else {
      setIsMuted(true);
      setAudioMuted(true);
    }
  }, [isMuted, volume]);

  const playDeviceTrackAtIndex = useCallback(async (tracks: DeviceTrack[], index: number) => {
    if (tracks.length === 0) return;
    const safeIndex = Math.max(0, Math.min(index, tracks.length - 1));
    deviceQueueRef.current = tracks;
    setDeviceQueue(tracks);
    isDevicePlaybackRef.current = true;
    const track = tracks[safeIndex];
    if (!track) return;
    await playDeviceFile(track.uri, (status) => {
      const currentTime = status.currentTime ?? 0;
      const dur = status.duration ?? 0;
      if (dur > 0) updateProgressThrottled(currentTime, dur);
      if (status.playing !== undefined) { setIsPlaying(Boolean(status.playing)); isPlayingRef.current = Boolean(status.playing); }
    });
    setDeviceCurrentIndex(safeIndex);
    deviceCurrentIndexRef.current = safeIndex;
  }, [updateProgressThrottled]);

  const playbackValue = useMemo<AudioPlaybackContextValue>(() => ({
    album, queue, currentIndex, currentTrack, isPlaying, isLoading, playMode,
    decryptionKey, isFullPlayerVisible, queueMode, repeatMode, library, libraryIndex,
    isLibraryLoaded, queueScope, deviceQueue, deviceCurrentIndex, deviceCurrentTrack,
    queueAlbums, playbackError, lyricsAutoOpen,
    loadAlbum, playFromTrackList, playTrackAtIndex, togglePlayPause, next, previous, stop,
    setFullPlayerVisible, setLyricsAutoOpen, toggleQueueMode, toggleRepeat, loadLibrary, seekTo,
    playDeviceTrackAtIndex, clearPlaybackError,
    volume, setVolume, toggleMute, isMuted,
  }), [album, queue, currentIndex, currentTrack, isPlaying, isLoading, playMode,
    decryptionKey, isFullPlayerVisible, queueMode, repeatMode, library, libraryIndex,
    isLibraryLoaded, queueScope, deviceQueue, deviceCurrentIndex, deviceCurrentTrack,
    queueAlbums, playbackError, lyricsAutoOpen, loadAlbum, playFromTrackList, playTrackAtIndex,
    togglePlayPause, next, previous, stop, setFullPlayerVisible, setLyricsAutoOpen,
    toggleQueueMode, toggleRepeat, loadLibrary,
    seekTo, playDeviceTrackAtIndex, clearPlaybackError,
    volume, setVolume, toggleMute, isMuted]);

  const progressValue = useMemo<AudioProgressState>(() => ({ progress, duration }), [progress, duration]);

  return (
    <AudioPlaybackContext.Provider value={playbackValue}>
      <AudioProgressContext.Provider value={progressValue}>{children}</AudioProgressContext.Provider>
    </AudioPlaybackContext.Provider>
  );
}

export function useAudioPlayback(): AudioPlaybackContextValue {
  const ctx = useContext(AudioPlaybackContext);
  if (!ctx) throw new Error("useAudioPlayback doit être utilisé à l'intérieur d'<AudioProvider>");
  return ctx;
}

export function useAudioProgress(): AudioProgressState {
  const ctx = useContext(AudioProgressContext);
  if (!ctx) throw new Error("useAudioProgress doit être utilisé à l'intérieur d'<AudioProvider>");
  return ctx;
}

export function useAudio(): AudioPlaybackContextValue & AudioProgressState & AudioActions {
  return { ...useAudioPlayback(), ...useAudioProgress() };
}
