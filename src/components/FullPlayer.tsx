import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  List, Shuffle, SkipBack, SkipForward, Play, Pause,
  Repeat, Repeat1, Infinity, TextQuote, Volume2, X, ChevronLeft,
} from 'lucide-react';
import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { PlayerWaveform } from './PlayerWaveform';
import { FullPlayerLyrics } from './FullPlayerLyrics';
import type { PublicAlbumDetails } from '@/types/backend';

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
  const repeatColor = repeatMode === 'off' ? 'rgba(255,255,255,0.38)' : 'var(--color-accent)';
  const shuffleColor = queueMode === 'shuffle' ? 'var(--color-accent)' : 'rgba(255,255,255,0.38)';
  const trackKey = isDeviceMode ? deviceCurrentTrack!.id : currentTrack!.id;

  const fullQueue = isDeviceMode ? deviceQueue : queue;
  const currentIdx = isDeviceMode ? deviceCurrentIndex : currentIndex;
  const upcomingTracks = fullQueue.slice(Math.max(0, currentIdx + 1));

  return (
    <aside
      className="fullplayer"
      style={{
        width: 360,
        height: '100%',
        backgroundColor: '#111112',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Gradient Background */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '100%',
          background: coverUri
            ? `linear-gradient(180deg, rgba(120,0,0,0.04) 0%, transparent 30%, transparent 100%)`
            : undefined,
          pointerEvents: 'none',
        }}
      />

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 16px 8px',
          position: 'relative',
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setFullPlayerVisible(false)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'rgba(255,255,255,0.04)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.5)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
          >
            <ChevronLeft size={16} />
          </button>
          <span
            style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1.2px',
            }}
          >
            En cours
          </span>
        </div>
        <button
          onClick={() => setQueueModalVisible(true)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
        >
          <List size={18} />
        </button>
      </div>

      {/* Scrollable Content */}
      <div
        className="fullplayer-content"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 20px 20px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Cover Art */}
        <div
          className={`fullplayer-cover ${isPlaying ? 'cover-rotate playing' : 'cover-rotate'}`}
          style={{
            width: '100%',
            aspectRatio: '1',
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: '#1c1c1c',
            boxShadow: '0 16px 32px rgba(0,0,0,0.5)',
            marginBottom: 20,
            transform: isPlaying ? 'scale(1)' : 'scale(0.97)',
            transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
            position: 'relative',
          }}
        >
          {coverUri ? (
            <img src={coverUri} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 48, color: 'rgba(255,255,255,0.18)' }}>♪</span>
            </div>
          )}
        </div>

        {/* Track Info */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              color: '#fff',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: '-0.3px',
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
              color: 'rgba(255,255,255,0.55)',
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

        {/* Controls */}
        <div style={{ marginBottom: 16 }}>
          <PlayerWaveform progress={progress} trackKey={trackKey} onSeek={seekTo} playedColor="var(--color-primary-light)" unplayedColor="rgba(255,255,255,0.15)" />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, letterSpacing: '0.3px' }}>{currentTimeLabel}</span>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, letterSpacing: '0.3px' }}>{totalTimeLabel}</span>
          </div>
        </div>

        {/* Playback buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginBottom: 20,
            padding: '4px 0',
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
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 20,
              color: shuffleColor,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Shuffle size={18} />
          </button>

          <button
            onClick={() => hasPrev && void previous()}
            disabled={!hasPrev}
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: hasPrev ? 'pointer' : 'default',
              borderRadius: 22,
              color: '#fff',
              opacity: hasPrev ? 1 : 0.28,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { if (hasPrev) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <SkipBack size={22} />
          </button>

          <button
            onClick={togglePlayPause}
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: 'pointer',
              transition: 'transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)',
              boxShadow: isPlaying 
                ? '0 0 20px rgba(255,255,255,0.2)' 
                : '0 0 0px rgba(255,255,255,0)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(255,255,255,0.25)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = isPlaying ? '0 0 20px rgba(255,255,255,0.2)' : 'none'; }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.94)'; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; }}
          >
            {isPlaying ? (
              <Pause size={28} color="#0a0a0a" />
            ) : (
              <Play size={28} color="#0a0a0a" style={{ marginLeft: 3 }} />
            )}
          </button>

          <button
            onClick={() => hasNext && void next()}
            disabled={!hasNext}
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              cursor: hasNext ? 'pointer' : 'default',
              borderRadius: 22,
              color: '#fff',
              opacity: hasNext ? 1 : 0.28,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { if (hasNext) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
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
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 20,
              color: repeatColor,
              transition: 'all 0.15s ease',
              position: 'relative',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {React.createElement(repeatIcon, { size: 18 })}
          </button>
        </div>

        {/* Lyrics button & about artist */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          {showLyricsControls && (
            <button
              onClick={() => setLyricsMode((p) => p === 'hidden' ? 'compact' : 'hidden')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: lyricsMode !== 'hidden' ? 'rgba(120,0,0,0.15)' : 'rgba(255,255,255,0.04)',
                cursor: 'pointer',
                color: lyricsMode !== 'hidden' ? 'var(--color-accent)' : 'rgba(255,255,255,0.5)',
                fontSize: 12,
                fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = lyricsMode !== 'hidden' ? 'rgba(120,0,0,0.2)' : 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = lyricsMode !== 'hidden' ? 'rgba(120,0,0,0.15)' : 'rgba(255,255,255,0.04)'; }}
            >
              <TextQuote size={14} />
              <span>Paroles</span>
            </button>
          )}
        </div>

        {/* Lyrics (compact) */}
        {lyricsMode !== 'hidden' && showLyricsControls && currentTrack && (
          <div
            style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              borderRadius: 10,
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

        {/* About Artist */}
        {effectiveMode === 'online' && !isDeviceMode && album && (
          <div style={{ marginTop: 8 }}>
            <h3
              style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1.2px',
                marginBottom: 10,
                margin: '0 0 10px 0',
              }}
            >
              À propos de l'artiste
            </h3>
            <button
              onClick={() => { if (album.artist_id) { navigate(`/artist/${album.artist_id}`); setFullPlayerVisible(false); } }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderRadius: 10,
                padding: 12,
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
            >
              <img
                src={album.artist?.profile_picture_url || album.artist_pdp || album.cover_url || undefined}
                alt=""
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  backgroundColor: '#2a2a2a',
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <p style={{ color: '#fff', fontSize: 14, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artistName}</p>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 500, margin: '3px 0 0 0' }}>Artiste</p>
              </div>
            </button>
          </div>
        )}

        {/* Queue Section (inline in right panel) */}
        {upcomingTracks.length > 0 && (
          <div style={{ marginTop: 20, marginBottom: 12 }}>
            <h3
              style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1.2px',
                margin: '0 0 10px 0',
              }}
            >
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
                      padding: '8px 8px',
                      borderRadius: 8,
                      border: 'none',
                      background: isActive ? 'rgba(120,0,0,0.1)' : 'transparent',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, fontWeight: 600, minWidth: 16, textAlign: 'center' }}>
                      {index + 1}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: isActive ? 'var(--color-accent)' : 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500, margin: 0, lineHeight: '17px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(item as { title: string }).title}
                      </p>
                      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 400, margin: '2px 0 0 0', lineHeight: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

      {/* Queue Modal (overlay) */}
      {queueModalVisible && (
        <div
          onClick={() => setQueueModalVisible(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            ref={queueRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#1c1c1e',
              borderRadius: 16,
              padding: '16px 20px 24px',
              maxHeight: '70%',
              width: '90%',
              maxWidth: 480,
              overflowY: 'auto',
              boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 12,
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                marginBottom: 10,
              }}
            >
              <h3 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0 }}>File d'attente</h3>
              <button onClick={() => setQueueModalVisible(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(255,255,255,0.5)' }}>
                <X size={20} />
              </button>
            </div>

            {/* Current track */}
            <div style={{ marginBottom: 8 }}>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>En cours</p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: 'rgba(120,0,0,0.08)',
                  border: '1px solid rgba(120,0,0,0.15)',
                }}
              >
                <div style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Volume2 size={14} color="var(--color-accent)" />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ color: 'var(--color-accent)', fontSize: 14, fontWeight: 600, margin: 0, lineHeight: '18px' }}>
                    {isDeviceMode ? deviceCurrentTrack!.title : currentTrack!.title}
                  </p>                    <p style={{ color: 'rgba(120,0,0,0.6)', fontSize: 12, fontWeight: 400, margin: '2px 0 0 0' }}>
                    {isDeviceMode ? deviceCurrentTrack!.artist : formatAlbumArtist(queueAlbums[currentIdx] ?? album ?? undefined)}
                  </p>
                </div>
              </div>
            </div>

            {/* Upcoming */}
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', margin: '12px 0 8px' }}>
              À suivre ({upcomingTracks.length})
            </p>
            {upcomingTracks.length === 0 ? (
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Aucun autre titre dans la file.</p>
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
                      padding: '9px 10px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, fontWeight: 600, minWidth: 20, textAlign: 'center' }}>{index + 1}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: 500, margin: 0, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(item as { title: string }).title}
                      </p>
                      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 400, margin: '2px 0 0 0', lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
