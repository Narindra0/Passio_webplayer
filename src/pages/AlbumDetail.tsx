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
import {
  ChevronLeft, Crown, Download, Lock, Pause, Play, Share2,
  ShieldCheck, ShoppingBag, Sparkles, Clock,
} from 'lucide-react';
import { ShareCard } from '@/components/ShareCard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hasFeatArtists, parseFeatArtists } from '@/utils/featArtists';
import { FeatArtistLinks } from '@/components/FeatArtistLinks';
import { getApiBaseUrl } from '@/services/api';
import { prefetchTrackBlob } from '@/services/audio';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
  const [shareModalVisible, setShareModalVisible] = useState(false);
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

  const priceDisplay = album.price_ariary > 0
    ? `${album.price_ariary.toLocaleString()} Ar`
    : null;

  const totalDuration = sortedTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalDurationLabel = formatDuration(totalDuration);

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
        {/* ========== HERO — Album Header ========== */}
        <div className="album-hero"
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
          <button className="album-back"
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
          <div className="album-cover"
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

          {/* Album Info + CTA */}
          <div className="album-info" style={{ flex: 1, paddingBottom: 8 }}>
            {/* Type badge + premium/free */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                {album.type === 'single' ? 'Single' : 'Album'}
              </span>
              {!isFreeRelease && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(255,215,0,0.12)',
                  border: '1px solid rgba(255,215,0,0.2)',
                }}>
                  <Crown size={10} color="#FFD700" />
                  <span style={{ color: '#FFD700', fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                    Premium
                  </span>
                </div>
              )}
              {isFreeRelease && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(29, 185, 84, 0.1)',
                  border: '1px solid rgba(29, 185, 84, 0.2)',
                }}>
                  <Sparkles size={10} color="#1DB954" />
                  <span style={{ color: '#1DB954', fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                    Gratuit
                  </span>
                </div>
              )}
            </div>

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

            {/* Artist + metadata */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {artistName}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>·</span>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 14, fontWeight: 500 }}>
                {album.tracks?.length ?? 0} titres
              </span>
              {totalDuration > 0 && (
                <>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>·</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {totalDurationLabel}
                  </span>
                </>
              )}
            </div>

            {/* Status badges */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {isOwned && !isFreeRelease && (
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
              {isOfflineReady && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(29, 185, 84, 0.1)',
                  border: '1px solid rgba(29, 185, 84, 0.2)',
                }}>
                  <Download size={12} color="var(--color-success)" />
                  <span style={{ color: 'var(--color-success)', fontSize: 12, fontWeight: 600 }}>
                    Hors-ligne
                  </span>
                </div>
              )}
            </div>

            {/* CTA Buttons — directement dans le hero */}
            <div className="album-cta-row" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* Play all */}
              {canPlay && sortedTracks.length > 0 && (
                <button
                  onClick={() => void handlePressTrack(sortedTracks[0], 0)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 24px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--color-accent)',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    transition: 'all var(--transition-fast) ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.background = 'var(--color-accent-light)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'var(--color-accent)'; }}
                >
                  <Play size={18} fill="#fff" />
                  Tout écouter
                </button>
              )}

              {/* Buy button — for paid & not owned */}
              {isPaidNotOwned && priceDisplay && (
                <a
                  href={getPurchaseAlbumUrl(album.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 24px',
                    borderRadius: 'var(--radius-full)',
                    background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#000',
                    fontSize: 14,
                    fontWeight: 800,
                    textDecoration: 'none',
                    transition: 'all var(--transition-fast) ease',
                    boxShadow: '0 4px 16px rgba(255,215,0,0.25)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(255,215,0,0.35)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(255,215,0,0.25)'; }}
                >
                  <ShoppingBag size={18} />
                  Acheter — {priceDisplay}
                </a>
              )}

              {/* Already have a PassCode */}
              {isPaidNotOwned && (
                <button
                  onClick={() => navigate('/activate')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '10px 20px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                    fontSize: 13,
                    fontWeight: 600,
                    transition: 'all var(--transition-fast) ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                >
                  <Lock size={14} />
                  J'ai un PassCode
                </button>
              )}

              {/* Download button — for owned but not offline */}
              {isOwned && !isOfflineReady && downloadProgress?.status !== 'downloading' && (
                <button
                  onClick={handleDownload}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 24px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border-subtle)',
                    cursor: 'pointer',
                    color: 'var(--color-text-primary)',
                    fontSize: 14,
                    fontWeight: 600,
                    transition: 'all var(--transition-fast) ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; }}
                >
                  <Download size={18} />
                  Télécharger
                </button>
              )}

              {/* Share button */}
              <button
                onClick={() => setShareModalVisible(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 24px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-subtle)',
                  cursor: 'pointer',
                  color: 'var(--color-text-secondary)',
                  fontSize: 14,
                  fontWeight: 600,
                  transition: 'all var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              >
                <Share2 size={18} />
                Partager
              </button>
            </div>

          </div>
        </div>

        {/* ========== TRACKLIST ========== */}
        <div className="album-tracklist" style={{ padding: '24px 32px 32px' }}>
          {/* Track list header */}
          {sortedTracks.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '0 12px 10px',
              borderBottom: '1px solid var(--color-border-subtle)',
              marginBottom: 4,
            }}>
              <span style={{ width: 24, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textAlign: 'center' }}>#</span>
              <span style={{ flex: 1, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Titre
              </span>
              <span style={{ width: 40, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <Clock size={13} />
              </span>
            </div>
          )}

          {/* Track rows */}
          {sortedTracks.map((track, index) => {
            const isCurrent = audio.currentTrack?.id === track.id;
            const isThisPlaying = isCurrent && audio.isPlaying;
            const featResult = hasFeatArtists(track.title) ? parseFeatArtists(track.title) : null;
            // Solution C: Préchargement de la piste au survol pour une lecture instantanée
            const prefetchOnHover = () => {
              const trackProxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(track.id)}/audio`;
              prefetchTrackBlob(trackProxyUrl, track.id);
            };
            return (
              <button className="album-track"
                key={track.id}
                onClick={() => void handlePressTrack(track, index)}
                disabled={!canPlay && !isPaidNotOwned}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  width: '100%',
                  background: isCurrent ? 'var(--color-accent-soft)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: canPlay || isPaidNotOwned ? 'pointer' : 'default',
                  textAlign: 'left',
                  opacity: !canPlay && !isPaidNotOwned ? 0.5 : 1,
                  transition: 'background-color var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => {
                  prefetchOnHover();
                  if (!isCurrent && (canPlay || isPaidNotOwned)) e.currentTarget.style.background = 'var(--color-surface-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) e.currentTarget.style.background = 'transparent';
                }}
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
                    <span style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 13,
                      fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
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
                  }}
                    title={track.title}
                  >
                    {featResult ? featResult.cleanTitle : track.title}
                  </p>
                  <p style={{
                    color: isCurrent ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                    fontSize: 12,
                    lineHeight: '16px',
                    margin: '1px 0 0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {artistName}
                    {featResult && (
                      <FeatArtistLinks featNames={featResult.featNames} style={{ fontSize: 11 }} />
                    )}
                  </p>
                </div>

                {/* Duration + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {isPaidNotOwned ? (
                    <Lock size={13} color="var(--color-text-muted)" style={{ opacity: 0.5 }} />
                  ) : isThisPlaying ? (
                    <Pause size={14} color="var(--color-accent)" />
                  ) : isCurrent ? (
                    <Play size={14} color="var(--color-accent)" />
                  ) : null}
                  {track.duration != null && track.duration > 0 && (
                    <span style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 12,
                      fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: 36,
                      textAlign: 'right',
                    }}>
                      {formatDuration(track.duration)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* ========== DOWNLOAD SECTION ========== */}
        {isOwned && !isOfflineReady && downloadProgress?.status === 'downloading' && (
          <div className="album-section" style={{ margin: '0 32px 24px' }}>
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
          </div>
        )}

        {/* ========== ERROR ========== */}
        {actionError && (
          <div className="album-section" style={{ margin: '0 32px 24px', padding: 12, borderRadius: 'var(--radius-sm)', background: 'rgba(233, 20, 41, 0.1)', border: '1px solid rgba(233, 20, 41, 0.2)' }}>
            <p style={{ color: 'var(--color-error)', fontSize: 13, lineHeight: '18px', margin: 0 }}>{actionError}</p>
          </div>
        )}
      </div>

      {/* Share Modal */}
      <ShareCard
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        trackTitle={album.title}
        artistName={artistName}
        coverUri={album.cover_url}
        albumId={album.id}
      />
    </Screen>
  );
}
