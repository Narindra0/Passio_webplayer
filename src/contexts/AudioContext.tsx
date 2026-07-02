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
import { getAlbum, getApiBaseUrl, listAlbums, listOwnedAlbums, unwrapAlbumDetails } from '@/services/api';
import { getCloudflareAudioUrl } from '@/config/urls';
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
    togglePlayPause as toggleAudioPlayPause,
    seekToSeconds as audioSeekToSeconds,
    ensureStreamDeviceId
} from '@/services/audio';
import { readLocalDecryptionKey, resolveOfflinePlayback } from '@/services/offlineAccess';
import type { PublicAlbumDetails, PublicAlbumSummary, PublicTrack } from '@/types/backend';
import type { DeviceTrack } from '@/types/localLibrary';
import { logger } from '@/utils/logger';
import { getTrackIndexInQueue, sortTracksByPosition } from '@/utils/tracks';
import { getOrCreateDeviceId } from '@/services/device';
import { secureAudioPlayer } from '@/services/secureAudioPlayer';
import { mseSecurePlayer } from '@/services/mseSecurePlayer';
import { recordArtistPlay } from '@/services/listeningHistory';
import { cacheFreeTrack, getCachedFreeTrackUrl, touchAlbumAccess } from '@/services/downloadManager';
import { isPreorder } from '@/utils/preorder';

export type PlayMode = 'hls' | 'stream' | 'local' | 'remote' | 'device';
export type QueueMode = 'sequential' | 'shuffle';
export type RepeatMode = 'off' | 'one' | 'all';
export type QueueScope = 'album' | 'trackList';

export interface TrackListPlayItem {
  id: string;
  album_id: string;
}

export interface SavedAudioSession {
  albumId: string;
  currentIndex: number;
  currentTime: number;
  duration: number;
  timestamp: number;
  queueScope: QueueScope;
}

