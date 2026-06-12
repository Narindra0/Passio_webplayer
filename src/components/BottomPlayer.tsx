import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useCachedImage } from '@/hooks/useCachedImage';
import { buildVibrantWithAlpha } from '@/services/colorExtractor';
import { AlertCircle, Pause, Play, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function BottomPlayer() {
  const {
    album, currentTrack, deviceCurrentTrack, playMode,
    isPlaying, isLoading, next, previous, togglePlayPause,
    setFullPlayerVisible, isFullPlayerVisible, seekTo,
    playbackError, clearPlaybackError
  } = useAudioPlayback();
  const { progress, duration } = useAudioProgress();
  const [showError, setShowError] = useState(false);

  const isDeviceMode = playMode === 'device' && deviceCurrentTrack;
  const hasActiveTrack = playMode === 'device' ? !!deviceCurrentTrack : !!currentTrack;

  // Compute these values even if no active track (for hook consistency)
  const trackTitle = hasActiveTrack ? (isDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title) : '';
  const artistName = hasActiveTrack
    ? (isDeviceMode
      ? deviceCurrentTrack!.artist
      : (album!.artist_name ?? album!.artist?.name ?? ''))
    : '';
  const coverUri = hasActiveTrack ? (isDeviceMode ? deviceCurrentTrack!.artworkUri : album!.cover_url) : '';

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

  if (!hasActiveTrack) return null;

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

  return (
    <div
      className={`bottom-player glass-panel${showError ? ' has-error' : ''}`}
      style={{
        height: showError ? 120 : 80,
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

      {/* Main player bar */}
      <div style={{
        height: showError ? 80 : 80,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        flexShrink: 0,
      }}>
        {/* Top Progress Bar — dynamic color from album art */}
        <div
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
              top: 0,
              left: 0,
              right: 0,
              height: '100%',
              background: 'var(--color-border-subtle)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              background: coverColors.colors?.vibrant || 'var(--color-accent)',
              width: `${Math.round(progress * 100)}%`,
              transition: 'width 0.1s linear, background 0.6s ease',
            }}
          />
        </div>

        {/* Left: Track Info */}
        <div
          className="bottom-player-left"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            minWidth: 0,
            width: 280,
            cursor: 'pointer',
          }}
          onClick={handleCoverClick}
        >
          {/* Cover art */}
          <div
            className="bottom-player-cover"
            style={{
              width: 52,
              height: 52,
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              backgroundColor: 'var(--color-surface-elevated)',
              flexShrink: 0,
            }}
          >
            {coverUri ? (
              <img src={cachedCover || coverUri} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 20 }}>♪</span>
              </div>
            )}
          </div>

          {/* Title & Artist */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                color: 'var(--color-text-primary)',
                fontSize: 14,
                fontWeight: 600,
                lineHeight: '18px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {trackTitle}
            </div>
            <div
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: 12,
                lineHeight: '16px',
                marginTop: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {artistName}
            </div>
          </div>
        </div>

        {/* Center: Controls */}
        <div
          className="bottom-player-center"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Previous */}
            <button
              onClick={(e) => { e.stopPropagation(); void previous(); }}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                transition: 'color var(--transition-fast) ease',
                borderRadius: 'var(--radius-full)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
            >
              <SkipBack size={18} />
            </button>

            {/* Play/Pause */}
            <button
              className="bottom-player-playbtn"
              onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-full)',
                background: isPlaying ? (coverColors.colors?.vibrant || 'var(--color-accent)') : 'var(--color-text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                cursor: 'pointer',
                transition: 'all var(--transition-fast) ease',
                boxShadow: isPlaying
                  ? `0 0 16px ${buildVibrantWithAlpha(coverColors.colors, 0.25)}`
                  : 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.04)';
                if (isPlaying) {
                  e.currentTarget.style.boxShadow = `0 0 24px ${buildVibrantWithAlpha(coverColors.colors, 0.5)}`;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                if (isPlaying) {
                  e.currentTarget.style.boxShadow = `0 0 16px ${buildVibrantWithAlpha(coverColors.colors, 0.25)}`;
                }
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.96)';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1.04)';
              }}
            >
              {isLoading ? (
                <div className="loader-spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
              ) : isPlaying ? (
                <Pause size={18} color="#fff" />
              ) : (
                <Play size={18} color="#0a0a0a" style={{ marginLeft: 2 }} />
              )}
            </button>

            {/* Next */}
            <button
              onClick={(e) => { e.stopPropagation(); void next(); }}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                transition: 'color var(--transition-fast) ease',
                borderRadius: 'var(--radius-full)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
            >
              <SkipForward size={18} />
            </button>
          </div>

          {/* Time labels & progress */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              maxWidth: 400,
            }}
          >
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 500, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {currentTimeLabel}
            </span>
            <div
              style={{
                flex: 1,
                height: 4,
                backgroundColor: 'var(--color-border-subtle)',
                borderRadius: 2,
                cursor: 'pointer',
                position: 'relative',
                overflow: 'visible',
                transition: 'height 0.15s ease',
              }}
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                seekTo(Math.max(0, Math.min(1, x / rect.width)));
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: 'var(--color-accent)',
                  width: `${Math.round(progress * 100)}%`,
                  borderRadius: 2,
                  transition: 'width 0.1s linear',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: `${Math.round(progress * 100)}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: 'var(--color-text-primary)',
                  opacity: 0,
                  transition: 'opacity 0.15s ease',
                  pointerEvents: 'none',
                }}
                className="progress-handle"
              />
            </div>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 500, minWidth: 28, textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>
              {totalTimeLabel}
            </span>
          </div>
        </div>

        {/* Right: Volume & Extras */}
        <div
          className="bottom-player-right"
          style={{
            width: 280,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            paddingRight: 4,
          }}
        >
          <button
            onClick={handleCoverClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: isFullPlayerVisible ? 'var(--color-surface-elevated)' : 'transparent',
              cursor: 'pointer',
              color: isFullPlayerVisible ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontSize: 12,
              fontWeight: 600,
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => {
              if (!isFullPlayerVisible) {
                e.currentTarget.style.background = 'var(--color-surface-hover)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isFullPlayerVisible) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--color-text-muted)';
              }
            }}
          >
            <Volume2 size={16} />
            <span>En cours</span>
          </button>
        </div>
      </div>
    </div>
  );
}
