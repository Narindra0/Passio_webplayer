import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useSwipeDown } from '@/hooks/useSwipeDown';
import { buildVibrantWithAlpha } from '@/services/colorExtractor';
import type { PublicAlbumDetails } from '@/types/backend';
import {
    ChevronDown,
    Infinity,
    List,
    Pause,
    Play,
    Radio,
    Repeat, Repeat1,
    Shuffle, SkipBack, SkipForward,
    Share2, TextQuote, Volume2, Volume1, Volume, VolumeX, X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FullPlayerLyrics } from './FullPlayerLyrics';
import { PlayerWaveform } from './PlayerWaveform';
import { ShareCard } from './ShareCard';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';
import { FeatArtistLinks } from './FeatArtistLinks';
import { formatTitle } from '@/utils/formatTitle';
import { listAlbums } from '@/services/api';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { logger } from '@/utils/logger';

function formatAlbumArtist(albumData: PublicAlbumDetails | null | undefined): string {
  if (!albumData) return 'Artiste inconnu';
  if (albumData.artists?.length) return albumData.artists.map((a) => a.name).join(', ');
  return albumData.artist_name ?? albumData.artist?.name ?? 'Artiste inconnu';
}

export function FullPlayer() {
  const navigate = useNavigate();
  const { effectiveMode } = useLibraryMode();
  const {
    album, currentTrack, deviceCurrentTrack, playMode,
    isPlaying, isLoading, togglePlayPause, next, previous,
    isFullPlayerVisible, setFullPlayerVisible,
    currentIndex, queue, seekTo, queueMode, toggleQueueMode,
    repeatMode, toggleRepeat, playTrackAtIndex,
    deviceQueue, deviceCurrentIndex, playDeviceTrackAtIndex, queueAlbums,
    volume, setVolume, toggleMute, isMuted,
    lyricsAutoOpen, setLyricsAutoOpen,
    isAutoplaying,
  } = useAudioPlayback();
  const { progress, duration } = useAudioProgress();
  const [lyricsModalVisible, setLyricsModalVisible] = useState(false);
  const [lyricsViewActive, setLyricsViewActive] = useState(false);
  const [queueModalVisible, setQueueModalVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isEntered, setIsEntered] = useState(false);
  const queueRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // État pour stocker le dictionnaire enrichi nom→ID depuis TOUS les albums (API)
  const [globalArtistIdMap, setGlobalArtistIdMap] = useState<Record<string, string> | null>(null);

  // Variables dérivées — remontées avant les effets pour éviter les TDZ
  const isDeviceMode = playMode === 'device' && deviceCurrentTrack;
  const showLyricsControls = !isDeviceMode && Boolean(currentTrack?.lyrics_url || currentTrack?.has_lyrics);
  const isMobile = useMediaQuery('(max-width: 768px)');

  // ── Clean exit animation ──
  const handleClose = useCallback(() => {
    // Don't double-close
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setFullPlayerVisible(false);
      setIsClosing(false);
      setIsEntered(false);
    }, 320);
  }, [isClosing, setFullPlayerVisible]);

  // ── Swipe down gesture (mobile only) ──
  const {
    dragOffset,
    isDragging,
    handlers: swipeHandlers,
  } = useSwipeDown({
    threshold: 100,
    onDismiss: handleClose,
    enabled: isMobile && isFullPlayerVisible && !queueModalVisible && !lyricsModalVisible,
    resistance: 0.55,
  });

  // Cancel close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lyricsModalVisible) setLyricsModalVisible(false);
        else if (lyricsViewActive) setLyricsViewActive(false);
        else if (queueModalVisible) setQueueModalVisible(false);
        else handleClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lyricsModalVisible, lyricsViewActive, queueModalVisible, handleClose]);

  // ── Mark entered after mount animation ──
  useEffect(() => {
    if (isFullPlayerVisible && !isClosing) {
      // Small delay to ensure the DOM has mounted before we add the entering class
      const t = setTimeout(() => setIsEntered(true), 10);
      return () => clearTimeout(t);
    }
  }, [isFullPlayerVisible, isClosing]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setLyricsModalVisible(false);
    setLyricsViewActive(false);
  }, [currentTrack?.id, deviceCurrentTrack?.id]);

  // Auto-open lyrics when requested from BottomPlayer (desktop=inline, mobile=modal)
  useEffect(() => {
    if (lyricsAutoOpen && showLyricsControls) {
      if (isMobile) {
        setLyricsModalVisible(true);
      } else {
        setLyricsViewActive(true);
      }
      setLyricsAutoOpen(false);
    }
  }, [lyricsAutoOpen, showLyricsControls, isMobile, setLyricsAutoOpen]);

  // Charger TOUS les albums pour construire un dictionnaire nom→ID
  useEffect(() => {
    let cancelled = false;
    async function loadAllAlbums() {
      try {
        const albums = await listAlbums();
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const a of albums) {
          const name = a.artist_name || a.artist?.name;
          const id = a.artist_id || a.artist?.id;
          if (name && id) {
            map[normalizeArtistName(name)] = id;
          }
          if (a.artists) {
            for (const art of a.artists) {
              if (art.id && art.name) {
                map[normalizeArtistName(art.name)] = art.id;
              }
            }
          }
        }
        logger.info('[FullPlayer] Global artist map:', Object.keys(map).length, 'artists.');
        if (!cancelled) setGlobalArtistIdMap(map);
      } catch (err) {
        logger.warn('[FullPlayer] listAlbums failed:', err);
      }
    }
    void loadAllAlbums();
    return () => { cancelled = true; };
  }, []);

  // Early returns — must come after all hooks
  // On desktop: normal render logic
  // On mobile: if we're in the process of closing, keep rendering for the exit animation
  if (!isMobile) {
    if (!isDeviceMode && (!album || !currentTrack)) return null;
    if (isDeviceMode && !deviceCurrentTrack) return null;
    if (!isFullPlayerVisible) return null;
  } else {
    // Mobile: during the closing animation, we keep rendering with data from last known state
    // If fully closed (not closing and not visible), return null
    if (!isClosing && !isFullPlayerVisible) return null;
    // If no track data at all, nothing to show
    if (!isDeviceMode && !album && !currentTrack) return null;
    if (isDeviceMode && !deviceCurrentTrack) return null;
  }

  const hasNext = isDeviceMode
    ? deviceCurrentIndex < deviceQueue.length - 1 || repeatMode === 'all'
    : currentIndex < queue.length - 1 || repeatMode === 'all';
  const hasPrev = isDeviceMode
    ? deviceCurrentIndex > 0 || repeatMode === 'all'
    : currentIndex > 0 || repeatMode === 'all';
  const rawTitle = isDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title;
  const { cleanTitle: trackTitle, featNames } = hasFeatArtists(rawTitle)
    ? parseFeatArtists(rawTitle)
    : { cleanTitle: rawTitle, featNames: [] };
  const artistName = isDeviceMode
    ? deviceCurrentTrack!.artist
    : (album!.artist_name ?? album!.artist?.name ?? 'Artiste');
  const coverUri = isDeviceMode ? deviceCurrentTrack!.artworkUri : album!.cover_url;

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const currentTimeLabel = formatTime(progress * duration);
  const totalTimeLabel = formatTime(duration);
  const repeatIcon = repeatMode === 'off' ? Repeat : repeatMode === 'one' ? Repeat1 : Infinity;
  const repeatColor = repeatMode === 'off' ? 'var(--color-text-muted)' : 'var(--color-accent)';
  const shuffleColor = queueMode === 'shuffle' ? 'var(--color-accent)' : 'var(--color-text-muted)';
  const trackKey = isDeviceMode ? deviceCurrentTrack!.id : currentTrack!.id;

  const localArtistIdMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (album) {
      const name = album.artist_name || album.artist?.name;
      const id = album.artist_id || album.artist?.id;
      if (name && id) {
        map[normalizeArtistName(name)] = id;
      }
      if (album.artists) {
        for (const a of album.artists) {
          if (a.name && a.id) {
            map[normalizeArtistName(a.name)] = a.id;
          }
        }
      }
    }
    if (globalArtistIdMap) {
      for (const [name, id] of Object.entries(globalArtistIdMap)) {
        if (!map[name]) {
          map[name] = id;
        }
      }
    }
    return map;
  }, [album, globalArtistIdMap]);

  const knownFeatArtists = useMemo(() => {
    return featNames
      .map((n: string) => ({ name: n, artistId: localArtistIdMap[normalizeArtistName(n)] ?? null }))
      .filter((item): item is { name: string; artistId: string } => item.artistId !== null);
  }, [featNames, localArtistIdMap]);

  const allFeatArtists = useMemo(() => {
    return featNames.map((n: string) => ({
      name: n,
      artistId: localArtistIdMap[normalizeArtistName(n)] ?? null,
    }));
  }, [featNames, localArtistIdMap]);

  const coverColors = useAlbumColors(coverUri);
  const cachedCover = useCachedImage(coverUri);
  const cachedArtistPic = useCachedImage(album?.artist?.profile_picture_url || album?.artist_pdp || null);

  const fullQueue = isDeviceMode ? deviceQueue : queue;
  const currentIdx = isDeviceMode ? deviceCurrentIndex : currentIndex;
  const upcomingTracks = currentIdx >= 0 ? fullQueue.slice(currentIdx + 1) : [];

  // ── Dynamic styles ──
  const animatedStyle: React.CSSProperties = isMobile
    ? {
        transform:
          isDragging
            ? `translateY(${dragOffset}px)`
            : isClosing
              ? 'translateY(100%)'
              : isEntered
                ? 'translateY(0)'
                : 'translateY(100%)',
        opacity:
          isDragging
            ? Math.max(0, 1 - dragOffset / (window.innerHeight * 0.6))
            : isClosing
              ? 0
              : 1,
        transition: isDragging
          ? 'none'
          : 'transform 0.35s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.35s ease',
      }
    : {};

  return (
    <aside
      className="fullplayer"
      style={{
        width: isMobile ? '100%' : 380,
        height: isMobile ? '100%' : '100%',
        backgroundColor: 'var(--color-bg-dark)',
        borderLeft: isMobile ? 'none' : '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        position: isMobile ? 'fixed' : 'relative',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: isMobile ? 9999 : undefined,
        ...animatedStyle,
      }}
      {...(isMobile ? swipeHandlers : {})}
    >
      {/* ════════════════════════════════════════════
          MOBILE: FOND UNI AVEC AMBIANCE ROUGE SUBTILE
          ════════════════════════════════════════════ */}
      {isMobile && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '45%',
            background: 'linear-gradient(180deg, rgba(220,20,60,0.07) 0%, transparent 100%)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}

      {/* Desktop background gradient */}
      {!isMobile && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '50%',
            background: coverColors.playerGradient,
            transition: 'background 0.6s ease',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* ════════════════════════════════════════════
          HEADER
          ════════════════════════════════════════════ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '12px 16px 8px' : '16px 20px 12px',
          paddingTop: isMobile ? 'calc(12px + env(safe-area-inset-top, 0px))' : '16px',
          position: 'relative',
          zIndex: 5,
          flexShrink: 0,
        }}
      >
        {/* Mobile: chevron down pour fermer — plus naturel sur mobile */}
        {isMobile ? (
          <button
            onClick={handleClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background: 'rgba(255,255,255,0.08)',
              backdropFilter: 'blur(8px)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.7)',
              transition: 'all 0.2s ease',
            }}
          >
            <ChevronDown size={22} />
          </button>
        ) : (
          <button
            onClick={handleClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-secondary)',
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
          >
            <ChevronDown size={18} />
          </button>
        )}

        {/* Tabs: Now Playing / Lyrics — desktop only */}
        {!isMobile && showLyricsControls ? (
          <div style={{ display: 'flex', gap: 2, background: 'var(--color-surface-elevated)', borderRadius: 'var(--radius-full)', padding: 2 }}>
            <button
              onClick={() => setLyricsViewActive(false)}
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius-full)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                background: !lyricsViewActive ? 'var(--color-text-primary)' : 'transparent',
                color: !lyricsViewActive ? 'var(--color-bg-dark)' : 'var(--color-text-muted)',
                transition: 'all var(--transition-fast) ease',
              }}
            >
              En cours
            </button>
            <button
              onClick={() => setLyricsViewActive(true)}
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius-full)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                background: lyricsViewActive ? 'var(--color-text-primary)' : 'transparent',
                color: lyricsViewActive ? 'var(--color-bg-dark)' : 'var(--color-text-muted)',
                transition: 'all var(--transition-fast) ease',
              }}
            >
              Paroles
            </button>
          </div>
        ) : !isMobile && (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
            {lyricsViewActive ? 'Paroles' : 'En cours'}
          </span>
        )}

        {/* Spacer for mobile (title is centered) */}
        {isMobile && <div style={{ width: 36 }} />}

        {/* Share + Queue buttons — desktop only */}
        {!isMobile && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setShareModalVisible(true); }}
              style={{
                width: 32, height: 32,
                borderRadius: 'var(--radius-full)', border: 'none',
                background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-text-secondary)',
                transition: 'all var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="Partager"
            >
              <Share2 size={18} />
            </button>
            <button
              onClick={() => setQueueModalVisible(true)}
              style={{
                width: 32, height: 32,
                borderRadius: 'var(--radius-full)', border: 'none',
                background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-text-secondary)',
                transition: 'all var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
            >
              <List size={18} />
            </button>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════
          CONTENT (scrollable)
          ════════════════════════════════════════════ */}
      <div
        className="fullplayer-content"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: isMobile ? '0 20px 28px' : '0 24px 28px',
          position: 'relative',
          zIndex: 5,
        }}
      >
        {/* Lyrics inline view — desktop */}
        {!isMobile && lyricsViewActive && showLyricsControls ? (
          <FullPlayerLyrics
            lyricsUrl={currentTrack?.lyrics_url || null}
            trackId={currentTrack?.id || null}
            currentTime={progress * duration}
            isPlaying={isPlaying}
            compact={false}
          />
        ) : (
        <>
        {/* ── Cover art — mobile: full width, desktop: centered ── */}
        <div
          style={{
            width: isMobile ? 'min(85vw, 380px)' : '100%',
            maxWidth: isMobile ? 380 : 320,
            margin: isMobile ? '8px auto 24px' : '0 auto 20px',
            aspectRatio: '1',
            borderRadius: isMobile ? 'var(--radius-md)' : 'var(--radius-sm)',
            overflow: 'hidden',
            backgroundColor: 'var(--color-surface-elevated)',
            boxShadow: isMobile
              ? '0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)'
              : 'var(--shadow-xl)',
            position: 'relative',
          }}
        >
          {coverUri ? (
            <img
              src={cachedCover || coverUri}
              alt=""
              loading="lazy"
              decoding="async"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transition: 'transform 0.4s ease',
              }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 48, color: 'var(--color-text-muted)' }}>♪</span>
            </div>
          )}
        </div>

        {/* ── Track info ── */}
        <div style={{ marginBottom: isMobile ? 20 : 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  color: 'var(--color-text-primary)',
                  fontSize: isMobile ? 22 : 20,
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: '28px',
                }}
                title={rawTitle}
              >
                {formatTitle(trackTitle)}
              </div>
              <div
                style={{
                  color: 'var(--color-text-secondary)',
                  fontSize: isMobile ? 15 : 14,
                  fontWeight: 500,
                  marginTop: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {artistName}
                {featNames.length > 0 && (
                  <FeatArtistLinks featNames={featNames} artistIdMap={localArtistIdMap} />
                )}
              </div>
            </div>
            {showLyricsControls && !isMobile && (
              <button
                onClick={() => {
                  if (isMobile) {
                    setLyricsModalVisible(true);
                  } else {
                    setLyricsViewActive(!lyricsViewActive);
                  }
                }}
                style={{
                  width: 36, height: 36,
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--color-border-subtle)',
                  background: lyricsViewActive && !isMobile ? 'var(--color-accent-soft)' : 'var(--color-surface-elevated)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-accent)',
                  flexShrink: 0, marginTop: 2,
                  transition: 'all var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-soft)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
                onMouseLeave={(e) => {
                  if (!(lyricsViewActive && !isMobile)) {
                    e.currentTarget.style.background = 'var(--color-surface-elevated)';
                  }
                  e.currentTarget.style.borderColor = 'var(--color-border-subtle)';
                }}
                title="Afficher les paroles"
              >
                <TextQuote size={16} />
              </button>
            )}
          </div>
          {/* Mobile lyrics button inline */}
          {isMobile && showLyricsControls && (
            <button
              onClick={() => setLyricsModalVisible(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 10,
                padding: '8px 16px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.7)',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 0.2s ease',
              }}
            >
              <TextQuote size={14} />
              Paroles
            </button>
          )}
        </div>

        {/* ── Waveform / Progress ── */}
        <div style={{ marginBottom: isMobile ? 20 : 16 }}>
          <PlayerWaveform
            progress={progress}
            trackKey={trackKey}
            onSeek={seekTo}
            playedColor={isMobile ? 'var(--color-accent)' : (coverColors.colors?.vibrant || 'var(--color-accent)')}
            unplayedColor="rgba(255,255,255,0.15)"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {currentTimeLabel}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {totalTimeLabel}
            </span>
          </div>
        </div>

        {/* ── Controls ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: isMobile ? 12 : 8,
            marginBottom: isMobile ? 20 : 20,
          }}
        >
          <button
            onClick={toggleQueueMode}
            style={{
              width: isMobile ? 40 : 36,
              height: isMobile ? 40 : 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              borderRadius: 'var(--radius-full)',
              color: shuffleColor,
              transition: 'all var(--transition-fast) ease',
              position: 'relative',
            }}
            onMouseEnter={(e) => { if (queueMode !== 'shuffle') e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { if (queueMode !== 'shuffle') e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <Shuffle size={isMobile ? 18 : 16} />
            {/* 🎯 Indicateur Radio couplé au shuffle : visible quand shuffle ON */}
            {queueMode === 'shuffle' && (
              <span
                style={{
                  position: 'absolute',
                  bottom: isMobile ? 2 : 1,
                  right: isMobile ? 2 : 1,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-accent)',
                  boxShadow: isAutoplaying
                    ? '0 0 6px var(--color-accent), 0 0 12px color-mix(in srgb, var(--color-accent) 40%, transparent)'
                    : `0 0 0 1.5px var(--color-bg-dark)`,
                  animation: isAutoplaying ? 'pulse 1.5s ease infinite' : 'none',
                  transition: 'all 0.3s ease',
                }}
              />
            )}
          </button>

          <button
            onClick={() => hasPrev && void previous()}
            disabled={!hasPrev}
            style={{
              width: isMobile ? 44 : 36,
              height: isMobile ? 44 : 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              cursor: hasPrev ? 'pointer' : 'default',
              borderRadius: 'var(--radius-full)',
              color: 'var(--color-text-primary)',
              opacity: hasPrev ? 1 : 0.3,
              transition: 'all var(--transition-fast) ease',
            }}
          >
            <SkipBack size={isMobile ? 22 : 20} />
          </button>

          <button
            onClick={togglePlayPause}
            style={{
              width: isMobile ? 64 : 52,
              height: isMobile ? 64 : 52,
              borderRadius: 'var(--radius-full)',
              background: coverColors.colors?.vibrant
                ? `linear-gradient(135deg, ${coverColors.colors.vibrant}, ${coverColors.colors.dominant})`
                : 'var(--color-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer',
              transition: 'all var(--transition-fast) ease',
              boxShadow: isPlaying && coverColors.colors?.vibrant
                ? `0 0 24px ${buildVibrantWithAlpha(coverColors.colors, 0.35)}`
                : 'none',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; }}
          >
            {isLoading ? (
              <div className="loader-spinner" style={{ width: 22, height: 22, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
            ) : isPlaying ? (
              <Pause size={isMobile ? 26 : 22} color="#fff" />
            ) : (
              <Play size={isMobile ? 26 : 22} color="#fff" style={{ marginLeft: 3 }} />
            )}
          </button>

          <button
            onClick={() => hasNext && void next()}
            disabled={!hasNext}
            style={{
              width: isMobile ? 44 : 36,
              height: isMobile ? 44 : 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              cursor: hasNext ? 'pointer' : 'default',
              borderRadius: 'var(--radius-full)',
              color: 'var(--color-text-primary)',
              opacity: hasNext ? 1 : 0.3,
              transition: 'all var(--transition-fast) ease',
            }}
          >
            <SkipForward size={isMobile ? 22 : 20} />
          </button>

          <button
            onClick={toggleRepeat}
            style={{
              width: isMobile ? 40 : 36,
              height: isMobile ? 40 : 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              borderRadius: 'var(--radius-full)',
              color: repeatColor,
              transition: 'all var(--transition-fast) ease',
              position: 'relative',
            }}
            onMouseEnter={(e) => { if (repeatMode === 'off') e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { if (repeatMode === 'off') e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            {React.createElement(repeatIcon, { size: isMobile ? 18 : 16 })}
          </button>

        </div>

        {/* ── Volume slider — desktop only ── */}
        {!isMobile && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 16, padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-elevated)',
            }}
          >
            <button
              onClick={toggleMute}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                color: isMuted ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                transition: 'color var(--transition-fast) ease', flexShrink: 0,
              }}
            >
              {isMuted || volume === 0 ? <VolumeX size={16} /> : volume < 0.5 ? <Volume size={16} /> : volume < 0.8 ? <Volume1 size={16} /> : <Volume2 size={16} />}
            </button>
            <div
              style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--color-border-subtle)', cursor: 'pointer', position: 'relative' }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setVolume((e.clientX - rect.left) / rect.width);
              }}
            >
              <div style={{ height: '100%', width: `${(isMuted ? 0 : volume) * 100}%`, background: 'var(--color-accent)', borderRadius: 3, transition: 'width 0.08s linear' }} />
            </div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right', flexShrink: 0 }}>
              {isMuted ? '0%' : `${Math.round(volume * 100)}%`}
            </span>
          </div>
        )}



        {/* ── About artist ── */}
        {effectiveMode === 'online' && !isDeviceMode && album && (
          <div style={{ marginTop: 8, marginBottom: 20 }}>
            <h3 style={{
              color: 'rgba(255,255,255,0.4)', fontSize: 11,
              fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '1px', margin: '0 0 12px',
            }}>
              Artistes
            </h3>
            <button
              onClick={() => {
                if (album.artist_id) {
                  navigate(`/artist/${album.artist_id}`);
                  setFullPlayerVisible(false);
                }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                backgroundColor: 'transparent', borderRadius: 'var(--radius-sm)',
                padding: 8, border: 'none', cursor: 'pointer',
                width: '100%', textAlign: 'left',
                transition: 'background-color var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <img
                src={cachedArtistPic || album.artist?.profile_picture_url || album.artist_pdp || album.cover_url || undefined}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: 44, height: 44, borderRadius: 'var(--radius-full)', objectFit: 'cover', backgroundColor: 'var(--color-surface-elevated)', flexShrink: 0 }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {artistName}
                </p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, margin: '2px 0 0' }}>
                  Artiste principal
                </p>
              </div>
            </button>

            {allFeatArtists.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {allFeatArtists.map(({ name, artistId }: { name: string; artistId: string | null }) => (
                  <button
                    key={name}
                    onClick={() => {
                      if (artistId) { navigate(`/artist/${artistId}`); setFullPlayerVisible(false); }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      backgroundColor: 'transparent', borderRadius: 'var(--radius-sm)',
                      padding: '8px 8px 8px 12px', border: 'none',
                      cursor: artistId ? 'pointer' : 'default',
                      width: '100%', textAlign: 'left',
                      transition: 'background-color var(--transition-fast) ease',
                      opacity: artistId ? 1 : 0.6,
                    }}
                    onMouseEnter={(e) => { if (artistId) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-full)', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Volume2 size={18} color={artistId ? 'var(--color-text-muted)' : 'var(--color-text-muted)'} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: artistId ? 'var(--color-accent)' : 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </p>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-accent)', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)', flexShrink: 0 }}>
                      Feat.
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Up next ── */}
        {upcomingTracks.length > 0 && (
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <h3 style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
                À suivre ({upcomingTracks.length})
              </h3>
              {isAutoplaying && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px', color: 'var(--color-accent)' }}>
                  <Radio size={10} /> Radio
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {upcomingTracks.slice(0, isMobile ? 5 : 10).map((item, index) => {
                const originalIndex = currentIdx + 1 + index;
                const rowArtist = isDeviceMode
                  ? (item as { artist?: string }).artist ?? 'Artiste inconnu'
                  : formatAlbumArtist(queueAlbums[originalIndex] ?? album ?? undefined);
                const isActive = isDeviceMode
                  ? deviceCurrentIndex === originalIndex
                  : currentIndex === originalIndex;
                return (
                  <button
                    key={`${(item as { id: string }).id}-${originalIndex}`}
                    onClick={() => {
                      if (isDeviceMode) void playDeviceTrackAtIndex(deviceQueue, originalIndex);
                      else void playTrackAtIndex(originalIndex);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                      cursor: 'pointer', width: '100%', textAlign: 'left',
                      transition: 'background-color var(--transition-fast) ease',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, minWidth: 18, textAlign: 'center' }}>
                      {index + 1}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)', fontSize: 13, fontWeight: 600, margin: 0, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {formatTitle((item as { title: string }).title)}
                      </p>
                      <p style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, margin: '2px 0 0', lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rowArtist}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* ── Queue Modal ── */}
      {queueModalVisible && (
        <div
          onClick={() => setQueueModalVisible(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            ref={queueRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
              padding: '20px 24px 28px', maxHeight: '75%', width: '90%', maxWidth: 460,
              overflowY: 'auto', boxShadow: 'var(--shadow-xl)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid var(--color-border-subtle)', marginBottom: 16 }}>
              <h3 style={{ color: 'var(--color-text-primary)', fontSize: 16, fontWeight: 700, margin: 0 }}>File d'attente</h3>
              <button onClick={() => setQueueModalVisible(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-full)' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>En cours</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-surface-elevated)' }}>
                <Volume2 size={16} color="var(--color-accent)" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, margin: 0, lineHeight: '18px' }}>
                    {formatTitle(isDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title)}
                  </p>
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 500, margin: '2px 0 0' }}>
                    {isDeviceMode ? deviceCurrentTrack!.artist : formatAlbumArtist(queueAlbums[currentIdx] ?? album ?? undefined)}
                  </p>
                </div>
              </div>
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', margin: '16px 0 12px' }}>
              À suivre ({upcomingTracks.length})
            </p>
            {upcomingTracks.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '16px 0' }}>Aucun autre titre dans la file.</p>
            ) : (
              upcomingTracks.map((item, index) => {
                const originalIndex = currentIdx + 1 + index;
                const rowArtist = isDeviceMode
                  ? (item as { artist?: string }).artist ?? 'Artiste inconnu'
                  : formatAlbumArtist(queueAlbums[originalIndex] ?? album ?? undefined);
                return (
                  <button key={`${(item as { id: string }).id}-${originalIndex}`}
                    onClick={() => {
                      if (isDeviceMode) void playDeviceTrackAtIndex(deviceQueue, originalIndex);
                      else void playTrackAtIndex(originalIndex);
                      setQueueModalVisible(false);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                      border: 'none', background: 'transparent',
                      cursor: 'pointer', width: '100%', textAlign: 'left',
                      transition: 'background-color var(--transition-fast) ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, minWidth: 20, textAlign: 'center' }}>{index + 1}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, margin: 0, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {formatTitle((item as { title: string }).title)}
                      </p>
                      <p style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, margin: '2px 0 0', lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rowArtist}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── Share Modal ── */}
      <ShareCard
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        trackTitle={trackTitle}
        artistName={artistName}
        albumTitle={isDeviceMode ? undefined : album?.title}
        coverUri={coverUri}
        albumId={isDeviceMode ? undefined : album?.id}
      />

      {/* ── Lyrics Modal ── */}
      {showLyricsControls && lyricsModalVisible && (
        <div
          onClick={() => setLyricsModalVisible(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 10001,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'transparent', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', flexShrink: 0 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatTitle(trackTitle)}
                </p>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 500, margin: '2px 0 0' }}>
                  {artistName}
                </p>
              </div>
              <button onClick={() => setLyricsModalVisible(false)}
                style={{ width: 36, height: 36, borderRadius: 'var(--radius-full)', border: 'none', background: 'rgba(255,255,255,0.1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0, transition: 'all 0.2s ease' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: 700, height: '100%' }}>
                <FullPlayerLyrics
                  lyricsUrl={currentTrack?.lyrics_url || null}
                  trackId={currentTrack?.id || null}
                  currentTime={progress * duration}
                  isPlaying={isPlaying}
                  compact={false}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