export interface AudioPlaybackState {
  queueScope: QueueScope;
  album: PublicAlbumDetails | null;
  autoplayEnabled: boolean;
  isAutoplaying: boolean;
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
  setAutoplayEnabled: (v: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  isMuted: boolean;
}

interface AudioPlaybackContextValue extends AudioPlaybackState, AudioActions {}

const DEFAULT_VOLUME = (() => {
  try {
    const saved = localStorage.getItem('passio_volume');
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
    }
  } catch { /* ignore */ }
  return 1;
})();

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
  const volumeRef = useRef(DEFAULT_VOLUME);

  // Garder le ref synchronisé avec l'état du volume
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // Persister le volume dans localStorage à chaque changement
  useEffect(() => {
    try { localStorage.setItem('passio_volume', String(volume)); }
    catch { /* QuotaExceededError — ignore */ }
  }, [volume]);

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
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const progressThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgressRef = useRef(0);
  const lastDurationRef = useRef(0);
  const prefetchTriggeredRef = useRef(false);

  const sequentialBackupRef = useRef<{
    tracks: PublicTrack[];
    albums: PublicAlbumDetails[];
    keys: (string | null)[];
  } | null>(null);
  const deviceBackupRef = useRef<DeviceTrack[] | null>(null);
  const autoplayEnabledRef = useRef(true);
  const recentlyPlayedRef = useRef<Set<string>>(new Set());
  const isAutoplayingRef = useRef(false);
  const previousTrackTitleRef = useRef<string | null>(null);
  const [autoplayEnabled, setAutoplayEnabledState] = useState(true);
  const [isAutoplaying, setIsAutoplaying] = useState(false);

  // 🎯 Algorithme Radio : générer des recommandations quand la file est terminée
  async function handleAutoplay() {
    if (isDevicePlaybackRef.current) return; // Pas d'autoplay en mode device
    if (!autoplayEnabledRef.current) return; // Désactivé par l'utilisateur

    const currentAlb = albumRef.current;
    const finishedTrackIds = recentlyPlayedRef.current;
    if (!currentAlb) return;

    try {
      const allAlbums = await listAlbums();

      // 🎯 Priorité 1 : Même artiste — autres albums du même artiste
      //    Priorité 2 : Même type/style — albums de même type (single/album/ep) et même gratuité
      const sameArtistAlbums: PublicAlbumSummary[] = [];
      const sameTypeAlbums: PublicAlbumSummary[] = [];

      for (const a of allAlbums) {
        if (a.id === currentAlb.id) continue; // Exclure l'album courant
        const aArtistId = a.artist_id || a.artist?.id || '';
        const curArtistId = currentAlb.artist_id || currentAlb.artist?.id || '';
        const sameArtist = aArtistId && curArtistId && aArtistId === curArtistId;
        if (sameArtist) {
          sameArtistAlbums.push(a);
        } else if (a.is_free === currentAlb.is_free && a.type === currentAlb.type) {
          sameTypeAlbums.push(a);
        }
      }

      // Mélanger et prendre max 15 albums candidats
      const candidateAlbums = [...sameArtistAlbums, ...sameTypeAlbums];
      for (let i = candidateAlbums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidateAlbums[i], candidateAlbums[j]] = [candidateAlbums[j], candidateAlbums[i]];
      }
      const topCandidates = candidateAlbums.slice(0, 15);

      // Charger les détails des albums candidats en parallèle (Promise.all) pour minimiser le blanc
      const recommended: { track: PublicTrack; album: PublicAlbumDetails }[] = [];
      const detailsList = await Promise.all(
        topCandidates.map((c) => getAlbum(c.id).catch(() => null)),
      );
      for (const details of detailsList) {
        if (!details) continue;
        const sorted = sortTracksByPosition(details.tracks || []);
        for (const track of sorted) {
          if (!finishedTrackIds.has(track.id)) {
            recommended.push({ track, album: details });
          }
        }
      }

      // Mélanger les recommandations pour un effet radio
      for (let i = recommended.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [recommended[i], recommended[j]] = [recommended[j], recommended[i]];
      }

      const autoTracks = recommended.slice(0, 20);
      if (autoTracks.length === 0) return;

      const newTracks = autoTracks.map((t) => t.track);
      const newAlbums = autoTracks.map((t) => t.album);

      // 🎯 Marquer qu'on est en mode autoplay (pour l'affichage UI)
      isAutoplayingRef.current = true;
      setIsAutoplaying(true);
      setQueueMode('sequential');
      queueModeRef.current = 'sequential';
      setQueueScope('trackList');
      queueScopeRef.current = 'trackList';

      queueRef.current = [...newTracks];
      setQueue([...newTracks]);
      setParallelQueue(newAlbums, []);

      logger.info('[Autoplay] 🎵 Mode Radio activé —', newTracks.length, 'recommandations injectées');
      await playAtIndexRef.current(0);
    } catch (err) {
      logger.warn('[Autoplay] ❌ Erreur lors de la génération des recommandations:', err);
    }
  }

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
        const isFreeAlbum = Boolean(albumRef.current?.is_free);
        if (!isFreeAlbum) {
          const nextUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(nextTrack.id)}/audio`;
          prefetchSecureTrack(nextUrl, nextTrack.id);
        } else {
          // Pour les pistes gratuites : préchargement simple via le navigateur
          let directUrl = getCloudflareAudioUrl(nextTrack.audio_storage_key || '');
          if (!directUrl) directUrl = (nextTrack.encrypted_audio_url || nextTrack.preview_url) ?? null;
          if (directUrl) {
            // Juste une requête HEAD pour mettre en cache
            fetch(directUrl, { method: 'HEAD' }).catch(() => {});
          }
        }
      }
    }
  }

  const currentTrack = useMemo(
    () => currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] ?? null : null,
    [currentIndex, queue],
  );

  const deviceCurrentTrack = useMemo(
    () => deviceCurrentIndex >= 0 && deviceCurrentIndex < deviceQueue.length
      ? deviceQueue[deviceCurrentIndex] ?? null
      : null,
    [deviceCurrentIndex, deviceQueue],
  );

  // 🎵 Mettre à jour le titre de l'onglet avec la musique en cours de lecture
  useEffect(() => {
    const track = currentTrack;
    const label = track?.title || 'Piste inconnue';
    const artist = album?.artist_name || album?.artist?.name || '';
    const fullLabel = artist ? `${label} — ${artist}` : label;

    if (track && isPlaying) {
      document.title = `🎵 ${fullLabel} | Pass'io Web`;
      previousTrackTitleRef.current = fullLabel;
    } else if (track && !isPlaying && previousTrackTitleRef.current === fullLabel) {
      document.title = `⏸ ${fullLabel} | Pass'io Web`;
    } else if (!track) {
      document.title = "Pass'io Web";
      previousTrackTitleRef.current = null;
    }
  }, [currentTrack, isPlaying, album]);

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

      // Sauvegarde de la session pour la reprise après rafraîchissement
      const currentSeconds = lastProgressRef.current * lastDurationRef.current;
      if (albumRef.current?.id && currentIndexRef.current >= 0 && currentSeconds > 0) {
         localStorage.setItem('passio_audio_session', JSON.stringify({
           albumId: albumRef.current.id,
           currentIndex: currentIndexRef.current,
           currentTime: currentSeconds,
           duration: lastDurationRef.current,
           timestamp: Date.now(),
           queueScope: queueScopeRef.current,
         }));
      }
    }, PROGRESS_THROTTLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (progressThrottleRef.current) clearTimeout(progressThrottleRef.current);
    };
  }, []);

  useEffect(() => {
    const savedSessionStr = localStorage.getItem('passio_audio_session');
    if (savedSessionStr) {
      try {
        const session: SavedAudioSession = JSON.parse(savedSessionStr);
        // Expiration après 5 minutes (300000 ms)
        if (Date.now() - session.timestamp < 5 * 60 * 1000) {
          getAlbum(session.albumId).then((albumResp) => {
            const albumData = unwrapAlbumDetails(albumResp);
            const sorted = sortTracksByPosition(albumData.tracks || []);
            
            queueScopeRef.current = session.queueScope;
            setQueueScope(session.queueScope);
            
            albumRef.current = albumData;
            setAlbum(albumData);
            
            queueRef.current = sorted;
            setQueue(sorted);
            
            currentIndexRef.current = session.currentIndex;
            setCurrentIndex(session.currentIndex);
            
            pendingSeekSecondsRef.current = session.currentTime;
            
            if (session.duration > 0) {
              lastProgressRef.current = session.currentTime / session.duration;
              lastDurationRef.current = session.duration;
              setProgress(lastProgressRef.current);
              setDuration(session.duration);
            }
            
            // Auto-play de la session restaurée
            resumePlayback();
          }).catch(err => {
             logger.warn('Failed to restore audio session', err);
             localStorage.removeItem('passio_audio_session');
          });
        } else {
          localStorage.removeItem('passio_audio_session');
        }
      } catch (e) {
        localStorage.removeItem('passio_audio_session');
      }
    }
  }, []);

  // Initialize device ID for secure players
  useEffect(() => {
    (async () => {
      const deviceId = await getOrCreateDeviceId();
      secureAudioPlayer.setDeviceId(deviceId);
      mseSecurePlayer.setDeviceId(deviceId);
    })();
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
    // Skip key resolution entirely for FREE albums
    if (Boolean(albumData.is_free)) {
      logger.info('[ResolveKey] Album FREE, skip key checks');
      return null;
    }
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
    let effectiveKey = key;
    let ownedPaid = false;
    if (!isFreeRelease) {
      effectiveKey = await resolveKeyForAlbum(albumData, key);
      ownedPaid = libraryRef.current.some((entry) => entry.id === albumData.id) || await isAlbumOwnedByDevice(albumData.id);
    }

    // 🎯 Pour les pistes gratuites : utiliser d'abord les URL directes (Cloudflare) pour éviter les problèmes de décodage
    if (isFreeRelease) {
      if (track.encrypted_audio_url || track.preview_url || track.stream_url) {
        return 'stream';
      }
    }

    // 🔒 PROTECTION IDM pour les pistes payantes : forcer le mode remote pour passer par le proxy
    if (track.id && (track.audio_storage_key || track.encrypted_audio_url || track.preview_url)) {
      return 'remote';
    }

    // 🚀 HLS stream (Albums prêts)
    if (isFreeRelease && albumData.stream_status === 'ready' && albumData.stream_url) {
      return 'hls';
    }

    // Fallback URL externes (ex: stream_url vers soundcloud, radio...)
    if (track.stream_url) return 'stream';

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

    // 🎯 Synchroniser les tableaux parallèles (albums + keys) avec le nouvel ordre mélangé
    const parallel = queueParallelRef.current;
    if (parallel && parallel.albums.length === q.length) {
      const tailAlbums = parallel.albums.slice(headEnd);
      const tailKeys = parallel.keys.slice(headEnd);
      const shuffledAlbums = order.map((i) => tailAlbums[i]!);
      const shuffledKeys = order.map((i) => tailKeys[i]!);
      queueParallelRef.current = {
        albums: [...parallel.albums.slice(0, headEnd), ...shuffledAlbums],
        keys: [...parallel.keys.slice(0, headEnd), ...shuffledKeys],
      };
      setQueueAlbums([...queueParallelRef.current.albums]);
    }
  }

  function shuffleRemainingDeviceQueue() {
    const currentIdx = deviceCurrentIndexRef.current;
    const q = deviceQueueRef.current;
    if (currentIdx < 0 || currentIdx >= q.length - 1) return;

    const headEnd = currentIdx + 1;
    const tailTracks = q.slice(headEnd);
    if (tailTracks.length < 2) return;

    const order = shuffleIndexOrder(tailTracks.length);
    const shuffledTail = order.map((i) => tailTracks[i]!);
    deviceQueueRef.current = [...q.slice(0, headEnd), ...shuffledTail];
    setDeviceQueue([...deviceQueueRef.current]);
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
      // 🎯 Autoplay : lancer les recommandations avant d'arrêter
      isAutoplayingRef.current = false;
      await handleAutoplay();
      if (isAutoplayingRef.current) return; // handleAutoplay a lancé une nouvelle piste
      setIsPlaying(false);
      setProgress(0);
      isPlayingRef.current = false;
      // Nettoyer la session de reprise quand la lecture se termine complètement
      localStorage.removeItem('passio_audio_session');
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
  ) {    logger.info('[AudioContext] 🎵 Démarrage playback:', track.title);
    
    if (!track || !albumData) {
      logger.error('[AudioContext] ❌ Track ou album manquant');
      reportPlaybackError('AudioContext.playback', new Error('Track ou album manquant'));
      return;
    }

    // 🚫 Bloquer la lecture des albums en précommande (publication_date dans le futur)
    if (isPreorder(albumData.publication_date)) {
      const pubDate = new Date(albumData.publication_date!);
      const formattedDate = pubDate.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const msg = `Cet album sera disponible à l'écoute le ${formattedDate}.`;
      logger.warn('[AudioContext] 🚫 Lecture bloquée — album en précommande:', albumData.title);
      reportPlaybackError('AudioContext.playback', new Error(msg));
      setIsLoading(false);
      return;
    }

    // Initialiser l'état
    if (!isRetry) setPlaybackError(null);
    setIsLoading(true);
    setIsPlaying(false);

    try {
      await stopCurrentTrack();
      await ensureStreamDeviceId();

      const handleStatus = (status: any) => {
        const currentTime = status.currentTime ?? 0;
        const dur = status.duration ?? 0;
        if (dur > 0) updateProgressThrottled(currentTime, dur);
        if (status.playing !== undefined) {
          setIsPlaying(Boolean(status.playing));
          isPlayingRef.current = Boolean(status.playing);
        }
      };

      const isFreeAlbum = Boolean(albumData.is_free);      // First, try direct Cloudflare URLs if track is free!
      if (isFreeAlbum) {
        // ⚡ Vérifier le cache IndexedDB avant de streamer
        const cachedUrl = await getCachedFreeTrackUrl(track.id);
        if (cachedUrl) {
          try {
            const audio = await playStream(cachedUrl, handleStatus, true);
            if (audio) {
              currentIndexRef.current = index;
              setCurrentIndex(index);
              setAudioVolume(volumeRef.current);
              if (isMuted) setAudioMuted(true);
              logger.info('[AudioContext] ⚡ Lecture depuis le cache IndexedDB:', track.title);
              return;
            }
          } catch {
            logger.warn('[AudioContext] Cache URL invalide, fallback réseau');
          }
        }

        const directUrls: string[] = [];
        const cfUrl = getCloudflareAudioUrl(track.audio_storage_key || '');
        if (cfUrl) directUrls.push(cfUrl);
        if (track.encrypted_audio_url) directUrls.push(track.encrypted_audio_url);
        if (track.preview_url && track.preview_url !== track.encrypted_audio_url) directUrls.push(track.preview_url);
        
        for (const directUrl of directUrls) {
          try {
            const audio = await playStream(directUrl, handleStatus, true);
            if (audio) {
              currentIndexRef.current = index;
              setCurrentIndex(index);
              // 🎯 Synchroniser le volume après la création du nouvel élément audio direct
              setAudioVolume(volumeRef.current);
              if (isMuted) setAudioMuted(true);
              // ⚡ Mettre en cache la piste gratuite en arrière-plan (pas de await)
              cacheFreeTrack(track.id, directUrl);
              return;
            }
          } catch (err) {
            logger.warn('[AudioContext] ❌ Failed with direct URL:', err);
          }
        }
      }
      
      // Fallback to backend proxy
      const url = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(track.id)}/audio`;
      
      // Fetch the audio token and set it on the secure players
      await secureAudioPlayer.fetchToken(track.id);
      mseSecurePlayer.currentToken = secureAudioPlayer.currentToken;
      mseSecurePlayer.currentTrackId = track.id;
      
      // Try web optimized track
      const success = await playWebOptimizedTrack(
        track.id,
        track.preview_url,
        url,
        isFreeAlbum,
        handleStatus,
        true
      );
      
      if (success) {
        currentIndexRef.current = index;
        setCurrentIndex(index);
        // 🎯 Synchroniser le volume après la création du nouvel élément audio
        setAudioVolume(volumeRef.current);
        if (isMuted) setAudioMuted(true);
        return;
      }
      
      throw new Error('All playback methods failed');

    } catch (err) {
      logger.error('[AudioContext] ❌ Échec playback:', err);
      reportPlaybackError('AudioContext.playback', err);
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
    let alb = albumRef.current;
    if (index < 0 || index >= q.length || !alb) return;

    // 🚀 En mode trackList (titres gratuits de plusieurs albums différents),
    //    mettre à jour l'album et la clé de déchiffrement pour la piste courante
    if (queueScopeRef.current === 'trackList' && queueParallelRef.current) {
      const parallelAlbums = queueParallelRef.current.albums;
      const parallelKeys = queueParallelRef.current.keys;
      if (index < parallelAlbums.length && parallelAlbums[index]) {
        const correctAlbum = parallelAlbums[index];
        if (correctAlbum && correctAlbum.id !== albumRef.current?.id) {
          albumRef.current = correctAlbum;
          setAlbum(correctAlbum);
          alb = correctAlbum;
          // Mettre à jour la clé pour le bon album
          const correctKey = parallelKeys[index] ?? null;
          if (correctKey !== decryptionKeyRef.current) {
            decryptionKeyRef.current = correctKey;
            setDecryptionKey(correctKey);
          }
        }
      }
    }

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
    pendingSeekSecondsRef.current = null;
    isDevicePlaybackRef.current = false;

    let key = decryptionKeyRef.current;
    if (!key && !Boolean(alb.is_free)) {
      key = await resolveKeyForAlbum(alb, null);
    }
    if (key) {
      decryptionKeyRef.current = key;
      setDecryptionKey(key);
    }
    // 🎯 Tracker les pistes jouées pour l'autoplay (ne pas répéter)
    recentlyPlayedRef.current.add(q[index].id);
    // Limiter à 50 entrées pour éviter la dérive mémoire
    if (recentlyPlayedRef.current.size > 50) {
      const entries = Array.from(recentlyPlayedRef.current);
      recentlyPlayedRef.current = new Set(entries.slice(entries.length - 50));
    }
    // 🎯 Enregistrer l'artiste dans l'historique d'écoute pour les recommandations
    const currentAlb = albumRef.current;
    if (currentAlb?.artist_id) {
      const artistName = currentAlb.artist_name || currentAlb.artist?.name || 'Artiste';
      recordArtistPlay(currentAlb.artist_id, artistName);
    }
    // 🎯 Enregistrer l'accès à l'album pour le LRU cache
    if (currentAlb?.id) {
      touchAlbumAccess(currentAlb.id);
    }

    await startPlayback(q[index], index, alb, key);
  }, []);

  playAtIndexRef.current = playAtIndex;

  const loadAlbum = useCallback((albumData: PublicAlbumDetails, key?: string | null) => {
    const sorted = sortTracksByPosition(albumData.tracks || []);
    // Réinitialiser le tracking autoplay quand l'utilisateur choisit un nouvel album
    recentlyPlayedRef.current = new Set();
    isAutoplayingRef.current = false;
    setIsAutoplaying(false);
    sequentialBackupRef.current = null;
    queueScopeRef.current = 'album';
    setQueueScope('album');
    clearParallelQueue();

    albumRef.current = albumData;
    queueRef.current = sorted;
    decryptionKeyRef.current = key ?? null;

    // Solution C: Précharger la première piste dès le chargement de l'album
    if (sorted.length > 0) {
      const firstTrack = sorted[0];
      const isFreeAlbum = Boolean(albumData.is_free);
      
      if (!isFreeAlbum) {
        const firstUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(firstTrack.id)}/audio`;
        prefetchSecureTrack(firstUrl, firstTrack.id);
      } else {
        let directUrl = getCloudflareAudioUrl(firstTrack.audio_storage_key || '');
        if (!directUrl) directUrl = (firstTrack.encrypted_audio_url || firstTrack.preview_url) ?? null;
        if (directUrl) {
          fetch(directUrl, { method: 'HEAD' }).catch(() => {});
        }
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

    // Réinitialiser le tracking autoplay quand l'utilisateur lance une nouvelle liste
    recentlyPlayedRef.current = new Set();
    isAutoplayingRef.current = false;
    setIsAutoplaying(false);
    sequentialBackupRef.current = null;
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

  const resumePlayback = useCallback(async () => {
    if (currentIndexRef.current >= 0 && albumRef.current && queueRef.current.length > 0) {
      const q = queueRef.current;
      const index = currentIndexRef.current;
      const track = q[index];
      const alb = albumRef.current;
      
      // Vérifier que la piste existe bien avant de démarrer la lecture
      if (!track) {
        logger.warn('[AudioContext] resumePlayback: track not found at index', index);
        return;
      }
      
      let key = decryptionKeyRef.current;
      if (!key) key = await resolveKeyForAlbum(alb, null);
      if (key) {
        decryptionKeyRef.current = key;
        setDecryptionKey(key);
      }
      const seekTime = pendingSeekSecondsRef.current;
      const p = startPlayback(track, index, alb, key);
      pendingSeekSecondsRef.current = seekTime;
      await p;
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    if (pendingSeekSecondsRef.current !== null && currentIndexRef.current >= 0 && albumRef.current) {
      resumePlayback();
      return;
    }
    toggleAudioPlayPause().then((newState) => {
      setIsPlaying(newState);
      isPlayingRef.current = newState;
    }).catch(() => {
      // ignore
    });
  }, [resumePlayback]);

  const next = useCallback(async () => {
    const q = queueRef.current;
    const len = q.length;
    if (len === 0) return;
    let nextIdx = currentIndexRef.current + 1;
    if (nextIdx >= len) {
      if (repeatModeRef.current === 'all') nextIdx = 0;
      else {
        // 🎯 Déclencher l'autoplay si on est sur la dernière piste
        if (!isDevicePlaybackRef.current && autoplayEnabledRef.current) {
          isAutoplayingRef.current = false;
          await handleAutoplay();
          if (isAutoplayingRef.current) return;
        }
        return;
      }
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
    if (newMode === 'shuffle') {
      // ── Mode device : sauvegarder + mélanger la queue device ──
      if (isDevicePlaybackRef.current) {
        if (deviceQueueRef.current.length > 1) {
          deviceBackupRef.current = [...deviceQueueRef.current];
          shuffleRemainingDeviceQueue();
        }
        return;
      }
      // ── Mode online : sauvegarder + mélanger la queue online ──
      if (queueScopeRef.current === 'trackList' && queueParallelRef.current) {
        sequentialBackupRef.current = {
          tracks: [...queueRef.current],
          albums: [...queueParallelRef.current.albums],
          keys: [...queueParallelRef.current.keys],
        };
      }
      shuffleRemainingQueue();
    } else if (newMode === 'sequential') {
      // ── Mode device : restaurer la queue device ──
      if (isDevicePlaybackRef.current) {
        const backup = deviceBackupRef.current;
        if (backup) {
          const currentTrackId = deviceQueueRef.current[deviceCurrentIndexRef.current]?.id;
          deviceQueueRef.current = backup;
          setDeviceQueue([...backup]);
          if (currentTrackId) {
            const newIdx = backup.findIndex((t) => t.id === currentTrackId);
            if (newIdx >= 0) {
              deviceCurrentIndexRef.current = newIdx;
              setDeviceCurrentIndex(newIdx);
            }
          }
          deviceBackupRef.current = null;
        }
        return;
      }
      // ── Mode online : restaurer la queue online ──
      const backup = sequentialBackupRef.current;
      if (backup) {
        const currentTrackId = queueRef.current[currentIndexRef.current]?.id;
        queueRef.current = backup.tracks;
        setQueue([...backup.tracks]);
        queueParallelRef.current = {
          albums: backup.albums,
          keys: backup.keys,
        };
        setQueueAlbums([...backup.albums]);
        if (currentTrackId) {
          const newIdx = backup.tracks.findIndex((t) => t.id === currentTrackId);
          if (newIdx >= 0) {
            currentIndexRef.current = newIdx;
            setCurrentIndex(newIdx);
          }
        }
        sequentialBackupRef.current = null;
      } else if (queueScopeRef.current === 'album' && albumRef.current) {
        // Fallback album scope : re-lire depuis les données de l'album
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
    volumeRef.current = clamped;
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
      setAudioMuted(false);
    }
  }, [isMuted]);

  const setAutoplayEnabled = useCallback((v: boolean) => {
    autoplayEnabledRef.current = v;
    setAutoplayEnabledState(v);
    if (!v) { isAutoplayingRef.current = false; setIsAutoplaying(false); }
  }, []);

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
    // 🎯 Si le shuffle est déjà actif, sauvegarder et mélanger les nouvelles tracks immédiatement
    if (queueModeRef.current === 'shuffle' && tracks.length > 1) {
      deviceBackupRef.current = [...tracks];
      deviceCurrentIndexRef.current = safeIndex;
      shuffleRemainingDeviceQueue();
    }
    const track = tracks[safeIndex];
    if (!track) return;
    await playDeviceFile(track.uri, (status) => {
      const currentTime = status.currentTime ?? 0;
      const dur = status.duration ?? 0;
      if (dur > 0) updateProgressThrottled(currentTime, dur);
      if (status.playing !== undefined) { setIsPlaying(Boolean(status.playing)); isPlayingRef.current = Boolean(status.playing); }
    });
    // 🎯 Synchroniser le volume après la création de l'élément audio du device
    setAudioVolume(volumeRef.current);
    if (isMuted) setAudioMuted(true);
    setDeviceCurrentIndex(safeIndex);
    deviceCurrentIndexRef.current = safeIndex;
  }, [updateProgressThrottled]);

  const playbackValue = useMemo<AudioPlaybackContextValue>(() => ({
    album, queue, currentIndex, currentTrack, isPlaying, isLoading, playMode,
    decryptionKey, isFullPlayerVisible, queueMode, repeatMode, library, libraryIndex,
    isLibraryLoaded, queueScope, deviceQueue, deviceCurrentIndex, deviceCurrentTrack,
    queueAlbums, playbackError, lyricsAutoOpen, isAutoplaying,
    loadAlbum, playFromTrackList, playTrackAtIndex, togglePlayPause, next, previous, stop,
    setFullPlayerVisible, setLyricsAutoOpen, toggleQueueMode, toggleRepeat, loadLibrary, seekTo,
    playDeviceTrackAtIndex, clearPlaybackError,
    volume, setVolume, toggleMute, isMuted, autoplayEnabled, setAutoplayEnabled,
  }), [album, queue, currentIndex, currentTrack, isPlaying, isLoading, playMode,
    decryptionKey, isFullPlayerVisible, queueMode, repeatMode, library, libraryIndex,
    isLibraryLoaded, queueScope, deviceQueue, deviceCurrentIndex, deviceCurrentTrack,
    queueAlbums, playbackError, lyricsAutoOpen, loadAlbum, playFromTrackList, playTrackAtIndex,
    togglePlayPause, next, previous, stop, setFullPlayerVisible, setLyricsAutoOpen,
    toggleQueueMode, toggleRepeat, loadLibrary,
    seekTo, playDeviceTrackAtIndex, clearPlaybackError,
    volume, setVolume, toggleMute, isMuted, autoplayEnabled, setAutoplayEnabled, isAutoplaying]);

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
