import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useNetworkQuality } from '@/hooks/useNetworkQuality';
import { buildVibrantWithAlpha } from '@/services/colorExtractor';
import { AlertCircle, List, Pause, Play, SkipBack, SkipForward, TextQuote, Volume2, Volume1, Volume, VolumeX, X } from 'lucide-react';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';
import { FeatArtistLinks } from './FeatArtistLinks';
import { formatTitle } from '@/utils/formatTitle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useBottomInset } from '@/hooks/useBottomInset';
import { getOptimizedImageUrl } from '@/utils/imageUtils';
import { useSwipeHorizontal } from '@/hooks/useSwipeHorizontal';
import { useMemo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function BottomPlayer() {
  const {
    album, currentTrack, deviceCurrentTrack, playMode,
    isPlaying, isLoading, next, previous, togglePlayPause,
    setFullPlayerVisible, isFullPlayerVisible, seekTo,
    playbackError, clearPlaybackError, setLyricsAutoOpen,
    volume, setVolume, toggleMute, isMuted,
    queue, currentIndex, queueMode, toggleQueueMode,
    repeatMode, toggleRepeat, isAutoplaying,
    deviceQueue, deviceCurrentIndex, queueAlbums,
    playTrackAtIndex, playDeviceTrackAtIndex,
  } = useAudioPlayback();

  
  // Build artistIdMap for FeatArtistLinks
  const artistIdMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (album) {
      // Add main artist
      const name = album.artist_name || album.artist?.name;
      const id = album.artist_id || album.artist?.id;
      if (name && id) {
        map[normalizeArtistName(name)] = id;
      }
      // Add artists from album.artists
      if (album.artists) {
        for (const a of album.artists) {
          if (a.name && a.id) {
            map[normalizeArtistName(a.name)] = a.id;
          }
        }
      }
    }
    return map;
  }, [album]);
  const { progress, duration } = useAudioProgress();
  const [showError, setShowError] = useState(false);
  const [queueModalVisible, setQueueModalVisible] = useState(false);

  const isDeviceMode = playMode === 'device' && deviceCurrentTrack;
  const hasActiveTrack = playMode === 'device' ? !!deviceCurrentTrack : (!!currentTrack && !!album);

  // Calculer la disponibilité des pistes suivante/précédente pour le swipe
  const fullQueue = isDeviceMode ? deviceQueue : queue;
  const currentIdx = isDeviceMode ? deviceCurrentIndex : currentIndex;
  const upcomingTracks = currentIdx >= 0 ? fullQueue.slice(currentIdx + 1) : [];
  const hasNext = currentIdx < fullQueue.length - 1 || repeatMode === 'all';
  const hasPrev = currentIdx > 0 || repeatMode === 'all';

  // Compute these values even if no active track (for hook consistency)
  const rawTitle = hasActiveTrack ? (isDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title) : '';
  const { cleanTitle: trackTitle, featNames } = useMemo(() => {
    if (!rawTitle) return { cleanTitle: '', featNames: [] };
    if (hasFeatArtists(rawTitle)) return parseFeatArtists(rawTitle);
    return { cleanTitle: rawTitle, featNames: [] };
  }, [rawTitle]);
  const artistName = hasActiveTrack
    ? (isDeviceMode
      ? deviceCurrentTrack!.artist
      : (album?.artist_name ?? album?.artist?.name ?? ''))
    : '';
  const coverUri = hasActiveTrack ? (isDeviceMode ? deviceCurrentTrack!.artworkUri : album?.cover_url) : '';

  // All hooks must come before early return!
  useEffect(() => {
    if (playbackError) {
      setShowError(true);
      const timer = setTimeout(() => setShowError(false), 8000);
      return () => clearTimeout(timer);
    } else {
      setShowError(false);
    }
  }, [playbackError]);

  const networkQuality = useNetworkQuality();
  const isDataSaver = networkQuality === 'slow';
  // ⚡ En data saver : on saute l'extraction de couleurs (économise download + CPU)
  const coverColors = useAlbumColors(isDataSaver ? null : coverUri);
  // ⚡ Data saver : pas de cache IndexedDB (l'image s'affiche via URL directe)
  const cachedCover = useCachedImage(isDataSaver ? null : coverUri);

  // Sur desktop, quand le FullPlayer est ouvert, on cache le BottomPlayer
  const isDesktop = useMediaQuery('(min-width: 769px)');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const bottomInset = useBottomInset();

  // ── Swipe horizontal pour changer de piste (mobile uniquement) ──
  // Doit être appelé APRÈS tous les useMediaQuery pour respecter les règles des hooks
  const {
    dragOffset: swipeOffset,
    isDragging: isSwiping,
    handlers: swipeHandlers,
  } = useSwipeHorizontal({
    onSwipeLeft: () => { void next(); },
    onSwipeRight: () => { void previous(); },
    enabled: isMobile && hasActiveTrack,
    hasNext,
    hasPrev,
    threshold: 60,
  });
  if (isDesktop && isFullPlayerVisible) return null;

  if (!hasActiveTrack) return null;

  // Animation class for entry
  const entryClass = 'player-enter';

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const currentTimeLabel = formatTime(progress * duration);
  const totalTimeLabel = formatTime(duration);

  const handleCoverClick = () => {
    if (isSwiping) return;
    setFullPlayerVisible(!isFullPlayerVisible);
  };



  const showLyricsControls = !isDeviceMode && Boolean(currentTrack?.lyrics_url || currentTrack?.has_lyrics);

  const handleOpenLyrics = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLyricsAutoOpen(true);
    setFullPlayerVisible(true);
  };

  const VolIcon = isMuted || volume === 0 ? VolumeX : volume < 0.33 ? Volume : volume < 0.66 ? Volume1 : Volume2;

  // Base heights (sans inset)
  // ⚡ Mode Éco : player légèrement plus haut pour la barre épaisse SoundCloud-like
  const basePlayerHeight = isMobile ? (isDataSaver ? 72 : 64) : 80;
  const baseErrorHeight = isMobile ? 36 : 40; // error banner
  // Total container height: base + safe-area inset so content floats above system bar
  const totalHeight = (showError ? basePlayerHeight + baseErrorHeight : basePlayerHeight)
    + (isMobile ? bottomInset : 0);

  return (
    <div
      className={`bottom-player glass-panel ${entryClass}${showError ? ' has-error' : ''}`}
      style={{
        height: totalHeight,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        zIndex: 100,
        position: 'relative',
        transition: 'height 0.3s ease',
      }}
    >
      {/* Error banner */}
      {showError && playbackError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            background: 'rgba(220,20,60,0.15)',
            borderBottom: '1px solid rgba(220,20,60,0.2)',
            flexShrink: 0,
          }}
        >
          <AlertCircle size={14} color="var(--color-accent)" />
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, flex: 1 }}>
            {playbackError}
          </span>
          <button
            onClick={() => { clearPlaybackError(); setShowError(false); }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: 'var(--color-text-muted)',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main player bar — sits above the safe-area inset space */}
      <div style={{
        height: basePlayerHeight,
        display: 'flex',
        alignItems: 'center',
        padding: isMobile ? '0 10px' : '0 16px',
        flexShrink: 0,
        position: 'relative',
      }}>
        {/* ⚡ Badge Éco subtil — petit indicateur lumineux */}
        {isDataSaver && (
          <div
            title="Mode économie de données activé"
            style={{
              position: 'absolute',
              top: isMobile ? 4 : 4,
              left: isMobile ? 4 : 8,
              zIndex: 10,
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              padding: '2px 6px 2px 5px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: isMobile ? 7 : 8,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.3px',
              lineHeight: isMobile ? '13px' : '15px',
              transition: 'all 0.2s ease',
              cursor: 'default',
            }}
          >
            {/* Petit point vert lumineux */}
            <span style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: '#22C55E',
              boxShadow: '0 0 4px rgba(34,197,94,0.4)',
              flexShrink: 0,
            }} />
            Éco
          </div>
        )}
        {/* ⚡ Progress bar — en mode Éco, barre épaisse SoundCloud-like en bas */}
        <div
          className="bottom-player-progress"
          style={{
            position: 'absolute',
            top: isDataSaver && isMobile ? undefined : 0,
            bottom: isDataSaver && isMobile ? 0 : undefined,
            left: isDataSaver && isMobile ? 8 : 0,
            right: isDataSaver && isMobile ? 8 : 0,
            height: isDataSaver && isMobile ? 8 : 3,
            borderRadius: isDataSaver && isMobile ? 4 : 0,
            cursor: 'pointer',
            zIndex: 2,
            backgroundColor: isDataSaver && isMobile ? 'rgba(255,255,255,0.06)' : undefined,
            overflow: 'hidden',
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            seekTo(Math.max(0, Math.min(1, x / rect.width)));
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, height: '100%',                  background: 'var(--color-border-subtle)',
                  borderRadius: isDataSaver && isMobile ? 4 : 2,
                  overflow: 'hidden',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 0, left: 0, height: '100%',
                  backgroundImage: isLoading
                    ? `linear-gradient(90deg, ${coverColors.colors?.vibrant || 'var(--color-accent)'}, ${coverColors.colors?.muted || 'var(--color-accent-light)'}, ${coverColors.colors?.vibrant || 'var(--color-accent)'})`
                    : `linear-gradient(90deg, ${coverColors.colors?.vibrant || 'var(--color-accent)'}, ${coverColors.colors?.muted || 'var(--color-accent-light)'})`,
                  width: `${Math.round(progress * 100)}%`,
                  borderRadius: isDataSaver && isMobile ? 4 : 2,
                  transition: 'width 0.1s linear, background-image 0.6s ease',
                  boxShadow: `0 0 6px ${coverColors.colors?.vibrant || 'var(--color-accent-glow)'}`,
                  backgroundSize: isLoading ? '200% 100%' : undefined,
                  animation: isLoading ? 'shimmer 2s ease-in-out infinite' : undefined,
                }}
              />
        </div>

        {/* Left: Cover + Track Info (swipeable sur mobile) */}
        <div
          className="bottom-player-left"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 10 : 14,
            minWidth: 0,
            flex: isMobile ? 1 : '0 0 280px',
            maxWidth: isMobile ? 'calc(100% - 68px)' : '280px',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
            transform: isSwiping && isMobile ? `translateX(${swipeOffset * 0.3}px)` : 'translateX(0)',
            transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
          onClick={handleCoverClick}
          {...(isMobile ? swipeHandlers : {})}
        >
          {/* Indicateurs de swipe */}
          {isMobile && isSwiping && (
            <>
              {/* Indicateur précédent (swipe droit) */}
              {swipeOffset > 15 && hasPrev && (
                <div style={{
                  position: 'absolute',
                  right: '100%',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px 4px 6px',
                  borderRadius: '0 var(--radius-full) var(--radius-full) 0',
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(8px)',
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.7)',
                  pointerEvents: 'none',
                  animation: 'slideInFromLeft 0.15s ease',
                }}>
                  <SkipBack size={12} />
                  Précédent
                </div>
              )}
              {/* Indicateur suivant (swipe gauche) */}
              {swipeOffset < -15 && hasNext && (
                <div style={{
                  position: 'absolute',
                  left: '100%',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 6px 4px 10px',
                  borderRadius: 'var(--radius-full) 0 0 var(--radius-full)',
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(8px)',
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.7)',
                  pointerEvents: 'none',
                  animation: 'slideInFromRight 0.15s ease',
                }}>
                  Suivant
                  <SkipForward size={12} />
                </div>
              )}
            </>
          )}
          {/* Cover art — masquée en mode Éco */}
          {!isDataSaver && (
            <div
              className={`bottom-player-cover${isLoading ? ' cover-loading-ring' : ''}`}
              style={{
                width: isMobile ? 42 : 52,
                height: isMobile ? 42 : 52,
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                backgroundColor: 'var(--color-surface-elevated)',
                flexShrink: 0,
                position: isLoading ? 'relative' : undefined,
              }}
            >
              {isLoading ? (
                <>
                  <img src={getOptimizedImageUrl((cachedCover || coverUri) ?? '')} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.6) brightness(0.8)', transition: 'filter 0.4s ease' }} />
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(135deg, transparent 40%, rgba(220,20,60,0.06) 70%, transparent 100%)',
                    animation: 'shimmer 2s ease-in-out infinite',
                    backgroundSize: '200% 100%',
                    borderRadius: 'var(--radius-sm)',
                    pointerEvents: 'none',
                  }} />
                </>
              ) : (
                <img src={getOptimizedImageUrl((cachedCover ?? coverUri) ?? '')} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>
          )}
          {/* ⚡ Mode Éco : cercle coloré (CSS, pas d'image) inspiré SoundCloud */}
          {isDataSaver && (
            <div
              style={{
                width: isMobile ? 38 : 46,
                height: isMobile ? 38 : 46,
                borderRadius: 'var(--radius-full)',
                flexShrink: 0,
                background: coverColors.colors?.vibrant
                  ? `linear-gradient(135deg, ${coverColors.colors.vibrant}, ${coverColors.colors.darkMuted || coverColors.colors.dominant})`
                  : 'linear-gradient(135deg, var(--color-accent), #8B0000)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                boxShadow: isPlaying
                  ? `0 0 12px ${coverColors.colors?.vibrant ? `${coverColors.colors.vibrant}40` : 'rgba(220,20,60,0.3)'}`
                  : 'none',
                transition: 'box-shadow 0.4s ease',
              }}
            >
              {/* Dot central animé façon SoundCloud */}
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.35)',
                animation: isPlaying ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />
              {isPlaying && (
                <div style={{
                  position: 'absolute',
                  inset: -2,
                  borderRadius: 'inherit',
                  border: '2px solid rgba(255,255,255,0.08)',
                  animation: 'spin 4s linear infinite',
                }} />
              )}
            </div>
          )}

          {/* Title & Artist + Timer mobile */}
          <div style={{ minWidth: 0, flex: 1 }}>
            {isLoading ? (
              <div style={{ animation: 'fadeIn 0.3s ease' }}>
                <div className="skeleton-pulse" style={{
                  height: isMobile ? 15 : 16,
                  width: '60%',
                  borderRadius: 4,
                  background: 'var(--color-surface-hover)',
                  marginBottom: 5,
                }} />
                <div className="skeleton-pulse" style={{
                  height: isMobile ? 11 : 12,
                  width: '40%',
                  borderRadius: 4,
                  background: 'var(--color-surface-hover)',
                }} />
              </div>
            ) : (
              <div style={{ animation: 'fadeIn 0.25s ease' }}>
                <div
                  style={{
                    color: 'var(--color-text-primary)',
                    fontSize: isMobile ? 13 : 14,
                    fontWeight: 600,
                    lineHeight: '18px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  title={rawTitle}
                >
                  {formatTitle(trackTitle)}
                </div>
                <div
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: isMobile ? 11 : 12,
                    lineHeight: '16px',
                    marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {artistName}
                  {featNames.length > 0 && (
                    <FeatArtistLinks featNames={featNames} artistIdMap={artistIdMap} style={{ fontSize: isMobile ? 10 : 12 }} />
                  )}
                </div>
              </div>
            )}
            {/* Timer mobile */}
            {isMobile && !isLoading && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  marginTop: 1,
                  animation: 'fadeIn 0.3s ease',
                }}
              >
                <span style={{ color: 'var(--color-text-muted)', fontSize: 9, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {currentTimeLabel}
                </span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 8, opacity: 0.35 }}>/</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 9, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {totalTimeLabel}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Center: Desktop controls (prev/play/next) */}
        {!isMobile && (
          <div
            className="bottom-player-center"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                onClick={(e) => { e.stopPropagation(); void previous(); }}
                style={{
                  width: 32, height: 32,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-secondary)',
                  borderRadius: 'var(--radius-full)',
                  transition: 'color var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              >
                <SkipBack size={18} />
              </button>
              <button
                className="bottom-player-playbtn"
                onClick={(e) => { 
                  e.stopPropagation(); 
                  togglePlayPause(); 
                }}
                style={{
                  width: 40, height: 40,
                  borderRadius: 'var(--radius-full)',
                  background: isPlaying ? (coverColors.colors?.vibrant || 'var(--color-accent)') : 'var(--color-text-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', cursor: 'pointer',
                  transition: 'all var(--transition-fast) ease',
                  boxShadow: isPlaying ? `0 0 16px ${buildVibrantWithAlpha(coverColors.colors, 0.25)}` : 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.04)';
                  if (isPlaying) e.currentTarget.style.boxShadow = `0 0 24px ${buildVibrantWithAlpha(coverColors.colors, 0.5)}`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  if (isPlaying) e.currentTarget.style.boxShadow = `0 0 16px ${buildVibrantWithAlpha(coverColors.colors, 0.25)}`;
                }}
                onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1.04)'; }}
              >
                {isLoading ? (
                  <div className="loader-spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
                ) : isPlaying ? (
                  <Pause size={18} color="#fff" />
                ) : (
                  <Play size={18} color="#0a0a0a" style={{ marginLeft: 2 }} />
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void next(); }}
                style={{
                  width: 32, height: 32,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-secondary)',
                  borderRadius: 'var(--radius-full)',
                  transition: 'color var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              >
                <SkipForward size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Mobile: Play/Pause button on the right */}
        {isMobile && (
          <div style={{ flexShrink: 0, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Paroles */}
            {showLyricsControls && (
              <button
                onClick={handleOpenLyrics}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-accent)',
                  transition: 'all var(--transition-fast) ease',
                }}
                title="Paroles"
              >
                <TextQuote size={14} />
              </button>
            )}

            {/* Volume supprimé sur mobile — le mobile a déjà le volume hardware */}

            {/* File d'attente */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setQueueModalVisible(true);
              }}
              style={{
                width: 34,
                height: 34,
                borderRadius: 'var(--radius-full)',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-muted)',
                transition: 'all var(--transition-fast) ease',
              }}
              title="File d'attente"
            >
              <List size={16} />
            </button>

            {/* Play/Pause */}
            <button
              className="bottom-player-playbtn"
              onClick={(e) => { 
                e.stopPropagation(); 
                togglePlayPause(); 
              }}
              style={{
                width: 42,
                height: 42,
                borderRadius: 'var(--radius-full)',
                background: isPlaying ? (coverColors.colors?.vibrant || 'var(--color-accent)') : 'var(--color-text-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer',
                transition: 'all var(--transition-fast) ease',
                boxShadow: isPlaying ? `0 0 16px ${buildVibrantWithAlpha(coverColors.colors, 0.25)}` : 'none',
              }}
            >
              {isLoading ? (
                <div className="loader-spinner" style={{ width: 18, height: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
              ) : isPlaying ? (
                <Pause size={20} color="#fff" />
              ) : (
                <Play size={20} color="#0a0a0a" style={{ marginLeft: 2 }} />
              )}
            </button>
          </div>
        )}

        {/* Right: Timer badge + Volume slider — desktop only */}
        {!isMobile && (
          <div
            className="bottom-player-right"
            style={{
              width: 280,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 12,
              paddingRight: 4,
            }}
          >
            {/* Timer badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <div style={{ width: 40, height: 3, borderRadius: 2, background: 'var(--color-border-subtle)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--color-accent)', borderRadius: 2, transition: 'width 0.1s linear' }} />
              </div>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{currentTimeLabel}</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 400, opacity: 0.35, lineHeight: 1 }}>/</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{totalTimeLabel}</span>
            </div>

            {/* Lyrics button */}
            {showLyricsControls && (
              <button
                onClick={handleOpenLyrics}
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
                  color: 'var(--color-accent)',
                  transition: 'all var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                title="Paroles"
              >
                <TextQuote size={15} />
              </button>
            )}

            {/* Volume slider */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                  color: isMuted ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                }}
              >
                <VolIcon size={14} />
              </button>
              <div
                style={{ width: 56, height: 4, borderRadius: 2, background: 'var(--color-border-subtle)', cursor: 'pointer', position: 'relative', flexShrink: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setVolume((e.clientX - rect.left) / rect.width);
                }}
              >
                <div style={{ height: '100%', width: `${(isMuted ? 0 : volume) * 100}%`, background: 'var(--color-accent)', borderRadius: 2, transition: 'width 0.1s ease' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Queue Modal (mobile) ── */}
      {isMobile && queueModalVisible && createPortal(
        <div
          onClick={() => setQueueModalVisible(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            animation: 'fadeIn 0.15s ease',
          }}
        >
          {/* Backdrop */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }}
          />

          {/* Sheet */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              zIndex: 1,
              maxHeight: '50vh',
              background: 'var(--color-surface)',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              border: '1px solid var(--color-border-subtle)',
              borderBottom: 'none',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
              overflow: 'hidden',
              animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Handle */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '10px 0 4px',
            }}>
              <div style={{
                width: 32,
                height: 4,
                borderRadius: 2,
                background: 'var(--color-border-subtle)',
              }} />
            </div>

            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 16px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <List size={16} color="var(--color-accent)" />
                <span style={{
                  color: 'var(--color-text-primary)',
                  fontSize: 15,
                  fontWeight: 700,
                }}>
                  File d'attente
                </span>
                {upcomingTracks.length > 0 && (
                  <span style={{
                    color: 'var(--color-text-muted)',
                    fontSize: 12,
                    fontWeight: 500,
                    marginLeft: 2,
                  }}>
                    {upcomingTracks.length + 1} titre{upcomingTracks.length + 1 > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {/* Shuffle toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleQueueMode();
                  }}
                  style={{
                    width: 32, height: 32,
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--color-border-subtle)',
                    background: queueMode === 'shuffle' ? 'var(--color-accent-soft)' : 'var(--color-surface-elevated)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: queueMode === 'shuffle' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    fontSize: 11,
                    fontWeight: 700,
                    transition: 'all var(--transition-fast) ease',
                  }}
                  title={queueMode === 'shuffle' ? 'Lecture aléatoire ON' : 'Lecture aléatoire OFF'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 3 21 3 21 8" />
                    <line x1="4" y1="20" x2="21" y2="3" />
                    <polyline points="21 16 21 21 16 21" />
                    <line x1="15" y1="15" x2="21" y2="21" />
                    <line x1="4" y1="4" x2="9" y2="9" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Queue list */}
            <div
              style={{
                maxHeight: 'calc(50vh - 80px)',
                overflowY: 'auto',
                padding: '0 12px 16px',
              }}
            >
              {/* Current track */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(220,20,60,0.08)',
                border: '1px solid rgba(220,20,60,0.15)',
                marginBottom: 4,
              }}>
                <div style={{
                  width: 36, height: 36,
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  flexShrink: 0,
                  backgroundColor: 'var(--color-surface-elevated)',
                }}>
                  <img src={getOptimizedImageUrl((cachedCover || coverUri) ?? '')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    color: 'var(--color-accent)',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'block',
                    lineHeight: '15px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {formatTitle(trackTitle)}
                  </span>
                  <span style={{
                    color: 'var(--color-text-muted)',
                    fontSize: 10,
                    display: 'block',
                    marginTop: 1,
                  }}>
                    En cours
                  </span>
                </div>
                {/* Equalizer animation */}
                {isPlaying && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 12, flexShrink: 0 }}>
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="equalizer-bar"
                        style={{
                          width: 3,
                          background: 'var(--color-accent)',
                          borderRadius: '1px 1px 0 0',
                          animationDelay: `${i * 0.15}s`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Upcoming tracks */}
              {upcomingTracks.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '24px 16px',
                  color: 'var(--color-text-muted)',
                  fontSize: 13,
                }}>
                  {isAutoplaying ? (
                    <>
                      <span style={{ display: 'block', marginBottom: 4 }}>🎵 Mode Radio actif</span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        Les recommandations seront chargées automatiquement
                      </span>
                    </>
                  ) : (
                    'Plus aucun titre dans la file'
                  )}
                </div>
              ) : (
                upcomingTracks.map((item, index) => {
                  const originalIndex = currentIdx + 1 + index;
                  const rowTrack = isDeviceMode
                    ? (item as { id: string; title: string; artist?: string }).title
                    : (item as { id: string; title: string; artist_name?: string; artists?: { name: string }[] }).title;
                  // L'artiste n'est pas stocké dans PublicTrack → le récupérer depuis les albums
                  const rowArtist = isDeviceMode
                    ? (item as { artist?: string }).artist ?? 'Artiste inconnu'
                    : queueAlbums[originalIndex]?.artist_name
                      ?? queueAlbums[originalIndex]?.artist?.name
                      ?? album?.artist_name
                      ?? album?.artist?.name
                      ?? 'Artiste inconnu';

                  return (
                    <button
                      key={originalIndex}
                      onClick={(e) => {
                        e.stopPropagation();
                        setQueueModalVisible(false);
                        if (isDeviceMode) {
                          void playDeviceTrackAtIndex(deviceQueue, originalIndex);
                        } else {
                          void playTrackAtIndex(originalIndex);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'left',
                        transition: 'background 0.15s ease',
                      }}
                      onTouchEnd={() => {}}
                    >
                      <span style={{
                        width: 18,
                        color: 'var(--color-text-muted)',
                        fontSize: 10,
                        fontWeight: 600,
                        textAlign: 'center',
                        flexShrink: 0,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {originalIndex + 1}
                      </span>
                      <span style={{
                        flex: 1,
                        minWidth: 0,
                        color: 'var(--color-text-secondary)',
                        fontSize: 12,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        lineHeight: '16px',
                      }}>
                        {formatTitle(rowTrack)}
                      </span>
                      <span style={{
                        color: 'var(--color-text-muted)',
                        fontSize: 10,
                        fontWeight: 400,
                        flexShrink: 0,
                        maxWidth: 80,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {rowArtist}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer: mode d'affichage */}
            <div style={{
              borderTop: '1px solid var(--color-border-subtle)',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  color: 'var(--color-text-muted)',
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Mode : {queueMode === 'shuffle' ? 'Aléatoire' : 'Séquentiel'}
                </span>
                {isAutoplaying && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--color-accent-soft)',
                    border: '1px solid var(--color-accent)',
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: 'var(--color-accent)',
                  }}>
                    Radio
                  </span>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setQueueModalVisible(false);
                }}
                style={{
                  width: 28, height: 28,
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  background: 'var(--color-surface-elevated)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-muted)',
                  transition: 'all var(--transition-fast) ease',
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
