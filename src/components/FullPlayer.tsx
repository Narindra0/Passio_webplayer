import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useCachedImage } from '@/hooks/useCachedImage';
import type { PublicAlbumDetails } from '@/types/backend';
import {
    ChevronLeft,
    Infinity,
    List,
    Pause,
    Play,
    Repeat, Repeat1,
    Shuffle, SkipBack, SkipForward,
    TextQuote, Volume2, X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FullPlayerLyrics } from './FullPlayerLyrics';
import { PlayerWaveform } from './PlayerWaveform';

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
  } = useAudioPlayback();
  const { progress, duration } = useAudioProgress();
  const [lyricsMode, setLyricsMode] = useState<'hidden' | 'compact' | 'fullscreen'>('hidden');
  const [queueModalVisible, setQueueModalVisible] = useState(false);
  const queueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLyricsMode('hidden');
  }, [currentTrack?.id, deviceCurrentTrack?.id]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (queueModalVisible) setQueueModalVisible(false);
        else setFullPlayerVisible(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [queueModalVisible, setFullPlayerVisible]);

  const isDeviceMode = playMode === 'device' && deviceCurrentTrack;
  if (!isDeviceMode && (!album || !currentTrack)) return null;
  if (isDeviceMode && !deviceCurrentTrack) return null;
  if (!isFullPlayerVisible) return null;

  const showLyricsControls = !isDeviceMode && Boolean(currentTrack?.lyrics_url || currentTrack?.has_lyrics);
  const hasNext = isDeviceMode
    ? deviceCurrentIndex < deviceQueue.length - 1 || repeatMode === 'all'
    : currentIndex < queue.length - 1 || repeatMode === 'all';
  const hasPrev = isDeviceMode
    ? deviceCurrentIndex > 0 || repeatMode === 'all'
    : currentIndex > 0 || repeatMode === 'all';
  const trackTitle = isDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title;
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
  const coverColors = useAlbumColors(coverUri);
  const cachedCover = useCachedImage(coverUri);
  const cachedArtistPic = useCachedImage(album?.artist?.profile_picture_url || album?.artist_pdp || null);

  const fullQueue = isDeviceMode ? deviceQueue : queue;
  const currentIdx = isDeviceMode ? deviceCurrentIndex : currentIndex;
  const upcomingTracks = fullQueue.slice(Math.max(0, currentIdx + 1));

  return (
    <aside
      className="fullplayer"
      style={{
        width: 380,
        height: '100%',
        backgroundColor: 'var(--color-bg-dark)',
        borderLeft: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Background gradient — dynamic from album cover */}
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

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px 12px',
          position: 'relative',
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setFullPlayerVisible(false)}
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
          <ChevronLeft size={18} />
        </button>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
          En cours
        </span>
        <button
          onClick={() => setQueueModalVisible(true)}
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
          <List size={18} />
        </button>
      </div>

      {/* Content */}
      <div
        className="fullplayer-content"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 24px 28px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Cover art — centered */}
        <div
          style={{
            width: '100%',
            maxWidth: 320,
            margin: '0 auto 20px',
            aspectRatio: '1',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            backgroundColor: 'var(--color-surface-elevated)',
            boxShadow: 'var(--shadow-xl)',
            position: 'relative',
          }}
        >
          {coverUri ? (
            <img src={cachedCover || coverUri} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 48, color: 'var(--color-text-muted)' }}>♪</span>
            </div>
          )}
        </div>

        {/* Track info */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              color: 'var(--color-text-primary)',
              fontSize: 20,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: '26px',
            }}
          >
            {trackTitle}
          </div>
          <div
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 14,
              fontWeight: 500,
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {artistName}
          </div>
        </div>

        {/* Waveform / Progress */}
        <div style={{ marginBottom: 16 }}>
          <PlayerWaveform
            progress={progress}
            trackKey={trackKey}
            onSeek={seekTo}
            playedColor="var(--color-accent)"
            unplayedColor="var(--color-border-subtle)"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {currentTimeLabel}
            </span>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {totalTimeLabel}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <button
            onClick={toggleQueueMode}
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 'var(--radius-full)',
              color: shuffleColor,
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => { if (queueMode !== 'shuffle') e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { if (queueMode !== 'shuffle') e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <Shuffle size={18} />
          </button>

          <button
            onClick={() => hasPrev && void previous()}
            disabled={!hasPrev}
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: hasPrev ? 'pointer' : 'default',
              borderRadius: 'var(--radius-full)',
              color: 'var(--color-text-primary)',
              opacity: hasPrev ? 1 : 0.3,
              transition: 'all var(--transition-fast) ease',
            }}
          >
            <SkipBack size={22} />
          </button>

          <button
            onClick={togglePlayPause}
            style={{
              width: 56,
              height: 56,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: 'pointer',
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = 'var(--color-accent-light)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'var(--color-accent)'; }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; }}
          >
            {isLoading ? (
              <div className="loader-spinner" style={{ width: 20, height: 20, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
            ) : isPlaying ? (
              <Pause size={24} color="#fff" />
            ) : (
              <Play size={24} color="#fff" style={{ marginLeft: 2 }} />
            )}
          </button>

          <button
            onClick={() => hasNext && void next()}
            disabled={!hasNext}
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: hasNext ? 'pointer' : 'default',
              borderRadius: 'var(--radius-full)',
              color: 'var(--color-text-primary)',
              opacity: hasNext ? 1 : 0.3,
              transition: 'all var(--transition-fast) ease',
            }}
          >
            <SkipForward size={22} />
          </button>

          <button
            onClick={toggleRepeat}
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 'var(--radius-full)',
              color: repeatColor,
              transition: 'all var(--transition-fast) ease',
              position: 'relative',
            }}
            onMouseEnter={(e) => { if (repeatMode === 'off') e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { if (repeatMode === 'off') e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            {React.createElement(repeatIcon, { size: 18 })}
          </button>
        </div>

        {/* Lyrics toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          {showLyricsControls && (
            <button
              onClick={() => setLyricsMode((p) => (p === 'hidden' ? 'compact' : 'hidden'))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 'var(--radius-full)',
                border: 'none',
                background: lyricsMode !== 'hidden' ? 'var(--color-surface-elevated)' : 'transparent',
                cursor: 'pointer',
                color: lyricsMode !== 'hidden' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = lyricsMode !== 'hidden' ? 'var(--color-accent)' : 'var(--color-text-secondary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = lyricsMode !== 'hidden' ? 'var(--color-surface-elevated)' : 'transparent'; e.currentTarget.style.color = lyricsMode !== 'hidden' ? 'var(--color-accent)' : 'var(--color-text-muted)'; }}
            >
              <TextQuote size={16} />
              <span>Paroles</span>
            </button>
          )}
        </div>

        {/* Lyrics content */}
        {lyricsMode !== 'hidden' && showLyricsControls && currentTrack && (
          <div
            style={{
              backgroundColor: 'var(--color-surface-elevated)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              marginBottom: 16,
              minHeight: 80,
            }}
          >
            <FullPlayerLyrics
              lyricsUrl={currentTrack.lyrics_url || null}
              trackId={currentTrack.id}
              currentTime={progress * duration}
              isPlaying={isPlaying}
              compact
            />
          </div>
        )}

        {/* About artist */}
        {effectiveMode === 'online' && !isDeviceMode && album && (
          <div style={{ marginTop: 8 }}>
            <h3
              style={{
                color: 'var(--color-text-muted)',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                margin: '0 0 12px',
              }}
            >
              À propos de l'artiste
            </h3>
            <button
              onClick={() => {
                if (album.artist_id) {
                  navigate(`/artist/${album.artist_id}`);
                  setFullPlayerVisible(false);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                backgroundColor: 'transparent',
                borderRadius: 'var(--radius-sm)',
                padding: 8,
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                transition: 'background-color var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <img
                src={cachedArtistPic || album.artist?.profile_picture_url || album.artist_pdp || album.cover_url || undefined}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-full)',
                  objectFit: 'cover',
                  backgroundColor: 'var(--color-surface-elevated)',
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {artistName}
                </p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, margin: '2px 0 0' }}>
                  Artiste
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Up next */}
        {upcomingTracks.length > 0 && (
          <div style={{ marginTop: 24, marginBottom: 12 }}>
            <h3 style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
              À suivre ({upcomingTracks.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {upcomingTracks.slice(0, 10).map((item, index) => {
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: isActive ? 'var(--color-surface-elevated)' : 'transparent',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      transition: 'background-color var(--transition-fast) ease',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, minWidth: 18, textAlign: 'center' }}>
                      {index + 1}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)', fontSize: 13, fontWeight: 600, margin: 0, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(item as { title: string }).title}
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
      </div>

      {/* Queue Modal */}
      {queueModalVisible && (
        <div
          onClick={() => setQueueModalVisible(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            ref={queueRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px 24px 28px',
              maxHeight: '75%',
              width: '90%',
              maxWidth: 460,
              overflowY: 'auto',
              boxShadow: 'var(--shadow-xl)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottom: '1px solid var(--color-border-subtle)', marginBottom: 16 }}>
              <h3 style={{ color: 'var(--color-text-primary)', fontSize: 16, fontWeight: 700, margin: 0 }}>
                File d'attente
              </h3>
              <button
                onClick={() => setQueueModalVisible(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-full)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Now playing */}
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
                En cours
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-surface-elevated)' }}>
                <Volume2 size={16} color="var(--color-accent)" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, margin: 0, lineHeight: '18px' }}>
                    {isDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title}
                  </p>
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 500, margin: '2px 0 0' }}>
                    {isDeviceMode ? deviceCurrentTrack!.artist : formatAlbumArtist(queueAlbums[currentIdx] ?? album ?? undefined)}
                  </p>
                </div>
              </div>
            </div>

            {/* Up next */}
            <p style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', margin: '16px 0 12px' }}>
              À suivre ({upcomingTracks.length})
            </p>
            {upcomingTracks.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '16px 0' }}>
                Aucun autre titre dans la file.
              </p>
            ) : (
              upcomingTracks.map((item, index) => {
                const originalIndex = currentIdx + 1 + index;
                const rowArtist = isDeviceMode
                  ? (item as { artist?: string }).artist ?? 'Artiste inconnu'
                  : formatAlbumArtist(queueAlbums[originalIndex] ?? album ?? undefined);
                return (
                  <button
                    key={`${(item as { id: string }).id}-${originalIndex}`}
                    onClick={() => {
                      if (isDeviceMode) void playDeviceTrackAtIndex(deviceQueue, originalIndex);
                      else void playTrackAtIndex(originalIndex);
                      setQueueModalVisible(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      transition: 'background-color var(--transition-fast) ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, minWidth: 20, textAlign: 'center' }}>
                      {index + 1}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, margin: 0, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(item as { title: string }).title}
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
    </aside>
  );
}
