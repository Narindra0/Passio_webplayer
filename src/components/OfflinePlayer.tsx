import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { useCachedImage } from '@/hooks/useCachedImage';
import { getOptimizedImageUrl } from '@/utils/imageUtils';
import { listVaultAlbums } from '@/services/downloadManager';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import type { PublicAlbumDetails, PublicAlbumSummary, PublicTrack } from '@/types/backend';
import {
  Play, Pause, Download, Wifi, HardDrive, ChevronLeft,
  Music, Headphones,
} from 'lucide-react';
import { sortTracksByPosition } from '@/utils/tracks';
import { formatTitle } from '@/utils/formatTitle';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Animation slideUp pour les transitions de vue */
const slideUpStyle: React.CSSProperties = {
  animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
};

// ── Sous-composant image avec cache + optimisation ──

function OfflineCoverImage({ coverUrl, alt }: { coverUrl?: string | null; alt: string }) {
  const cachedCover = useCachedImage(coverUrl);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        backgroundColor: 'var(--color-bg-dark)',
      }}
    >
      {coverUrl ? (
        <img
          src={getOptimizedImageUrl(cachedCover || coverUrl)}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div
          style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-muted)', fontSize: 32,
          }}
        >
          ♪
        </div>
      )}
    </div>
  );
}

