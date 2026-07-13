import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { listVaultAlbums } from '@/services/downloadManager';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import type { PublicAlbumDetails, PublicAlbumSummary, PublicTrack } from '@/types/backend';
import { Play, Pause, Download, WifiOff, HardDrive, ChevronLeft } from 'lucide-react';
import { sortTracksByPosition } from '@/utils/tracks';
import { formatTitle } from '@/utils/formatTitle';

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

  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds || isNaN(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

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

    // Lire directement depuis le cache IndexedDB
    try {
      await audio.playTrackAtIndex(index);
    } catch {
      // Silencieux
    }
  }, [selectedAlbum, audio]);

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
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
          background: 'var(--color-bg-dark)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-full)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--color-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <HardDrive size={18} color="var(--color-text-muted)" />
          </div>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.3px',
            }}
          >
            Hors-ligne
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {storageInfo && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                fontWeight: 500,
                padding: '4px 10px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {storageInfo}
            </span>
          )}
          <button
            onClick={() => void toggleMode()}
            title="Passer en mode en ligne"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--color-border-subtle)',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-surface-hover)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.color = 'var(--color-text-secondary)';
            }}
          >
            <WifiOff size={14} />
            Mode avion
          </button>
        </div>
      </div>

      {/* ========== BODY ========== */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 20px',
        }}
      >
        {selectedAlbumId ? (
          /* ── Vue album détaillé ── */
          <div>
            {/* Back button */}
            <button
              onClick={() => setSelectedAlbumId(null)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 0',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 8,
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
                {/* Album header compact */}
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    alignItems: 'center',
                    marginBottom: 24,
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-surface-elevated)',
                  }}
                >
                  {/* Mini cover */}
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                      backgroundColor: 'var(--color-bg-dark)',
                      flexShrink: 0,
                    }}
                  >
                    {selectedAlbum.details.cover_url ? (
                      <img
                        src={selectedAlbum.details.cover_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--color-text-muted)',
                          fontSize: 28,
                        }}
                      >
                        ♪
                      </div>
                    )}
                  </div>

                  {/* Album info */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 18,
                        fontWeight: 700,
                        color: 'var(--color-text-primary)',
                        lineHeight: '22px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatTitle(selectedAlbum.details.title)}
                    </h2>
                    <p
                      style={{
                        margin: '3px 0 0',
                        fontSize: 13,
                        color: 'var(--color-text-secondary)',
                        fontWeight: 500,
                      }}
                    >
                      {selectedAlbum.details.artist_name || selectedAlbum.details.artist?.name || 'Artiste inconnu'}
                    </p>
                    <p
                      style={{
                        margin: '2px 0 0',
                        fontSize: 11,
                        color: 'var(--color-text-muted)',
                        fontWeight: 500,
                      }}
                    >
                      {selectedAlbum.details.tracks?.length ?? 0} titre(s) · Disponible hors-ligne
                    </p>
                  </div>
                </div>

                {/* Tracklist */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          background: isCurrent ? 'var(--color-accent-soft)' : 'transparent',
                          cursor: 'pointer',
                          width: '100%',
                          textAlign: 'left',
                          transition: 'background-color var(--transition-fast) ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!isCurrent) e.currentTarget.style.background = 'var(--color-surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isCurrent) e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {/* Play/Pause */}
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 'var(--radius-full)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {isThisPlaying ? (
                            <Pause size={14} color="var(--color-accent)" />
                          ) : (
                            <Play size={14} color={isCurrent ? 'var(--color-accent)' : 'var(--color-text-muted)'} />
                          )}
                        </div>

                        {/* Track info */}
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

                        {/* Duration */}
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
          /* ── Liste des albums téléchargés ── */
          <>
            {/* Mini status */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '16px 0 12px',
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--color-success)',
                  flexShrink: 0,
                  opacity: 0.7,
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
                  : `${albums.length} album${albums.length > 1 ? 's' : ''} téléchargé${albums.length > 1 ? 's' : ''}`}
              </span>
            </div>

            {loading ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '60px 0',
                }}
              >
                <div
                  className="loader-spinner"
                  style={{
                    width: 24,
                    height: 24,
                    borderWidth: 2,
                  }}
                />
              </div>
            ) : albums.length === 0 ? (
              /* ── État vide ── */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '80px 24px',
                  textAlign: 'center',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--color-surface-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 4,
                  }}
                >
                  <Download
                    size={28}
                    color="var(--color-text-muted)"
                    style={{ opacity: 0.4 }}
                  />
                </div>
                <h3
                  style={{
                    color: 'var(--color-text-primary)',
                    fontSize: 20,
                    fontWeight: 700,
                    margin: 0,
                    letterSpacing: '-0.3px',
                  }}
                >
                  Aucun album téléchargé
                </h3>
                <p
                  style={{
                    color: 'var(--color-text-muted)',
                    fontSize: 14,
                    lineHeight: '20px',
                    maxWidth: 340,
                    margin: 0,
                  }}
                >
                  Pour écouter de la musique hors-ligne, téléchargez vos albums depuis le catalogue en ligne.
                </p>
                <button
                  onClick={() => void toggleMode()}
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
                    marginTop: 4,
                    transition: 'all var(--transition-fast) ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--color-surface-elevated)';
                  }}
                >
                  <WifiOff size={16} />
                  Activer le mode en ligne
                </button>
              </div>
            ) : (
              /* ── Grille des albums ── */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  paddingBottom: 24,
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
                        if (details) {
                          setSelectedAlbumId(album.id);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border-subtle)',
                        background: isCurrentAlbum ? 'var(--color-accent-soft)' : 'var(--color-surface-elevated)',
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'left',
                        transition: 'all var(--transition-fast) ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrentAlbum) e.currentTarget.style.background = 'var(--color-surface-hover)';
                        e.currentTarget.style.borderColor = 'var(--color-border)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrentAlbum) e.currentTarget.style.background = 'var(--color-surface-elevated)';
                        e.currentTarget.style.borderColor = 'var(--color-border-subtle)';
                      }}
                    >
                      {/* Mini cover */}
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          backgroundColor: 'var(--color-bg-dark)',
                          flexShrink: 0,
                          position: 'relative',
                        }}
                      >
                        {album.cover_url ? (
                          <img
                            src={album.cover_url}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--color-text-muted)',
                              fontSize: 20,
                            }}
                          >
                            ♪
                          </div>
                        )}

                        {/* Playing indicator */}
                        {isAlbumPlaying && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 2,
                              right: 2,
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              background: 'var(--color-accent)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Pause size={8} color="#fff" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
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

                      {/* Play button */}
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 'var(--radius-full)',
                          background:
                            isAlbumPlaying ? 'var(--color-accent)' : 'var(--color-bg-dark)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all var(--transition-fast) ease',
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
          </>
        )}
      </div>

      {/* ========== NOW PLAYING BAR (compact) ========== */}
      {currentTrack && (
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'var(--color-surface-elevated)',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {/* Progress bar */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
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
                width: `${Math.round(progress * 100)}%`,
                background: 'var(--color-accent)',
                transition: 'width 0.1s linear',
              }}
            />
          </div>

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
          </div>

          <button
            onClick={togglePlayPause}
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {isPlaying ? (
              <Pause size={14} color="#fff" />
            ) : (
              <Play size={14} color="#fff" style={{ marginLeft: 1 }} />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
