import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useCachedImage } from '@/hooks/useCachedImage';
import { buildVibrantWithAlpha } from '@/services/colorExtractor';
import { AlertCircle, Pause, Play, Share2, SkipBack, SkipForward, TextQuote, Volume2, Volume1, Volume, VolumeX, X } from 'lucide-react';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';
import { FeatArtistLinks } from './FeatArtistLinks';
import { formatTitle } from '@/utils/formatTitle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useBottomInset } from '@/hooks/useBottomInset';
import { ShareCard } from './ShareCard';
import { useMemo, useEffect, useState } from 'react';
import { useArtistNameLookup } from '@/contexts/ArtistLookupContext';

export function BottomPlayer() {
  const {
    album, currentTrack, deviceCurrentTrack, playMode,
    isPlaying, isLoading, next, previous, togglePlayPause,
    setFullPlayerVisible, isFullPlayerVisible, seekTo,
    playbackError, clearPlaybackError, setLyricsAutoOpen,
    volume, setVolume, toggleMute, isMuted
  } = useAudioPlayback();
  const { getArtistId } = useArtistNameLookup();
  
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
  const [shareModalVisible, setShareModalVisible] = useState(false);

  const isDeviceMode = playMode === 'device' && deviceCurrentTrack;
  const hasActiveTrack = playMode === 'device' ? !!deviceCurrentTrack : (!!currentTrack && !!album);

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

  const coverColors = useAlbumColors(coverUri);
  const cachedCover = useCachedImage(coverUri);

  // Sur desktop, quand le FullPlayer est ouvert, on cache le BottomPlayer
  const isDesktop = useMediaQuery('(min-width: 769px)');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const bottomInset = useBottomInset();
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
    setFullPlayerVisible(!isFullPlayerVisible);
  };

  const showLyricsControls = !isDeviceMode && Boolean(currentTrack?.lyrics_url || currentTrack?.has_lyrics);

  const handleOpenLyrics = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLyricsAutoOpen(true);
    setFullPlayerVisible(true);
  };

  const VolIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume : volume < 0.8 ? Volume1 : Volume2;

  // Base heights (sans inset)
  const basePlayerHeight = isMobile ? 64 : 80;
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
      }}>
        {/* Top Progress Bar */}
        <div
          className="bottom-player-progress"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            cursor: 'pointer',
            zIndex: 2,
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
                  borderRadius: 2,
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
                  borderRadius: 2,
                  transition: 'width 0.1s linear, background-image 0.6s ease',
                  boxShadow: `0 0 6px ${coverColors.colors?.vibrant || 'var(--color-accent-glow)'}`,
                  backgroundSize: isLoading ? '200% 100%' : undefined,
                  animation: isLoading ? 'shimmer 2s ease-in-out infinite' : undefined,
                }}
              />
        </div>

        {/* Left: Cover + Track Info */}
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
          }}
          onClick={handleCoverClick}
        >
          {/* Cover art */}
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
                <img src={(cachedCover || coverUri) ?? ''} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.6) brightness(0.8)', transition: 'filter 0.4s ease' }} />
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
              <img src={(cachedCover ?? coverUri) ?? ''} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
          </div>

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

        {/* Mobile: Play/Pause button on the right */}          {isMobile && (
          <div style={{ flexShrink: 0, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
            {showLyricsControls && (
              <button
                onClick={handleOpenLyrics}
                style={{
                  width: 36,
                  height: 36,
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
                <TextQuote size={16} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShareModalVisible(true); }}
              style={{
                width: 36,
                height: 36,
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
            >
              <Share2 size={16} />
            </button>
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
            {/* Share button */}
            <button
              onClick={(e) => { e.stopPropagation(); setShareModalVisible(true); }}
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
                color: 'var(--color-text-muted)',
                transition: 'all var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent'; }}
              title="Partager"
            >
              <Share2 size={16} />
            </button>

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
      {/* Share Modal */}
      <ShareCard
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        trackTitle={trackTitle}
        artistName={artistName}
        albumTitle={isDeviceMode ? undefined : album?.title}
        coverUri={coverUri}
        albumId={isDeviceMode ? undefined : album?.id}
      />
    </div>
  );
}