export function OfflinePlayer() {
  const { toggleMode } = useLibraryMode();
  const audio = useAudioPlayback();
  const { progress } = useAudioProgress();
  const { currentTrack, isPlaying, togglePlayPause, seekTo } = audio;

  const [albums, setAlbums] = useState<PublicAlbumSummary[]>([]);
  const [albumDetails, setAlbumDetails] = useState<Map<string, PublicAlbumDetails>>(new Map());
  const [loading, setLoading] = useState(true);
  const [storageInfo, setStorageInfo] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [viewTransition, setViewTransition] = useState<'none' | 'entering'>('none');

  const bodyRef = useRef<HTMLDivElement>(null);

  // Charger les albums téléchargés
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const vaultAlbums = await listVaultAlbums();
        if (cancelled) return;
        setAlbums(vaultAlbums);

        // Charger les métadonnées de chaque album
        const details = new Map<string, PublicAlbumDetails>();
        for (const album of vaultAlbums) {
          const result = await resolveOfflinePlayback(album.id);
          if (result.metadata) {
            details.set(album.id, result.metadata);
          }
        }
        if (cancelled) return;
        setAlbumDetails(details);

        // Info stockage
        try {
          const estimate = await navigator.storage.estimate();
          if (estimate.usage && estimate.quota) {
            const usedGb = (estimate.usage / (1024 * 1024 * 1024)).toFixed(1);
            const totalGb = (estimate.quota / (1024 * 1024 * 1024)).toFixed(1);
            setStorageInfo(`${usedGb} Go / ${totalGb} Go utilisé`);
          }
        } catch {
          // StorageManager non disponible
        }
      } catch {
        // Silencieux
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const selectedAlbum = useMemo(() => {
    if (!selectedAlbumId) return null;
    const summary = albums.find(a => a.id === selectedAlbumId);
    const details = albumDetails.get(selectedAlbumId);
    if (!summary || !details) return null;
    return { summary, details };
  }, [selectedAlbumId, albums, albumDetails]);

  const sortedTracks = useMemo(() => {
    if (!selectedAlbum) return [];
    return sortTracksByPosition(selectedAlbum.details.tracks || []);
  }, [selectedAlbum]);

  const handlePlayTrack = useCallback(async (track: PublicTrack, index: number) => {
    if (!selectedAlbum) return;
    const albumData = selectedAlbum.details;
    const isCurrentAlbum = audio.album?.id === albumData.id;

    if (!isCurrentAlbum) {
      audio.loadAlbum(albumData, null);
      await new Promise(r => setTimeout(r, 50));
    }

    if (audio.currentTrack?.id === track.id && isCurrentAlbum) {
      audio.togglePlayPause();
      return;
    }

    try {
      await audio.playTrackAtIndex(index);
    } catch {
      // Silencieux
    }
  }, [selectedAlbum, audio]);

  /** Retour à la liste avec animation */
  const goBackToList = useCallback(() => {
    setViewTransition('none');
    setSelectedAlbumId(null);
  }, []);

  /** Ouvre un album détaillé */
  const openAlbum = useCallback((albumId: string) => {
    setViewTransition('entering');
    setSelectedAlbumId(albumId);
    // Scroll en haut du body
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, []);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    seekTo(Math.max(0, Math.min(1, x / rect.width)));
  }, [seekTo]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--color-bg-dark)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* ========== HEADER ========== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
          flexWrap: 'wrap',
          gap: 8,
          background: 'linear-gradient(180deg, rgba(30,10,10,0.95) 0%, var(--color-bg-dark) 100%)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-full)',
              background: 'linear-gradient(135deg, rgba(220,20,60,0.15), rgba(139,0,0,0.1))',
              border: '1px solid rgba(220,20,60,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <HardDrive size={18} color="var(--color-accent)" />
          </div>
          <div>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.3px',
                display: 'block',
              }}
            >
              Hors-ligne
            </span>
            {storageInfo && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  fontWeight: 500,
                  display: 'block',
                  marginTop: 1,
                }}
              >
                {storageInfo}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => void toggleMode()}
            title="Revenir au mode en ligne"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(29,185,84,0.08)',
              border: '1px solid rgba(29,185,84,0.15)',
              cursor: 'pointer',
              color: '#1DB954',
              fontSize: 12,
              fontWeight: 600,
              transition: 'all var(--transition-fast) ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(29,185,84,0.15)';
              e.currentTarget.style.transform = 'scale(1.03)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(29,185,84,0.08)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Wifi size={14} />
            <span style={{ display: 'inline' }}>Mode en ligne</span>
          </button>
        </div>
      </div>

      {/* ========== BODY ========== */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 16px',
          paddingBottom: currentTrack ? 80 : 24,
        }}
      >
        {selectedAlbumId ? (
          /* ── VUE ALBUM DÉTAILLÉ ── */
          <div style={viewTransition === 'entering' ? slideUpStyle : undefined}>
            {/* Bouton retour */}
            <button
              onClick={goBackToList}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '14px 0 10px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                fontSize: 13,
                fontWeight: 600,
                transition: 'color var(--transition-fast) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
            >
              <ChevronLeft size={16} />
              Retour aux albums
            </button>

            {selectedAlbum?.details && (
              <>
                {/* ── Album header ── */}
                <div
                  style={{
                    display: 'flex',
                    gap: 18,
                    alignItems: 'center',
                    marginBottom: 28,
                    padding: '18px 16px',
                    borderRadius: 'var(--radius-lg)',
                    background: 'linear-gradient(135deg, var(--color-surface-elevated) 0%, var(--color-surface) 100%)',
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  {/* Cover */}
                  <div
                    style={{
                      width: 80,
                      height: 80,
                      minWidth: 80,
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      backgroundColor: 'var(--color-bg-dark)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    }}
                  >
                    <OfflineCoverImage coverUrl={selectedAlbum.details.cover_url} alt="" />
                  </div>

                  {/* Infos */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 20,
                        fontWeight: 800,
                        color: 'var(--color-text-primary)',
                        lineHeight: '24px',
                        letterSpacing: '-0.4px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatTitle(selectedAlbum.details.title)}
                    </h2>
                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: 14,
                        color: 'var(--color-text-secondary)',
                        fontWeight: 500,
                      }}
                    >
                      {selectedAlbum.details.artist_name || selectedAlbum.details.artist?.name || 'Artiste inconnu'}
                    </p>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        marginTop: 6,
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-full)',
                        background: 'rgba(29,185,84,0.06)',
                        border: '1px solid rgba(29,185,84,0.1)',
                      }}
                    >
                      <Download size={10} color="#1DB954" />
                      <span
                        style={{
                          fontSize: 10,
                          color: '#1DB954',
                          fontWeight: 700,
                          letterSpacing: '0.2px',
                          textTransform: 'uppercase',
                        }}
                      >
                        {selectedAlbum.details.tracks?.length ?? 0} titre{(selectedAlbum.details.tracks?.length ?? 0) > 1 ? 's' : ''} · Hors-ligne
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Tracklist ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 16 }}>
                  {sortedTracks.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '0 14px 10px',
                        borderBottom: '1px solid var(--color-border-subtle)',
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ width: 24, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'center' }}>#</span>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Titre</span>
                      <span style={{ width: 48, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'right' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      </span>
                    </div>
                  )}
                  {sortedTracks.map((track, index) => {
                    const isCurrent = audio.currentTrack?.id === track.id;
                    const isThisPlaying = isCurrent && isPlaying;
                    return (
                      <button
                        key={track.id}
                        onClick={() => void handlePlayTrack(track, index)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          background: isCurrent
                            ? 'var(--color-accent-soft)'
                            : 'transparent',
                          cursor: 'pointer',
                          width: '100%',
                          textAlign: 'left',
                          transition: 'all var(--transition-fast) ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!isCurrent) e.currentTarget.style.background = 'var(--color-surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isCurrent) e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {/* Index ou indicateur de lecture */}
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {isThisPlaying ? (
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
                              <div className="equalizer-bar" style={{ width: 2, backgroundColor: 'var(--color-accent)', borderRadius: 1 }} />
                              <div className="equalizer-bar" style={{ width: 2, backgroundColor: 'var(--color-accent)', borderRadius: 1 }} />
                              <div className="equalizer-bar" style={{ width: 2, backgroundColor: 'var(--color-accent)', borderRadius: 1 }} />
                            </div>
                          ) : (
                            <Play
                              size={13}
                              color={isCurrent ? 'var(--color-accent)' : 'var(--color-text-muted)'}
                              style={{ opacity: isCurrent ? 1 : 0.5 }}
                            />
                          )}
                        </div>

                        {/* Infos piste */}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <span
                            style={{
                              color: isCurrent ? 'var(--color-accent)' : 'var(--color-text-primary)',
                              fontSize: 14,
                              fontWeight: 600,
                              lineHeight: '18px',
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatTitle(track.title)}
                          </span>
                        </div>

                        {/* Durée */}
                        {track.duration != null && track.duration > 0 && (
                          <span
                            style={{
                              color: 'var(--color-text-muted)',
                              fontSize: 12,
                              fontWeight: 500,
                              fontVariantNumeric: 'tabular-nums',
                              flexShrink: 0,
                            }}
                          >
                            {formatDuration(track.duration)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          /* ── LISTE DES ALBUMS ── */
          <div style={viewTransition === 'entering' ? undefined : undefined}>
            {/* En-tête de liste */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '20px 4px 8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#1DB954',
                    flexShrink: 0,
                    boxShadow: '0 0 8px rgba(29,185,84,0.4)',
                  }}
                />
                <span
                  style={{
                    color: 'var(--color-text-muted)',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {loading
                    ? 'Chargement…'
                    : albums.length === 0
                      ? 'Aucun album téléchargé'
                      : `${albums.length} album${albums.length > 1 ? 's' : ''} téléchargé${albums.length > 1 ? 's' : ''}`}
                </span>
              </div>
            </div>

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
                <div className="loader-spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
              </div>
            ) : albums.length === 0 ? (
              /* ── ÉTAT VIDE ── */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '60px 24px 80px',
                  textAlign: 'center',
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 'var(--radius-full)',
                    background: 'linear-gradient(135deg, rgba(220,20,60,0.08), rgba(139,0,0,0.05))',
                    border: '1px solid rgba(220,20,60,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 4,
                  }}
                >
                  <Headphones size={36} color="var(--color-accent)" style={{ opacity: 0.5 }} />
                </div>
                <div>
                  <h3
                    style={{
                      color: 'var(--color-text-primary)',
                      fontSize: 22,
                      fontWeight: 800,
                      margin: 0,
                      letterSpacing: '-0.5px',
                    }}
                  >
                    Bibliothèque vide
                  </h3>
                  <p
                    style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 14,
                      lineHeight: '22px',
                      maxWidth: 320,
                      margin: '8px auto 0',
                    }}
                  >
                    Téléchargez vos albums depuis le catalogue pour les écouter
                    même sans connexion internet.
                  </p>
                </div>
                <button
                  onClick={() => void toggleMode()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 28px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--color-accent)',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    transition: 'all var(--transition-fast) ease',
                    boxShadow: '0 4px 16px rgba(220,20,60,0.2)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.04)';
                    e.currentTarget.style.background = 'var(--color-accent-light)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.background = 'var(--color-accent)';
                  }}
                >
                  <Wifi size={16} />
                  Aller au catalogue
                </button>
              </div>
            ) : (
              /* ── GRILLE DES ALBUMS ── */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  paddingBottom: 16,
                }}
              >
                {albums.map((album) => {
                  const details = albumDetails.get(album.id);
                  const trackCount = details?.tracks?.length ?? 0;
                  const isCurrentAlbum = audio.album?.id === album.id;
                  const isAlbumPlaying = isCurrentAlbum && isPlaying;

                  return (
                    <button
                      key={album.id}
                      onClick={() => {
                        if (details) openAlbum(album.id);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${
                          isCurrentAlbum
                            ? 'rgba(220,20,60,0.2)'
                            : 'var(--color-border-subtle)'
                        }`,
                        background: isCurrentAlbum
                          ? 'linear-gradient(135deg, rgba(220,20,60,0.06), rgba(139,0,0,0.03))'
                          : 'var(--color-surface-elevated)',
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'left',
                        transition: 'all var(--transition-fast) ease',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrentAlbum) {
                          e.currentTarget.style.background = 'var(--color-surface-hover)';
                        }
                        e.currentTarget.style.borderColor = isCurrentAlbum
                          ? 'rgba(220,20,60,0.35)'
                          : 'var(--color-border)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrentAlbum) {
                          e.currentTarget.style.background = 'var(--color-surface-elevated)';
                        }
                        e.currentTarget.style.borderColor = isCurrentAlbum
                          ? 'rgba(220,20,60,0.2)'
                          : 'var(--color-border-subtle)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      {/* Mini cover */}
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          backgroundColor: 'var(--color-bg-dark)',
                          flexShrink: 0,
                          position: 'relative',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        }}
                      >
                        <OfflineCoverImage coverUrl={album.cover_url} alt="" />

                        {/* Indicateur "en cours" */}
                        {isAlbumPlaying && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              background: 'rgba(0,0,0,0.4)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
                              <div className="equalizer-bar" style={{ width: 3, backgroundColor: '#fff', borderRadius: 1 }} />
                              <div className="equalizer-bar" style={{ width: 3, backgroundColor: '#fff', borderRadius: 1 }} />
                              <div className="equalizer-bar" style={{ width: 3, backgroundColor: '#fff', borderRadius: 1 }} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Infos */}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            color: isCurrentAlbum ? 'var(--color-accent)' : 'var(--color-text-primary)',
                            fontSize: 14,
                            fontWeight: 600,
                            lineHeight: '18px',
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatTitle(album.title)}
                        </span>
                        <span
                          style={{
                            color: 'var(--color-text-secondary)',
                            fontSize: 12,
                            fontWeight: 500,
                            marginTop: 2,
                            display: 'block',
                          }}
                        >
                          {album.artist_name || album.artist?.name || 'Artiste inconnu'}
                        </span>
                        <span
                          style={{
                            color: 'var(--color-text-muted)',
                            fontSize: 11,
                            fontWeight: 500,
                            marginTop: 1,
                            display: 'block',
                          }}
                        >
                          {trackCount} titre{trackCount > 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Bouton play */}
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 'var(--radius-full)',
                          background: isAlbumPlaying
                            ? 'var(--color-accent)'
                            : 'var(--color-bg-dark)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all var(--transition-fast) ease',
                          boxShadow: isAlbumPlaying ? '0 2px 10px rgba(220,20,60,0.3)' : 'none',
                        }}
                      >
                        {isAlbumPlaying ? (
                          <Pause size={14} color="#fff" />
                        ) : (
                          <Play size={14} color="var(--color-text-secondary)" style={{ marginLeft: 2 }} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========== NOW PLAYING BAR ========== */}
      {currentTrack && (
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'var(--color-surface-glass)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            padding: '10px 16px',
            paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 10,
          }}
        >
          {/* Barre de progression interactive */}
          <div
            onClick={handleProgressClick}
            style={{
              position: 'absolute',
              top: -2,
              left: 0,
              right: 0,
              height: 4,
              cursor: 'pointer',
              zIndex: 2,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.height = '6px'; }}
            onMouseLeave={(e) => { e.currentTarget.style.height = '4px'; }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(progress * 100)}%`,
                background: 'var(--color-accent-gradient)',
                borderRadius: '0 2px 2px 0',
                transition: 'width 0.1s linear',
                boxShadow: '0 0 6px rgba(220,20,60,0.3)',
              }}
            />
          </div>

          {/* Cover miniature */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              backgroundColor: 'var(--color-bg-dark)',
              flexShrink: 0,
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}
          >
            {audio.album?.cover_url ? (
              <OfflineCoverImage coverUrl={audio.album.cover_url} alt="" />
            ) : (
              <div
                style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-text-muted)', fontSize: 18,
                }}
              >
                <Music size={18} />
              </div>
            )}
          </div>

          {/* Infos piste */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <span
              style={{
                color: 'var(--color-text-primary)',
                fontSize: 13,
                fontWeight: 600,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {formatTitle(currentTrack.title)}
            </span>
            {audio.album && (
              <span
                style={{
                  color: 'var(--color-text-muted)',
                  fontSize: 11,
                  fontWeight: 500,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: 1,
                }}
              >
                {audio.album.artist_name || audio.album.artist?.name || 'Artiste inconnu'}
              </span>
            )}
          </div>

          {/* Contrôles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              onClick={togglePlayPause}
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-accent)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all var(--transition-fast) ease',
                boxShadow: '0 2px 8px rgba(220,20,60,0.25)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.08)';
                e.currentTarget.style.background = 'var(--color-accent-light)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.background = 'var(--color-accent)';
              }}
            >
              {isPlaying ? (
                <Pause size={16} color="#fff" />
              ) : (
                <Play size={16} color="#fff" style={{ marginLeft: 1 }} />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
