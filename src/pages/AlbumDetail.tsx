import { Screen } from '@/components/Screen';
import { getPurchaseAlbumUrl } from '@/config/urls';
import { useCachedImage } from '@/hooks/useCachedImage';
import { getOptimizedImageUrl } from '@/utils/imageUtils';
import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { useLayout } from '@/contexts/LayoutContext';
import { albumHasStreamableTracks, loadOwnedAlbumForPlayback, resolveAlbumDecryptionKey } from '@/services/albumOwnership';
import { isAlbumReadyOffline } from '@/services/downloadManager';
import { DownloadButton } from '@/components/DownloadButton';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import type { PublicAlbumDetails, PublicTrack } from '@/types/backend';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSwipeDown } from '@/hooks/useSwipeDown';
import {
  ChevronLeft, Crown, Download, Lock, Pause, Play, Share2,
  ShieldCheck, ShoppingBag, Sparkles, Clock, CloudOff,
} from 'lucide-react';
import { ShareCard } from '@/components/ShareCard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { getApiBaseUrl } from '@/services/api';
import { prefetchTrackBlob } from '@/services/audio';
import { useNetworkQuality } from '@/hooks/useNetworkQuality';
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
  const { isSidebarCollapsed } = useLayout();

  const [album, setAlbum] = useState<PublicAlbumDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [decryptionKey, setDecryptionKey] = useState<string | null>(null);
  const [ownedByDevice, setOwnedByDevice] = useState(false);
  const [isOfflineReady, setIsOfflineReady] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const networkQuality = useNetworkQuality();

  // ⚡ Toujours afficher les covers (même en mode Éco)
  const isDataSaver = false;

  // Call all hooks BEFORE any early returns
  // ⚡ Data saver : pas de cache IndexedDB, pas d'extraction de couleurs
  const cachedCover = useCachedImage(isDataSaver ? null : album?.cover_url);
  const coverColors = useAlbumColors(isDataSaver ? null : album?.cover_url);

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
    } catch (err) {
      logger.error('[AlbumDetail] Erreur chargement album:', err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [id, effectiveMode]);

  useEffect(() => {
    void loadAlbumData();
  }, [id, loadAlbumData]);

  // ⚡ Mode offline : si l'album n'est pas en cache, afficher un écran fallback premium
  const isOfflineAndUnavailable = !loading && effectiveMode === 'offline' && !album;
  // ⚡ Layout contraint : sidebar déplié + full player ouvert → icônes seulement pour les CTA
  const isConstrainedLayout = !isSidebarCollapsed && audio.isFullPlayerVisible;
  // Mobile: compact layout always active
  const isCompactCTA = isConstrainedLayout || isMobile;

  // ── Swipe down to go back (mobile only) ──
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSwipeDismiss = useCallback(() => {
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      navigate(-1);
    }, 300);
  }, [navigate]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const {
    dragOffset,
    isDragging,
    handlers: swipeHandlers,
  } = useSwipeDown({
    threshold: 100,
    onDismiss: handleSwipeDismiss,
    enabled: isMobile && !loading && !!album,
    resistance: 0.55,
  });

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

  // ── Animated style for swipe — only on mobile ──
  const animatedSwipeStyle: React.CSSProperties = isMobile
    ? {
        transform: isDragging
          ? `translateY(${dragOffset}px)`
          : isClosing
            ? 'translateY(100%)'
            : 'translateY(0)',
        opacity: isDragging
          ? Math.max(0, 1 - dragOffset / (window.innerHeight * 0.6))
          : isClosing
            ? 0
            : 1,
        transition: isDragging
          ? 'none'
          : 'transform 0.35s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.35s ease',
        overflow: 'hidden',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }
    : {};

  // ── Render ──
  const heroSection = (
    <div className="album-hero"
      style={{
        position: 'relative',
        padding: isMobile ? '64px 16px 28px' : '60px clamp(20px, 3.5vw, 48px) 40px',
        background: isMobile ? coverColors.playerGradient : coverColors.gradientStyle,
        transition: 'background 0.6s ease',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 16 : 'clamp(16px, 3vw, 40px)',
        alignItems: isMobile ? 'center' : 'flex-end',
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

      {/* Effet de halo lumineux derrière la cover (mobile) */}
      {isMobile && coverColors.colors?.vibrant && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'clamp(220px, 75vw, 340px)',
          height: 'clamp(220px, 75vw, 340px)',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${coverColors.colors.vibrant}25 0%, transparent 70%)`,
          pointerEvents: 'none',
          zIndex: 0,
        }} />
      )}

      {/* Album Cover */}
      <div className="album-cover"
        style={{
          width: isMobile ? 'clamp(220px, 78vw, 320px)' : (isDataSaver ? 'clamp(80px, 10vw, 120px)' : 'clamp(160px, 18vw, 260px)'),
          height: isMobile ? 'clamp(220px, 78vw, 320px)' : (isDataSaver ? 'clamp(80px, 10vw, 120px)' : 'clamp(160px, 18vw, 260px)'),
          minWidth: isMobile ? 'clamp(220px, 78vw, 320px)' : (isDataSaver ? 'clamp(80px, 10vw, 120px)' : 'clamp(160px, 18vw, 260px)'),
          borderRadius: isMobile ? 'var(--radius-lg)' : 'var(--radius-sm)',
          overflow: 'hidden',
          boxShadow: isMobile && coverColors.colors?.vibrant
            ? `0 16px 56px ${coverColors.colors.vibrant}40, 0 0 0 1px rgba(255,255,255,0.06)`
            : isMobile
              ? '0 16px 56px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)'
              : '0 8px 40px rgba(0,0,0,0.5)',
          marginTop: 24,
          transition: 'box-shadow 0.4s ease',
        }}
      >
        {isDataSaver ? (
          // ⚡ Data saver : icône placeholdere au lieu de l'image cover
          <div style={{
            width: '100%', height: '100%',
            background: 'var(--color-surface-elevated)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 36, color: 'var(--color-text-muted)' }}>♪</span>
          </div>
        ) : album.cover_url ? (
          <img src={getOptimizedImageUrl(cachedCover || album.cover_url)} alt={album.title} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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

      {/* Album Info + CTA — redesign propre et hiérarchisé, style SoundCloud */}
      <div className="album-info" style={{ width: '100%' }}>
        
        {/* ── LIGNE 1 : Type badge ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            color: getPrimaryTextColor(coverColors.colors, 'var(--color-text-secondary)'),
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px',
            opacity: 0.6,
          }}>
            {album.type === 'single' ? 'Single' : 'Album'}
          </span>
          {!isFreeRelease && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 8px',
              borderRadius: 'var(--radius-full)',
              background: getBadgeBackground(coverColors.colors, coverColors.colors?.isDark ?? true, true),
              border: `1px solid ${getBadgeBorder(coverColors.colors, coverColors.colors?.isDark ?? true, true)}`,
              fontSize: 9, fontWeight: 700, color: '#FFD700', letterSpacing: '0.3px',
            }}>
              <Crown size={8} color="#FFD700" /> Premium
            </span>
          )}
          {isFreeRelease && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 8px',
              borderRadius: 'var(--radius-full)',
              background: coverColors.colors?.isDark === false ? 'rgba(29,185,84,0.08)' : 'rgba(29,185,84,0.1)',
              border: `1px solid ${coverColors.colors?.isDark === false ? 'rgba(29,185,84,0.15)' : 'rgba(29,185,84,0.2)'}`,
              fontSize: 9, fontWeight: 700, color: '#1DB954', letterSpacing: '0.3px',
            }}>
              <Sparkles size={8} color="#1DB954" /> Gratuit
            </span>
          )}
        </div>

        {/* ── LIGNE 2 : Titre ── */}
        <h1 style={{
          color: getPrimaryTextColor(coverColors.colors, 'var(--color-text-primary)'),
          fontSize: 'clamp(22px, 5.5vw, 28px)',
          fontWeight: 800,
          letterSpacing: '-0.3px',
          lineHeight: 1.12,
          margin: '0 0 6px',
        }}>
          {formatTitle(album.title)}
        </h1>

        {/* ── LIGNE 3 : Artiste + metadata (compact) ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {(() => {
            const artistId = artistIdMap[normalizeArtistName(artistName)];
            const link = artistId ? `/artist/${artistId}` : null;
            const secColor = getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)');
            const priColor = getPrimaryTextColor(coverColors.colors, 'var(--color-text-primary)');
            return (
              <span
                onClick={link ? (e) => { e.stopPropagation(); navigate(link); } : undefined}
                style={{
                  color: secColor, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap',
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
          <span style={{ color: getMutedTextColor(coverColors.colors, 'var(--color-text-muted)'), fontSize: 10 }}>·</span>
          <span style={{ color: getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)'), fontSize: 13, fontWeight: 500 }}>
            {album.tracks?.length ?? 0} titre{(album.tracks?.length ?? 0) > 1 ? 's' : ''}
          </span>
          {totalDuration > 0 && (
            <>
              <span style={{ color: getMutedTextColor(coverColors.colors, 'var(--color-text-muted)'), fontSize: 10 }}>·</span>
              <span style={{ color: getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)'), fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                {totalDurationLabel}
              </span>
            </>
          )}
        </div>

        {/* ── LIGNE 4 : Status badges (optionnels) ── */}
        {((isOwned && !isFreeRelease) || isOfflineReady) && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {isOwned && !isFreeRelease && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 10px', borderRadius: 'var(--radius-full)',
                background: 'rgba(29,185,84,0.1)', border: '1px solid rgba(29,185,84,0.2)',
                fontSize: 10, fontWeight: 600, color: 'var(--color-success)',
              }}>
                <ShieldCheck size={12} color="var(--color-success)" />
                {isOfflineReady ? 'Disponible hors-ligne' : 'Activé'}
              </span>
            )}
            {isOfflineReady && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 10px', borderRadius: 'var(--radius-full)',
                background: 'rgba(29,185,84,0.1)', border: '1px solid rgba(29,185,84,0.2)',
                fontSize: 10, fontWeight: 600, color: 'var(--color-success)',
              }}>
                <Download size={10} color="var(--color-success)" /> Hors-ligne
              </span>
            )}
          </div>
        )}

        {/* ── LIGNE 5 : Actions ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          
          {/* Bloc gauche : Play (CTA principal) */}
          {!preordered && canPlay && sortedTracks.length > 0 && (
            <button
              onClick={() => void handlePressTrack(sortedTracks[0], 0)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 'var(--radius-full)',
                background: 'var(--color-accent)', border: 'none', cursor: 'pointer',
                color: '#fff', fontSize: 13, fontWeight: 700,
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 12px rgba(220,20,60,0.3)',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.background = 'var(--color-accent-light)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'var(--color-accent)'; }}
            >
              <Play size={16} fill="#fff" />
              Tout écouter
            </button>
          )}
          {preordered && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 'var(--radius-full)',
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border-subtle)',
              color: getMutedTextColor(coverColors.colors, 'var(--color-text-muted)'),
              fontSize: 12, fontWeight: 600, cursor: 'default', opacity: 0.6,
              flexShrink: 0,
            }}>
              <Clock size={14} />
              {formattedReleaseDate}
            </span>
          )}

          {/* Icônes secondaires (Download + Share) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            {(isOwned || isFreeRelease) && album && (
              <DownloadButton
                album={album}
                decryptionKey={decryptionKey}
                variant="icon"
                onComplete={() => setIsOfflineReady(true)}
                onDelete={() => setIsOfflineReady(false)}
              />
            )}
            <button
              onClick={() => setShareModalVisible(true)}
              title="Partager"
              style={{
                width: 36, height: 36,
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-surface-elevated)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-text-secondary)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
            >
              <Share2 size={15} />
            </button>
          </div>
        </div>

        {/* ── LIGNE 6 : Achat / PassCode (si payant non possédé) ── */}
        {isPaidNotOwned && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {priceDisplay && (
              <a
                href={getPurchaseAlbumUrl(album.id)}
                target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '9px 18px', borderRadius: 'var(--radius-full)',
                  background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                  border: 'none', cursor: 'pointer', color: '#000',
                  fontSize: 13, fontWeight: 800, textDecoration: 'none',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 12px rgba(255,215,0,0.25)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.03)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <ShoppingBag size={16} />
                {preordered ? `Précommander — ${priceDisplay}` : `${priceDisplay}`}
              </a>
            )}
            <button
              onClick={() => navigate('/activate')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 16px', borderRadius: 'var(--radius-full)',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer', color: getSecondaryTextColor(coverColors.colors, 'var(--color-text-secondary)'),
                fontSize: 12, fontWeight: 600, transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            >
              <Lock size={13} />
              J'ai un PassCode
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const bodyContent = (
    <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {preorderReleaseDate && (
        <div style={{ padding: '16px clamp(16px, 3.5vw, 48px) 0' }}>
          <PreorderCountdown publicationDate={preorderReleaseDate} />
        </div>
      )}

      {album.description && (
        <div style={{
          padding: isMobile ? '24px 16px 20px' : '32px clamp(16px, 3.5vw, 48px) 24px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
          }}>
            <div style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: 'var(--color-accent)',
              flexShrink: 0,
            }} />
            <h3 style={{
              color: 'var(--color-text-muted)',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1.2px',
              margin: 0,
            }}>
              À propos
            </h3>
          </div>
          <p style={{
            color: 'var(--color-text-secondary)',
            fontSize: isMobile ? 14 : 15,
            lineHeight: isMobile ? '22px' : '24px',
            margin: 0,
            maxWidth: 700,
          }}>
            {album.description}
          </p>
        </div>
      )}

      <div className="album-tracklist" style={{ padding: isMobile ? '12px 0 32px' : '28px clamp(14px, 3.5vw, 48px) 40px' }}>
        {sortedTracks.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 10 : 16,
            padding: isMobile ? '0 16px 10px' : '0 16px 12px',
            borderBottom: '1px solid var(--color-border-subtle)',
            marginBottom: 2,
          }}>
            {!isMobile && (
              <span style={{ width: 28, color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>#</span>
            )}
            <span style={{ flex: 1, color: 'var(--color-text-muted)', fontSize: isMobile ? 10 : 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Titre
            </span>
            {!isMobile && (
              <span style={{ flex: '0 0 120px', color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center' }}>
                Artiste
              </span>
            )}
            {hasDuration && (
              <span style={{ width: isMobile ? 40 : 48, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <Clock size={isMobile ? 12 : 14} />
              </span>
            )}
          </div>
        )}

        {sortedTracks.map((track, index) => {
          const isCurrent = audio.currentTrack?.id === track.id;
          const isThisPlaying = isCurrent && audio.isPlaying;
          const featResult = hasFeatArtists(track.title) ? parseFeatArtists(track.title) : null;
          const prefetchOnHover = () => {
            // ⚡ Data saver : pas de prefetch audio sur connexion lente
            if (networkQuality === 'slow') return;
            if (album.is_free) {
              const directUrl = track.encrypted_audio_url || track.preview_url;
              if (directUrl) {
                fetch(directUrl, { method: 'HEAD' }).catch(() => { });
                return;
              }
            }
            const trackProxyUrl = `${getApiBaseUrl()}/api/stream/tracks/${encodeURIComponent(track.id)}/audio`;
            prefetchTrackBlob(trackProxyUrl, track.id);
          };
          const featSuffix = isMobile && featResult?.featNames?.length
            ? ` feat. ${featResult.featNames.map(n => n).join(', ')}`
            : '';
          return (
            <button className="album-track"
              key={track.id}
              onClick={() => void handlePressTrack(track, index)}
              disabled={!canPlay && !isPaidNotOwned}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? 10 : 16,
                padding: isMobile ? '10px 16px' : '10px 16px',
                width: '100%',
                background: isCurrent ? 'var(--color-accent-soft)' : 'transparent',
                border: 'none',
                borderRadius: isMobile ? 'var(--radius-sm)' : 'var(--radius-sm)',
                cursor: canPlay || isPaidNotOwned ? 'pointer' : 'default',
                textAlign: 'left',
                opacity: !canPlay && !isPaidNotOwned ? 0.5 : 1,
                transition: 'background-color var(--transition-fast) ease',
                borderBottom: isMobile && index < sortedTracks.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              }}
              onMouseEnter={(e) => {
                prefetchOnHover();
                if (!preordered && !isCurrent && (canPlay || isPaidNotOwned)) e.currentTarget.style.background = 'var(--color-surface-hover)';
              }}
              onMouseLeave={(e) => {
                if (!isCurrent) e.currentTarget.style.background = 'transparent';
              }}
            >
              {!isMobile && (
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
              )}

              {isMobile && (
                <div style={{ width: 20, textAlign: 'center', flexShrink: 0 }}>
                  {isThisPlaying ? (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 14, justifyContent: 'center' }}>
                      <div className="equalizer-bar" style={{ width: 2.5, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                      <div className="equalizer-bar" style={{ width: 2.5, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                      <div className="equalizer-bar" style={{ width: 2.5, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                      <div className="equalizer-bar" style={{ width: 2.5, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                    </div>
                  ) : isCurrent ? (
                    <Play size={12} color="var(--color-accent)" />
                  ) : (
                    <span style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 11,
                      fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {index + 1}
                    </span>
                  )}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  color: isCurrent ? 'var(--color-accent)' : 'var(--color-text-primary)',
                  fontSize: isMobile ? 14 : 16,
                  fontWeight: 600,
                  lineHeight: isMobile ? '20px' : '24px',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                  title={track.title}
                >
                  {formatTitle(featResult ? featResult.cleanTitle : track.title)}
                  {featSuffix && (
                    <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: isMobile ? 11 : 13 }}>
                      {featSuffix}
                    </span>
                  )}
                </p>
              </div>

              {!isMobile && (
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
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10, flexShrink: 0 }}>
                {preordered ? (
                  <Lock size={isMobile ? 11 : 13} color="var(--color-accent)" style={{ opacity: 0.45 }} />
                ) : isPaidNotOwned ? (
                  <Lock size={isMobile ? 11 : 13} color="var(--color-text-muted)" style={{ opacity: 0.5 }} />
                ) : isThisPlaying ? (
                  <Pause size={isMobile ? 12 : 14} color="var(--color-accent)" />
                ) : isCurrent ? (
                  <Play size={isMobile ? 12 : 14} color="var(--color-accent)" />
                ) : null}
                {hasDuration && track.duration != null && track.duration > 0 && (
                  <span style={{
                    color: 'var(--color-text-muted)',
                    fontSize: isMobile ? 12 : 13,
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: isMobile ? 36 : 44,
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

      {actionError && (
        <div className="album-section" style={{ margin: '0 clamp(14px, 3.5vw, 48px) 24px', padding: 12, borderRadius: 'var(--radius-sm)', background: 'rgba(233, 20, 41, 0.1)', border: '1px solid rgba(233, 20, 41, 0.2)' }}>
          <p style={{ color: 'var(--color-error)', fontSize: 13, lineHeight: '18px', margin: 0 }}>{actionError}</p>
        </div>
      )}
    </div>
  );

  return (
    <Screen padded={false}>
      {/* ── Swipe indicator bar (mobile only) ── */}
      {isMobile && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            opacity: isDragging ? 1 : 0,
            transition: isDragging ? 'none' : 'opacity 0.3s ease',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.3)',
            }}
          />
        </div>
      )}

      {/* ── Scrollable content wrapper ── */}
      <div
        {...(isMobile ? swipeHandlers : {})}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          ...(isMobile ? {
            transform: isDragging
              ? `translateY(${dragOffset}px)`
              : isClosing
                ? 'translateY(100%)'
                : 'translateY(0)',
            opacity: isDragging
              ? Math.max(0, 1 - dragOffset / (window.innerHeight * 0.6))
              : isClosing
                ? 0
                : 1,
            transition: isDragging
              ? 'none'
              : 'transform 0.35s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.35s ease',
          } : {}),
        }}
      >
        {heroSection}
        {bodyContent}
      </div>

      {/* Share Modal — portal vers document.body pour éviter les problèmes de stacking context */}
      {shareModalVisible && createPortal(
        <ShareCard
          visible={shareModalVisible}
          onClose={() => setShareModalVisible(false)}
          trackTitle={album.title}
          artistName={artistName}
          coverUri={album.cover_url}
          albumId={album.id}
        />,
        document.body
      )}
    </Screen>
  );
}
