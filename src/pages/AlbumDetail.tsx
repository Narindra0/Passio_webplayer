import { LyricsDisplay } from '@/components/LyricsDisplay';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { getPurchaseAlbumUrl } from '@/config/urls';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { albumHasStreamableTracks, loadOwnedAlbumForPlayback, resolveAlbumDecryptionKey } from '@/services/albumOwnership';
import { downloadAlbumWithStreaming, getDownloadProgress, isAlbumReadyOffline, subscribeToDownloadProgress, type DownloadProgress } from '@/services/downloadManager';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import type { PublicAlbumDetails, PublicTrack } from '@/types/backend';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { CheckCircle, ChevronLeft, Download, Lock, Pause, Play, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export function AlbumDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const audio = useAudioPlayback();
  const { progress, duration } = useAudioProgress();
  const { effectiveMode } = useLibraryMode();

  const [album, setAlbum] = useState<PublicAlbumDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [decryptionKey, setDecryptionKey] = useState<string | null>(null);
  const [ownedByDevice, setOwnedByDevice] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isOfflineReady, setIsOfflineReady] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Call all hooks BEFORE any early returns
  const cachedCover = useCachedImage(album?.cover_url);
  const coverColors = useAlbumColors(album?.cover_url);

  const loadAlbumData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const offline = await resolveOfflinePlayback(id);
    if (offline.metadata) {
      setAlbum(offline.metadata);
      setDecryptionKey(offline.decryptionKey);
      setOwnedByDevice(true);
      const ready = await isAlbumReadyOffline(id);
      setIsOfflineReady(ready);
      setLoading(false);
      if (effectiveMode === 'offline') return;
    }
    try {
      const loaded = await loadOwnedAlbumForPlayback(id);
      setOwnedByDevice(loaded.ownedByDevice);
      setAlbum(loaded.album);
      setDecryptionKey(loaded.decryptionKey);
      const ready = await isAlbumReadyOffline(id);
      setIsOfflineReady(ready);
    } catch { /* ignore */ }
    setLoading(false);
  }, [id, effectiveMode]);

  useEffect(() => {
    void loadAlbumData();
    if (id) {
      unsubscribeRef.current = subscribeToDownloadProgress(id, (p) => {
        setDownloadProgress(p);
        if (p.status === 'completed') setIsOfflineReady(true);
      });
      const existing = getDownloadProgress(id);
      if (existing) { setDownloadProgress(existing); if (existing.status === 'completed') setIsOfflineReady(true); }
    }
    return () => { if (unsubscribeRef.current) unsubscribeRef.current(); };
  }, [id, loadAlbumData]);

  if (loading) return <Screen><div className="flex justify-center items-center" style={{ minHeight: 300 }}><div className="loader-spinner" /></div></Screen>;
  if (!album) return <Screen><div className="flex flex-col items-center gap-4 p-10"><p className="text-muted">Album introuvable</p><button onClick={() => navigate(-1)} className="btn-secondary">Retour</button></div></Screen>;

  const isFreeRelease = Boolean(album.is_free);
  const streamReady = Boolean(isFreeRelease && album.stream_status === 'ready' && album.stream_url);
  const isOwned = ownedByDevice || Boolean(decryptionKey);
  const isPaidNotOwned = !isFreeRelease && !isOwned;
  const canPlay = (isFreeRelease && streamReady) || isOwned;
  const sortedTracks = [...(album.tracks || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';

  async function handlePressTrack(track: PublicTrack, index: number) {
    if (!canPlay || !album) return;
    setActionError(null);
    let playAlbum = album;
    let playKey = decryptionKey;
    if (isOwned && playAlbum && (!playKey || !albumHasStreamableTracks(playAlbum))) {
      const loaded = await loadOwnedAlbumForPlayback(playAlbum.id);
      playAlbum = loaded.album; playKey = loaded.decryptionKey;
      if (loaded.decryptionKey) setDecryptionKey(loaded.decryptionKey);
      setOwnedByDevice(loaded.ownedByDevice);
    }
    const isCurrentAlbum = audio.album?.id === playAlbum?.id;
    if (!isCurrentAlbum && playAlbum) audio.loadAlbum(playAlbum, playKey);
    if (audio.currentTrack?.id === track.id && isCurrentAlbum) { audio.togglePlayPause(); return; }
    if (!isCurrentAlbum) await new Promise(r => setTimeout(r, 50));
    try { await audio.playTrackAtIndex(index); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Impossible de lire ce titre.'); }
  }

  async function handleDownload() {
    if (!album) return;
    setActionError(null);
    const loaded = await loadOwnedAlbumForPlayback(album.id);
    const key = decryptionKey ?? loaded.decryptionKey ?? (await resolveAlbumDecryptionKey(album.id, null));
    if (key) setDecryptionKey(key);
    const status = await downloadAlbumWithStreaming(loaded.album, key, (track, index) => { if (!audio.isPlaying && audio.currentTrack?.id !== track.id) void audio.playTrackAtIndex(index); });
    if (status === 'completed') setIsOfflineReady(true);
    else if (status === 'error') setActionError(getDownloadProgress(album.id)?.error ?? 'Échec du téléchargement.');
  }

  return (
    <Screen padded={false}>
      <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
        {/* Hero Section — Spotify-style with dynamic color */}
        <div
          style={{
            position: 'relative',
            padding: '48px 32px 32px',
            background: coverColors.gradientStyle,
            transition: 'background 0.6s ease',
            display: 'flex',
            gap: 32,
            alignItems: 'flex-end',
          }}
        >
          {/* Back button */}
          <button
            onClick={() => navigate(-1)}
            style={{
              position: 'absolute',
              top: 20,
              left: 24,
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-full)',
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(8px)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 2,
              color: 'var(--color-text-primary)',
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.7)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)'; }}
          >
            <ChevronLeft size={22} />
          </button>

          {/* Album Cover */}
          <div
            style={{
              width: 200,
              height: 200,
              minWidth: 200,
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-xl)',
              marginTop: 20,
            }}
          >
            {album.cover_url ? (
              <img src={cachedCover || album.cover_url} alt={album.title} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'var(--color-surface-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 48, color: 'var(--color-text-muted)' }}>♪</span>
              </div>
            )}
          </div>

          {/* Album Info */}
          <div style={{ flex: 1, paddingBottom: 8 }}>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
              {album.type === 'single' ? 'Single' : 'Album'}
            </p>
            <h1 style={{
              color: 'var(--color-text-primary)',
              fontSize: 'clamp(28px, 4vw, 48px)',
              fontWeight: 800,
              letterSpacing: '-1px',
              lineHeight: 1.1,
              margin: '0 0 8px',
            }}>
              {album.title}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {artistName}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>·</span>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 14, fontWeight: 500 }}>
                {album.tracks?.length ?? 0} titres
              </span>
            </div>

            {/* Status badges */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              {isOwned && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(29, 185, 84, 0.1)',
                  border: '1px solid rgba(29, 185, 84, 0.2)',
                }}>
                  <ShieldCheck size={14} color="var(--color-success)" />
                  <span style={{ color: 'var(--color-success)', fontSize: 12, fontWeight: 600 }}>
                    {isOfflineReady ? 'Disponible hors-ligne' : 'Activé'}
                  </span>
                </div>
              )}
              {isFreeRelease && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-surface-elevated)',
                }}>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>
                    Gratuit
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Purchase section */}
        {isPaidNotOwned && (
          <div style={{
            margin: '24px 32px',
            padding: 24,
            background: 'var(--color-surface-elevated)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            alignItems: 'center',
          }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>
                Prix
              </p>
              <p style={{ color: 'var(--color-text-primary)', fontSize: 32, fontWeight: 800, margin: 0 }}>
                {album.price_ariary > 0 ? `${album.price_ariary.toLocaleString()} Ar` : 'Gratuit'}
              </p>
            </div>
            <a href={getPurchaseAlbumUrl(id!)} target="_blank" rel="noopener noreferrer" style={{ width: '100%', maxWidth: 300 }}>
              <PrimaryButton label="Acheter sur le Web" />
            </a>
            <button
              onClick={() => navigate('/activate')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer', padding: 6,
                color: 'var(--color-text-secondary)',
                fontSize: 13,
                fontWeight: 600,
                transition: 'color var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
            >
              <Lock size={14} />
              J'ai déjà un PassCode
            </button>
          </div>
        )}

        {/* Track list */}
        <div style={{ padding: '8px 32px 32px' }}>
          {/* Play all button */}
          {canPlay && sortedTracks.length > 0 && (
            <button
              onClick={() => void handlePressTrack(sortedTracks[0], 0)}
              style={{
                width: 48, height: 48,
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-accent)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                marginBottom: 20,
                transition: 'all var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = 'var(--color-accent-light)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'var(--color-accent)'; }}
            >
              <Play size={24} color="#fff" style={{ marginLeft: 2 }} />
            </button>
          )}

          {/* Track rows */}
          {sortedTracks.map((track, index) => {
            const isCurrent = audio.currentTrack?.id === track.id;
            const isThisPlaying = isCurrent && audio.isPlaying;
            return (
              <button
                key={track.id}
                onClick={() => void handlePressTrack(track, index)}
                disabled={!canPlay && !isPaidNotOwned}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '8px 12px',
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: canPlay ? 'pointer' : 'default',
                  textAlign: 'left',
                  opacity: !canPlay && !isPaidNotOwned ? 0.5 : 1,
                  transition: 'background-color var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { if (canPlay && !isCurrent) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                onMouseLeave={(e) => { if (canPlay && !isCurrent) e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Track number or play icon */}
                <div style={{ width: 24, textAlign: 'center', flexShrink: 0 }}>
                  {isThisPlaying ? (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16, justifyContent: 'center' }}>
                      <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                      <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                      <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                      <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                    </div>
                  ) : isCurrent ? (
                    <Play size={14} color="var(--color-accent)" />
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 14, fontWeight: 500 }}>
                      {index + 1}
                    </span>
                  )}
                </div>

                {/* Track info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    color: isCurrent ? 'var(--color-accent)' : 'var(--color-text-primary)',
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: '20px',
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {track.title}
                  </p>
                  <p style={{
                    color: isCurrent ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                    fontSize: 13,
                    lineHeight: '18px',
                    margin: '2px 0 0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {artistName}
                  </p>
                </div>

                {/* Action icon */}
                {isPaidNotOwned ? (
                  <Lock size={14} color="var(--color-text-muted)" />
                ) : isThisPlaying ? (
                  <Pause size={16} color="var(--color-accent)" />
                ) : isCurrent ? (
                  <Play size={16} color="var(--color-accent)" />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Download section */}
        {isOwned && !isOfflineReady && (
          <div style={{ margin: '0 32px 24px' }}>
            {downloadProgress?.status === 'downloading' ? (
              <div style={{
                padding: 16,
                background: 'var(--color-surface-elevated)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Download size={16} color="var(--color-text-muted)" />
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 600 }}>
                    Téléchargement... {Math.round(downloadProgress.progress)}%
                  </span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill accent" style={{ width: `${downloadProgress.progress}%` }} />
                </div>
              </div>
            ) : (
              <button
                onClick={handleDownload}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px 20px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-subtle)',
                  cursor: 'pointer',
                  width: 'auto',
                  color: 'var(--color-text-primary)',
                  fontSize: 14,
                  fontWeight: 600,
                  transition: 'all var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; }}
              >
                <Download size={18} />
                Télécharger hors-ligne
              </button>
            )}
          </div>
        )}

        {actionError && (
          <div style={{ margin: '0 32px 24px', padding: 12, borderRadius: 'var(--radius-sm)', background: 'rgba(233, 20, 41, 0.1)', border: '1px solid rgba(233, 20, 41, 0.2)' }}>
            <p style={{ color: 'var(--color-error)', fontSize: 13, lineHeight: '18px', margin: 0 }}>{actionError}</p>
          </div>
        )}
      </div>
    </Screen>
  );
}
