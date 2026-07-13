import { Screen } from '@/components/Screen';
import { getPurchaseAlbumUrl } from '@/config/urls';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { albumHasStreamableTracks, loadOwnedAlbumForPlayback, resolveAlbumDecryptionKey } from '@/services/albumOwnership';
import { isAlbumReadyOffline } from '@/services/downloadManager';
import { DownloadButton } from '@/components/DownloadButton';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import type { PublicAlbumDetails, PublicTrack } from '@/types/backend';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import {
  ChevronLeft, Crown, Download, Lock, Pause, Play, Share2,
  ShieldCheck, ShoppingBag, Sparkles, Clock, CloudOff,
} from 'lucide-react';
import { ShareCard } from '@/components/ShareCard';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getApiBaseUrl } from '@/services/api';
import { prefetchTrackBlob } from '@/services/audio';
import { logger } from '@/utils/logger';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';
import { formatTitle } from '@/utils/formatTitle';
import { isPreorder, formatPublicationDate } from '@/utils/preorder';
import { PreorderCountdown } from '@/components/PreorderCountdown';
import {
  getPrimaryTextColor,
  getSecondaryTextColor,
  getMutedTextColor,
  getBadgeBackground,
  getBadgeBorder,
} from '@/services/colorExtractor';

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
  const [isOfflineReady, setIsOfflineReady] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);

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
  }, [id, loadAlbumData]);

  // ⚡ Le DownloadButton gère lui-même l'état, la progression et la souscription

  // handleDownload est géré par DownloadButton — voir ci-dessous

  // ⚡ Mode offline : si l'album n'est pas en cache, afficher un écran fallback premium
  const isOfflineAndUnavailable = !loading && effectiveMode === 'offline' && !album;

  if (loading) return <Screen><div className="flex justify-center items-center" style={{ minHeight: 300 }}><div className="loader-spinner" /></div></Screen>;
  if (!album) return (
    <Screen>
      {isOfflineAndUnavailable ? (
        <div className="offline-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '90dvh',
            padding: '40px 24px',
            textAlign: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-full)',
              background: 'rgba(220,20,60,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 8,
            }}
          >
            <CloudOff size={36} color="var(--color-accent)" style={{ opacity: 0.7 }} />
          </div>
          <h2
            style={{
              fontSize: 'clamp(22px, 3vw, 28px)',
              fontWeight: 800,
              color: 'var(--color-text-primary)',
              margin: 0,
              letterSpacing: '-0.5px',
            }}
          >
            Album non disponible hors-ligne
          </h2>
          <p
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 15,
              lineHeight: '22px',
              maxWidth: 420,
              margin: '0 0 8px',
            }}
          >
            Cet album n'a pas été téléchargé sur votre appareil.
            Activez le mode en ligne ou téléchargez-le depuis le catalogue
            pour y accéder sans connexion.
          </p>
          <button
            onClick={() => navigate(-1)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 28px',
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
            <ChevronLeft size={18} />
            Retour
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 p-10">
          <p className="text-muted">Album introuvable</p>
          <button onClick={() => navigate(-1)} className="btn-secondary">Retour</button>
        </div>
      )}
    </Screen>
  );

  const isFreeRelease = Boolean(album.is_free);
  const streamReady = Boolean(isFreeRelease && album.stream_status === 'ready' && album.stream_url);
  const isOwned = ownedByDevice || Boolean(decryptionKey);
  const isPaidNotOwned = !isFreeRelease && !isOwned;
  const preordered = isPreorder(album.publication_date);
  const canPlay = !preordered && ((isFreeRelease && streamReady) || isOwned);
  const preorderReleaseDate = preordered && album.publication_date ? album.publication_date : null;
  const formattedReleaseDate = preorderReleaseDate ? formatPublicationDate(preorderReleaseDate) : null;
  const sortedTracks = [...(album.tracks || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';

  const priceDisplay = album.price_ariary > 0
    ? `${album.price_ariary.toLocaleString()} Ar`
    : null;

  const totalDuration = sortedTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalDurationLabel = formatDuration(totalDuration);
  const hasDuration = sortedTracks.some(t => t.duration != null && t.duration > 0);

  // Build artist lookup map from album.artists for clickable feat links
  const artistIdMap: Record<string, string> = {};
  if (album?.artists) {
    for (const a of album.artists) {
      if (a.name) artistIdMap[normalizeArtistName(a.name)] = a.id;
    }
  }
  // Also index the main artist
  if (album?.artist?.id && album?.artist?.name) {
    artistIdMap[normalizeArtistName(album.artist.name)] = album.artist.id;
  }

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

  return (
    <Screen padded={false}>
      {/* ========== HERO — Album Header (full width) ========== */}
      <div className="album-hero"
        style={{
          position: 'relative',
          padding: '60px 48px 40px',
          background: coverColors.gradientStyle,
          transition: 'background 0.6s ease',
          display: 'flex',
          gap: 40,
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
            width: 260,
            height: 260,
            minWidth: 260,
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
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
          {/* Type badge + premium/free — with dynamic colors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{
              color: getPrimaryTextColor(coverColors.colors, 'var(--color-text-secondary)'),
              fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px',
              opacity: 0.7,
            }}>
              {album.type === 'single' ? 'Single' : 'Album'}
            </span>
            {!isFreeRelease && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 10px',
                borderRadius: 'var(--radius-full)',
                background: getBadgeBackground(coverColors.colors, coverColors.colors?.isDark ?? true, true),
                border: `1px solid ${getBadgeBorder(coverColors.colors, coverColors.colors?.isDark ?? true, true)}`,
              }}>
                <Crown size={10} color="#FFD700" />
                <span style={{ color: '#FFD700', fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>Premium</span>
              </div>
            )}
            {isFreeRelease && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 10px',
                borderRadius: 'var(--radius-full)',
                background: coverColors.colors?.isDark === false
                  ? 'rgba(29,185,84,0.08)'
                  : 'rgba(29,185,84,0.1)',
                border: `1px solid ${coverColors.colors?.isDark === false ? 'rgba(29,185,84,0.15)' : 'rgba(29,185,84,0.2)'}`,
              }}>
                <Sparkles size={10} color="#1DB954" />
                <span style={{ color: '#1DB954', fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>Gratuit</span>
              </div>
            )}
          </div>

          <h1 style={{
            color: getPrimaryTextColor(coverColors.colors, 'var(--color-text-primary)'),
            fontSize: 'clamp(28px, 4vw, 56px)',
            fontWeight: 800,
            letterSpacing: '-1.5px',
            lineHeight: 1.08,
            margin: '0 0 12px',
          }}>
            {formatTitle(album.title)}
          </h1>

          {/* Artist + metadata — with dynamic colors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {(() => {
              const artistId = artistIdMap[normalizeArtistName(artistName)];
              const link = artistId ? `/artist/${artistId}` : null;
              const secColor = getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)');
              const priColor = getPrimaryTextColor(coverColors.colors, 'var(--color-text-primary)');
              return (
                <span
                  onClick={link ? (e) => { e.stopPropagation(); navigate(link); } : undefined}
                  style={{
                    color: secColor,
                    fontSize: 16,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    letterSpacing: '-0.3px',
                    cursor: link ? 'pointer' : 'default',
                    transition: 'color 0.15s ease',
                  }}
                  onMouseEnter={link ? (e) => { e.currentTarget.style.color = priColor; e.currentTarget.style.textDecoration = 'underline'; } : undefined}
                  onMouseLeave={link ? (e) => { e.currentTarget.style.color = secColor; e.currentTarget.style.textDecoration = 'none'; } : undefined}
                >
                  {artistName}
                </span>
              );
            })()}
            <span style={{ color: getMutedTextColor(coverColors.colors, 'var(--color-text-muted)'), fontSize: 14 }}>·</span>
            <span style={{ color: getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)'), fontSize: 15, fontWeight: 500 }}>
              {album.tracks?.length ?? 0} titre{(album.tracks?.length ?? 0) > 1 ? 's' : ''}
            </span>
            {totalDuration > 0 && (
              <>
                <span style={{ color: getMutedTextColor(coverColors.colors, 'var(--color-text-muted)'), fontSize: 14 }}>·</span>
                <span style={{ color: getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)'), fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {totalDurationLabel}
                </span>
              </>
            )}
          </div>

          {/* Status badges — dynamic on hero bg */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {isOwned && !isFreeRelease && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 12px',
                borderRadius: 'var(--radius-full)',
                background: coverColors.colors?.isDark === false
                  ? 'rgba(29,185,84,0.08)'
                  : 'rgba(29,185,84,0.1)',
                border: `1px solid ${coverColors.colors?.isDark === false ? 'rgba(29,185,84,0.15)' : 'rgba(29,185,84,0.2)'}`,
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
                background: coverColors.colors?.isDark === false
                  ? 'rgba(29,185,84,0.08)'
                  : 'rgba(29,185,84,0.1)',
                border: `1px solid ${coverColors.colors?.isDark === false ? 'rgba(29,185,84,0.15)' : 'rgba(29,185,84,0.2)'}`,
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
            {/* Play all / Disponible le — dynamic bg */}
            {preordered ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 24px',
                  borderRadius: 'var(--radius-full)',
                  background: coverColors.colors?.isDark === false
                    ? 'rgba(0,0,0,0.04)'
                    : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${
                    coverColors.colors?.isDark === false
                      ? 'rgba(0,0,0,0.08)'
                      : 'var(--color-border-subtle)'
                  }`,
                  color: getMutedTextColor(coverColors.colors, 'var(--color-text-muted)'),
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'default',
                  opacity: 0.6,
                }}
              >
                <Clock size={16} />
                Disponible le {formattedReleaseDate}
              </div>
            ) : canPlay && sortedTracks.length > 0 && (
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
                  background: preordered
                    ? 'linear-gradient(135deg, #8B0000, #DC143C)'
                    : 'linear-gradient(135deg, #FFD700, #FFA500)',
                  border: 'none',
                  cursor: 'pointer',
                  color: preordered ? '#fff' : '#000',
                  fontSize: 14,
                  fontWeight: 800,
                  textDecoration: 'none',
                  transition: 'all var(--transition-fast) ease',
                  boxShadow: preordered
                    ? '0 4px 16px rgba(220,20,60,0.25)'
                    : '0 4px 16px rgba(255,215,0,0.25)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = preordered ? '0 6px 24px rgba(220,20,60,0.35)' : '0 6px 24px rgba(255,215,0,0.35)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = preordered ? '0 4px 16px rgba(220,20,60,0.25)' : '0 4px 16px rgba(255,215,0,0.25)'; }}
              >
                <ShoppingBag size={18} />
                {preordered ? `Précommander — ${priceDisplay}` : `Acheter — ${priceDisplay}`}
              </a>
            )}

            {/* Already have a PassCode — dynamic bg */}
            {isPaidNotOwned && (
              <button
                onClick={() => navigate('/activate')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-full)',
                  background: coverColors.colors?.isDark === false
                    ? 'rgba(0,0,0,0.04)'
                    : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${
                    coverColors.colors?.isDark === false
                      ? 'rgba(0,0,0,0.08)'
                      : 'rgba(255,255,255,0.1)'
                  }`,
                  cursor: 'pointer',
                  color: getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)'),
                  fontSize: 13,
                  fontWeight: 600,
                  transition: 'all var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => {
                  if (coverColors.colors?.isDark === false) {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.08)';
                    e.currentTarget.style.color = '#111';
                  } else {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = 'var(--color-text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (coverColors.colors?.isDark === false) {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                    e.currentTarget.style.color = 'rgba(0,0,0,0.6)';
                  } else {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                  }
                }}
              >
                <Lock size={14} />
                J'ai un PassCode
              </button>
            )}

            {/* Download button — géré par le composant DownloadButton */}
            {(isOwned || isFreeRelease) && album && (
              <DownloadButton
                album={album}
                decryptionKey={decryptionKey}
                variant="full"
                onComplete={() => setIsOfflineReady(true)}
                onDelete={() => setIsOfflineReady(false)}
              />
            )}

            {/* Share button — dynamic for hero bg */}
            <button
              onClick={() => setShareModalVisible(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 24px',
                borderRadius: 'var(--radius-full)',
                background: coverColors.colors?.isDark === false
                  ? 'rgba(0,0,0,0.04)'
                  : 'var(--color-surface-elevated)',
                border: `1px solid ${
                  coverColors.colors?.isDark === false
                    ? 'rgba(0,0,0,0.1)'
                    : 'var(--color-border-subtle)'
                }`,
                cursor: 'pointer',
                color: getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)'),
                fontSize: 14,
                fontWeight: 600,
                transition: 'all var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => {
                if (coverColors.colors?.isDark === false) {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.08)';
                  e.currentTarget.style.color = '#111';
                } else {
                  e.currentTarget.style.background = 'var(--color-surface-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (coverColors.colors?.isDark === false) {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                  e.currentTarget.style.color = 'rgba(0,0,0,0.6)';
                } else {
                  e.currentTarget.style.background = 'var(--color-surface-elevated)';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }
              }}
            >
              <Share2 size={18} />
              Partager
            </button>
          </div>



        </div>
      </div>

      {/* ========== CONTENT (constrained width) ========== */}
      <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>

        {/* Pre-order countdown banner */}
        {preorderReleaseDate && (
          <div style={{ padding: '16px 48px 0' }}>
            <PreorderCountdown publicationDate={preorderReleaseDate} />
          </div>
        )}

        {/* ========== ALBUM DESCRIPTION ========== */}
        {album.description && (
          <div style={{
            padding: '32px 48px 24px',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}>
            <h3 style={{
              color: 'var(--color-text-muted)',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: 10,
            }}>
              À propos
            </h3>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: 15,
              lineHeight: '24px',
              margin: 0,
              maxWidth: 700,
            }}>
              {album.description}
            </p>
          </div>
        )}

        {/* ========== TRACKLIST ========== */}
        <div className="album-tracklist" style={{ padding: '28px 48px 40px' }}>
          {/* Track list header */}
          {sortedTracks.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '0 16px 12px',
              borderBottom: '1px solid var(--color-border-subtle)',
              marginBottom: 6,
            }}>
              <span style={{ width: 28, color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>#</span>
              <span style={{ flex: 1, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Titre
              </span>
              <span style={{ flex: '0 0 120px', color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center' }}>
                Artiste
              </span>
              {hasDuration && (
                <span style={{ width: 48, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Clock size={14} />
                </span>
              )}
            </div>
          )}

          {/* Track rows */}
          {sortedTracks.map((track, index) => {
            const isCurrent = audio.currentTrack?.id === track.id;
            const isThisPlaying = isCurrent && audio.isPlaying;
            const featResult = hasFeatArtists(track.title) ? parseFeatArtists(track.title) : null;
            // Solution C: Préchargement de la piste au survol pour une lecture instantanée
            const prefetchOnHover = () => {
              if (album.is_free) {
                const directUrl = track.encrypted_audio_url || track.preview_url;
                if (directUrl) {
                  logger.info('[AlbumDetail] Préchargement piste gratuite via Cloudflare:', directUrl);
                  fetch(directUrl, { method: 'HEAD' }).catch(() => { });
                  return;
                }
              }
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
                  gap: 16,
                  padding: '10px 16px',
                  width: '100%',
                  background: isCurrent ? 'var(--color-accent-soft)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: canPlay || isPaidNotOwned ? 'pointer' : 'default',
                  textAlign: 'left',
                  opacity: !canPlay && !isPaidNotOwned ? 0.5 : 1,
                  transition: 'background-color var(--transition-fast) ease, padding var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => {
                  prefetchOnHover();
                  if (!preordered && !isCurrent && (canPlay || isPaidNotOwned)) e.currentTarget.style.background = 'var(--color-surface-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) e.currentTarget.style.background = 'transparent';
                }}
              >
                {/* Track number or play icon */}
                <div style={{ width: 28, textAlign: 'center', flexShrink: 0 }}>
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
                    fontSize: 16,
                    fontWeight: 600,
                    lineHeight: '24px',
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                    title={track.title}
                  >
                    {formatTitle(featResult ? featResult.cleanTitle : track.title)}
                  </p>
                </div>

                {/* Artist column — main artist + feat artists with clickable links */}
                <div style={{ flex: '0 0 180px', minWidth: 0, fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {(() => {
                    const mainArtistId = artistIdMap[normalizeArtistName(artistName)];
                    const allArtists = featResult?.featNames?.length
                      ? [{ name: artistName, id: mainArtistId }, ...featResult.featNames.map(n => ({ name: n, id: artistIdMap[normalizeArtistName(n)] || null }))]
                      : [{ name: artistName, id: mainArtistId }];
                    return allArtists.map((item, i) => {
                      const isLast = i === allArtists.length - 1;
                      const link = item.id ? `/artist/${item.id}` : null;
                      return (
                        <span key={item.name}>
                          {link ? (
                            <span
                              onClick={(e) => { e.stopPropagation(); navigate(link); }}
                              style={{
                                color: 'var(--color-text-muted)',
                                cursor: 'pointer',
                                transition: 'color 0.15s ease',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.textDecoration = 'underline'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.textDecoration = 'none'; }}
                            >
                              {item.name}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)' }}>
                              {item.name}
                            </span>
                          )}
                          {!isLast && <span style={{ color: 'var(--color-text-muted)' }}>, </span>}
                        </span>
                      );
                    });
                  })()}
                </div>

                {/* Duration + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {preordered ? (
                    <Lock size={13} color="var(--color-accent)" style={{ opacity: 0.45 }} />
                  ) : isPaidNotOwned ? (
                    <Lock size={13} color="var(--color-text-muted)" style={{ opacity: 0.5 }} />
                  ) : isThisPlaying ? (
                    <Pause size={14} color="var(--color-accent)" />
                  ) : isCurrent ? (
                    <Play size={14} color="var(--color-accent)" />
                  ) : null}
                  {hasDuration && track.duration != null && track.duration > 0 && (
                    <span style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 13,
                      fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: 44,
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

        {/* ========== ERROR ========== */}
        {actionError && (
          <div className="album-section" style={{ margin: '0 48px 24px', padding: 12, borderRadius: 'var(--radius-sm)', background: 'rgba(233, 20, 41, 0.1)', border: '1px solid rgba(233, 20, 41, 0.2)' }}>
            <p style={{ color: 'var(--color-error)', fontSize: 13, lineHeight: '18px', margin: 0 }}>{actionError}</p>
          </div>
        )}
      </div>
      {/* end content container */}

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
