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
    Share2, TextQuote, Volume2, Volume1, Volume, VolumeX, X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FullPlayerLyrics } from './FullPlayerLyrics';
import { PlayerWaveform } from './PlayerWaveform';
import { ShareCard } from './ShareCard';
import { hasFeatArtists, parseFeatArtists } from '@/utils/featArtists';
import { FeatArtistLinks } from './FeatArtistLinks';
import { listAlbums } from '@/services/api';
import { useMediaQuery } from '@/hooks/useMediaQuery';

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
  } = useAudioPlayback();
  const { progress, duration } = useAudioProgress();
  const [lyricsModalVisible, setLyricsModalVisible] = useState(false);
  const [queueModalVisible, setQueueModalVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const queueRef = useRef<HTMLDivElement>(null);
  // État pour stocker le dictionnaire enrichi nom→ID depuis TOUS les albums (API)
  const [globalArtistIdMap, setGlobalArtistIdMap] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    setLyricsModalVisible(false);
  }, [currentTrack?.id, deviceCurrentTrack?.id]);

  // Charger TOUS les albums pour construire un dictionnaire nom→ID
  // (artist_id est REQUIS dans l'API, mais artist_name et artist.id sont optionnels !)
  // On fait une union des sources : nom = artist_name || artist?.name, id = artist_id || artist?.id
  useEffect(() => {
    let cancelled = false;
    async function loadAllAlbums() {
      try {
        const albums = await listAlbums();
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const a of albums) {
          // Combiner les sources: nom = artist_name (plat) OU artist.name (imbriqué)
          //               id  = artist_id (REQUIRED) OU artist.id (imbriqué)
          const name = a.artist_name || a.artist?.name;
          const id = a.artist_id || a.artist?.id;
          if (name && id) {
            map[name.trim().toLowerCase()] = id;
          }
          // Tableau artists[] (feat artists déjà côté serveur)
          if (a.artists) {
            for (const art of a.artists) {
              if (art.id && art.name) {
                map[art.name.trim().toLowerCase()] = art.id;
              }
            }
          }
        }
        console.log('[FullPlayer] Global artist map:', Object.keys(map).length, 'artists. Balz →', map['balz'], '| Keys:', Object.keys(map).sort().join(', '));
        if (!cancelled) setGlobalArtistIdMap(map);
      } catch (err) {
        console.warn('[FullPlayer] listAlbums failed:', err);
      }
    }
    void loadAllAlbums();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lyricsModalVisible) setLyricsModalVisible(false);
        else if (queueModalVisible) setQueueModalVisible(false);
        else setFullPlayerVisible(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lyricsModalVisible, queueModalVisible, setFullPlayerVisible]);

  const isMobile = useMediaQuery('(max-width: 768px)');
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
  // Construire un dictionnaire nom→ID fusionné :
  // - Données de l'album courant (déjà chargées)
  // - Données globales chargées depuis listAlbums() (comble les trous)
  const localArtistIdMap = useMemo(() => {
    const map: Record<string, string> = {};

    // 1. Album courant : combiner name (artist_name || artist?.name) + id (artist_id || artist?.id)
    if (album) {
      const name = album.artist_name || album.artist?.name;
      const id = album.artist_id || album.artist?.id;
      if (name && id) {
        map[name.trim().toLowerCase()] = id;
      }
      // Tableau artists[] (inclut les feat artists du serveur)
      if (album.artists) {
        for (const a of album.artists) {
          if (a.name && a.id) {
            map[a.name.trim().toLowerCase()] = a.id;
          }
        }
      }
    }

    // 2. Fusionner avec les données globales (comble les artistes manquants)
    if (globalArtistIdMap) {
      for (const [name, id] of Object.entries(globalArtistIdMap)) {
        if (!map[name]) {
          map[name] = id;
        }
      }
    }

    return map;
  }, [album, globalArtistIdMap]);

  // Filtrer les feat artists qui existent dans la plateforme (artiste connu avec ID)
  const knownFeatArtists = useMemo(() => {
    return featNames
      .map((n: string) => ({ name: n, artistId: localArtistIdMap[n.trim().toLowerCase()] ?? null }))
      .filter((item): item is { name: string; artistId: string } => item.artistId !== null);
  }, [featNames, localArtistIdMap]);

  // Tous les feat artists (même sans ID connu) — pour l'affichage dans la section Artistes
  const allFeatArtists = useMemo(() => {
    return featNames.map((n: string) => ({
      name: n,
      artistId: localArtistIdMap[n.trim().toLowerCase()] ?? null,
    }));
  }, [featNames, localArtistIdMap]);

  const coverColors = useAlbumColors(coverUri);
  const cachedCover = useCachedImage(coverUri);
  const cachedArtistPic = useCachedImage(album?.artist?.profile_picture_url || album?.artist_pdp || null);

  const fullQueue = isDeviceMode ? deviceQueue : queue;
  const currentIdx = isDeviceMode ? deviceCurrentIndex : currentIndex;
  // Éviter d'afficher toutes les pistes comme "À suivre" quand rien n'est joué (currentIdx === -1)
  const upcomingTracks = currentIdx >= 0 ? fullQueue.slice(currentIdx + 1) : [];

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
                  fontSize: 20,
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: '26px',
                }}
                title={rawTitle}
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
                {featNames.length > 0 && (
                  <FeatArtistLinks featNames={featNames} artistIdMap={localArtistIdMap} />
                )}
              </div>
            </div>
            {showLyricsControls && (
              <button
                onClick={() => setLyricsModalVisible(true)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--color-border-subtle)',
                  background: 'var(--color-surface-elevated)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-accent)',
                  flexShrink: 0,
                  marginTop: 2,
                  transition: 'all var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-soft)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.borderColor = 'var(--color-border-subtle)'; }}
                title="Afficher les paroles"
              >
                <TextQuote size={16} />
              </button>
            )}
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

        {/* Volume slider — desktop only */}
        {!isMobile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-elevated)',
            }}
          >
            <button
              onClick={toggleMute}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: isMuted ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                transition: 'color var(--transition-fast) ease',
                flexShrink: 0,
              }}
              title={isMuted ? 'Activer le son' : 'Couper le son'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX size={16} />
              ) : volume < 0.5 ? (
                <Volume size={16} />
              ) : volume < 0.8 ? (
                <Volume1 size={16} />
              ) : (
                <Volume2 size={16} />
              )}
            </button>
            <div
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: 'var(--color-border-subtle)',
                cursor: 'pointer',
                position: 'relative',
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                setVolume(x / rect.width);
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(isMuted ? 0 : volume) * 100}%`,
                  background: 'var(--color-accent)',
                  borderRadius: 3,
                  transition: 'width 0.08s linear',
                }}
              />
            </div>
            <span
              style={{
                color: 'var(--color-text-muted)',
                fontSize: 11,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                minWidth: 32,
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              {isMuted ? '0%' : `${Math.round(volume * 100)}%`}
            </span>
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
              Artistes
            </h3>
            {/* Artiste principal */}
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
                  Artiste principal
                </p>
              </div>
            </button>

            {/* Artistes feat — toujours affichés, avec lien si trouvé dans la plateforme */}
            {allFeatArtists.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {allFeatArtists.map(({ name, artistId }: { name: string; artistId: string | null }) => (
                  <button
                    key={name}
                    onClick={() => {
                      if (artistId) {
                        navigate(`/artist/${artistId}`);
                        setFullPlayerVisible(false);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      backgroundColor: 'transparent',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 8px 8px 12px',
                      border: 'none',
                      cursor: artistId ? 'pointer' : 'default',
                      width: '100%',
                      textAlign: 'left',
                      transition: 'background-color var(--transition-fast) ease',
                      opacity: artistId ? 1 : 0.6,
                    }}
                    onMouseEnter={(e) => {
                      if (artistId) e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {/* Avatar par défaut pour feat */}
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Volume2 size={18} color={artistId ? 'var(--color-text-muted)' : 'var(--color-text-muted)'} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{
                        color: artistId ? 'var(--color-accent)' : 'var(--color-text-primary)',
                        fontSize: 14,
                        fontWeight: 600,
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {name}
                      </p>
                    </div>
                    {/* Badge feat — toujours affiché */}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        color: 'var(--color-accent)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        background: 'var(--color-accent-soft)',
                        border: '1px solid var(--color-accent)',
                        flexShrink: 0,
                      }}
                    >
                      Feat.
                    </span>
                  </button>
                ))}
              </div>
            )}
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

      {/* Lyrics Modal — Spotify-style overlay */}
      {showLyricsControls && lyricsModalVisible && (
        <div
          onClick={() => setLyricsModalVisible(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'transparent',
              position: 'relative',
            }}
          >
            {/* Modal header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 24px',
                flexShrink: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {trackTitle}
                </p>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 500, margin: '2px 0 0' }}>
                  {artistName}
                </p>
              </div>
              <button
                onClick={() => setLyricsModalVisible(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  flexShrink: 0,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Lyrics content — scrollable, centered */}
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
