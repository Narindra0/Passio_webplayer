import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';

export function BottomPlayer() {
  const navigate = useNavigate();
  const {
    album, currentTrack, deviceCurrentTrack, playMode,
    isPlaying, isLoading, next, previous, togglePlayPause,
    setFullPlayerVisible, isFullPlayerVisible, seekTo,
  } = useAudioPlayback();
  const { progress, duration } = useAudioProgress();

  const isDeviceMode = playMode === 'device' && deviceCurrentTrack;
  const hasActiveTrack = playMode === 'device' ? !!deviceCurrentTrack : !!currentTrack;

  if (!hasActiveTrack) return null;

  const trackTitle = isDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title;
  const artistName = isDeviceMode
    ? deviceCurrentTrack!.artist
    : (album!.artist_name ?? album!.artist?.name ?? '');
  const coverUri = isDeviceMode ? deviceCurrentTrack!.artworkUri : album!.cover_url;

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
      className="bottom-player glass-panel"
      style={{
        height: 80,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        flexShrink: 0,
        zIndex: 100,
        position: 'relative',
      }}
    >
      {/* Top Progress Bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          backgroundColor: 'rgba(255,255,255,0.06)',
          cursor: 'pointer',
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          seekTo(Math.max(0, Math.min(1, x / rect.width)));
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'linear-gradient(90deg, var(--color-primary), var(--color-primary-light))',
            width: `${Math.round(progress * 100)}%`,
            transition: 'width 0.1s linear',
            borderRadius: '0 2px 2px 0',
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
            borderRadius: 6,
            overflow: 'hidden',
            backgroundColor: 'var(--color-surface-elevated)',
            flexShrink: 0,
          }}
        >
          {coverUri ? (
            <img src={coverUri} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 20 }}>♪</span>
            </div>
          )}
        </div>

        {/* Title & Artist */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              lineHeight: '19px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {trackTitle}
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.6)',
              fontSize: 12,
              lineHeight: '16px',
              marginTop: 2,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Previous */}
          <button
            onClick={(e) => { e.stopPropagation(); void previous(); }}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.6)',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
          >
            <SkipBack size={20} />
          </button>

          {/* Play/Pause */}
          <button
            className="bottom-player-playbtn"
            onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              backgroundColor: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            border: 'none',
            cursor: 'pointer',
            transition: 'transform 0.1s ease, box-shadow 0.15s ease',
            animation: isPlaying ? 'pulseGlow 2s ease-in-out infinite' : 'none',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(255,255,255,0.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1.04)'; }}
          >
            {isLoading ? (
              <div className="loader-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            ) : isPlaying ? (
              <Pause size={20} color="#0a0a0a" />
            ) : (
              <Play size={20} color="#0a0a0a" style={{ marginLeft: 2 }} />
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
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.6)',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
          >
            <SkipForward size={20} />
          </button>
        </div>

        {/* Time labels */}
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
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
            {currentTimeLabel}
          </span>
          {/* Mini progress bar */}
          <div
            style={{
              flex: 1,
              height: 3,
              backgroundColor: 'rgba(255,255,255,0.08)',
              borderRadius: 2,
              cursor: 'pointer',
              position: 'relative',
              overflow: 'visible',
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
                backgroundColor: 'rgba(255,255,255,0.5)',
                width: `${Math.round(progress * 100)}%`,
                borderRadius: 2,
                transition: 'width 0.1s linear',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '50%',
                right: `${100 - Math.round(progress * 100)}%`,
                transform: 'translate(50%, -50%)',
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: '#fff',
                opacity: 0,
                transition: 'opacity 0.15s ease',
                pointerEvents: 'none',
                boxShadow: '0 0 4px rgba(0,0,0,0.3)',
              }}
              className="progress-handle"
            />
          </div>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 600, minWidth: 32, textAlign: 'left' }}>
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
          paddingRight: 8,
        }}
      >
        <button
          onClick={handleCoverClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: isFullPlayerVisible ? 'rgba(120, 0, 0, 0.12)' : 'transparent',
            cursor: 'pointer',
            color: isFullPlayerVisible ? 'var(--color-accent)' : 'rgba(255,255,255,0.5)',
            fontSize: 12,
            fontWeight: 600,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!isFullPlayerVisible) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.color = '#fff';
            }
          }}
          onMouseLeave={(e) => {
            if (!isFullPlayerVisible) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
            }
          }}
        >
          <Volume2 size={16} />
          <span>En cours</span>
        </button>
      </div>
    </div>
  );
}
