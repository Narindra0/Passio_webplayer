import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileAudio, HardDrive, Music, ShieldCheck, Trash2, WifiOff } from 'lucide-react';
import { Screen, PageHeader } from '@/components/Screen';
import { AlbumCard } from '@/components/AlbumCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { formatTitle } from '@/utils/formatTitle';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { listOwnedAlbums } from '@/services/api';
import { listVaultAlbums, isAlbumReadyOffline } from '@/services/downloadManager';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import type { PublicAlbumSummary } from '@/types/backend';
import type { DeviceTrack } from '@/types/localLibrary';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

type MobileTab = 'owned' | 'downloaded' | 'files';
const TAB_ORDER: MobileTab[] = ['owned', 'downloaded', 'files'];

export function LocalScreen() {
  const navigate = useNavigate();
  const { playDeviceTrackAtIndex } = useAudioPlayback();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [mobileTab, setMobileTab] = useState<MobileTab>('owned');

  // Owned albums (via PassCode activation)
  const [ownedAlbums, setOwnedAlbums] = useState<PublicAlbumSummary[]>([]);
  const [loadingOwned, setLoadingOwned] = useState(true);
  const [ownedError, setOwnedError] = useState<string | null>(null);

  // Downloaded albums (offline vault)
  const [downloadedAlbums, setDownloadedAlbums] = useState<PublicAlbumSummary[]>([]);
  const [loadingDownloaded, setLoadingDownloaded] = useState(true);
  const [downloadedReadyMap, setDownloadedReadyMap] = useState<Map<string, boolean>>(new Map());

  // Local files (importés depuis l'appareil)
  const [localTracks, setLocalTracks] = useState<DeviceTrack[]>([]);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Charger les albums possédés
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoadingOwned(true);
        const albums = await listOwnedAlbums();
        if (!cancelled) {
          setOwnedAlbums(albums.filter(a => ['published', 'scheduled'].includes(a.status)));
          setOwnedError(null);
        }
      } catch {
        if (!cancelled) setOwnedError('Impossible de charger les albums possédés.');
      } finally {
        if (!cancelled) setLoadingOwned(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // Charger les albums téléchargés (vault local)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoadingDownloaded(true);
        const vault = await listVaultAlbums();
        if (!cancelled) {
          setDownloadedAlbums(vault);
          // Vérifier le statut de téléchargement complet pour chaque album
          const readyMap = new Map<string, boolean>();
          await Promise.all(
            vault.map(async (a) => {
              const ready = await isAlbumReadyOffline(a.id);
              readyMap.set(a.id, ready);
            }),
          );
          setDownloadedReadyMap(readyMap);
        }
      } catch {
        // Silencieux — le vault local peut être vide
      } finally {
        if (!cancelled) setLoadingDownloaded(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // Import de fichiers locaux
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setIsLoadingLocal(true);
    setLocalError(null);
    const audioFiles: DeviceTrack[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('audio/')) {
        audioFiles.push({
          id: `local-${i}-${Date.now()}`,
          uri: URL.createObjectURL(file),
          title: file.name.replace(/\.[^/.]+$/, ''),
          artist: 'Artiste inconnu',
          album: 'Fichier local',
          duration: 0,
          artworkUri: null,
        });
      }
    }
    if (audioFiles.length === 0) {
      setLocalError('Aucun fichier audio trouvé. Sélectionnez des fichiers .mp3, .wav, .ogg etc.');
    }
    setLocalTracks(audioFiles);
    setIsLoadingLocal(false);
  }, []);

  const handleTrackPress = useCallback((index: number) => {
    playDeviceTrackAtIndex(localTracks, index);
  }, [localTracks, playDeviceTrackAtIndex]);

  // ───────── COMPOSANTS DE SECTION RÉUTILISABLES ─────────

  const sectionGap = isMobile ? 24 : 40;
  const gridColumns = isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(160px, 1fr))';
  const gridGap = isMobile ? 10 : 16;

  function OwnedSection() {
    return (
      <section style={{ marginBottom: sectionGap }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: isMobile ? 14 : 20,
        }}>
          <div style={{
            width: isMobile ? 28 : 32,
            height: isMobile ? 28 : 32,
            borderRadius: 'var(--radius-full)',
            background: 'linear-gradient(135deg, #FFD700, #FFA500)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 12px rgba(255,215,0,0.25)',
          }}>
            <ShieldCheck size={isMobile ? 14 : 16} color="#000" />
          </div>
          <div>
            <h2 style={{
              color: 'var(--color-text-primary)',
              fontSize: isMobile ? 17 : 20,
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-0.3px',
            }}>
              Albums possédés
            </h2>
            <p style={{
              color: 'var(--color-text-muted)',
              fontSize: isMobile ? 12 : 13,
              margin: '2px 0 0',
              fontWeight: 500,
            }}>
              {loadingOwned ? 'Chargement…' : `${ownedAlbums.length} album${ownedAlbums.length > 1 ? 's' : ''} activé${ownedAlbums.length > 1 ? 's' : ''} via PassCode`}
            </p>
          </div>
        </div>

        {loadingOwned ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: isMobile ? 24 : 40 }}>
            <div className="loader-spinner" />
          </div>
        ) : ownedError ? (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: isMobile ? 12 : 14, borderRadius: 'var(--radius-sm)',
            background: 'rgba(220,20,60,0.06)',
            border: '1px solid rgba(220,20,60,0.12)',
          }}>
            <WifiOff size={16} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? 13 : 14, lineHeight: '20px', margin: 0 }}>
              {ownedError}
            </p>
          </div>
        ) : ownedAlbums.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: gridColumns,
            gap: gridGap,
          }}>
            {ownedAlbums.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                variant="tile"
                premiumLabel={
                  !album.is_free
                    ? album.price_ariary > 0
                      ? `${album.price_ariary.toLocaleString()} Ar`
                      : 'Premium'
                    : undefined
                }
                onPress={() => navigate(`/album/${album.id}`)}
              />
            ))}
          </div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: isMobile ? 12 : 14, borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
          }}>
            <ShieldCheck size={16} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
            <p style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? 13 : 14, lineHeight: '20px', margin: 0 }}>
              Aucun album activé pour le moment.{' '}
              <span
                onClick={() => navigate('/activate')}
                style={{ color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
              >
                Activer un PassCode →
              </span>
            </p>
          </div>
        )}
      </section>
    );
  }

  function DownloadedSection() {
    return (
      <section style={{ marginBottom: sectionGap }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: isMobile ? 14 : 20,
        }}>
          <div style={{
            width: isMobile ? 28 : 32,
            height: isMobile ? 28 : 32,
            borderRadius: 'var(--radius-full)',
            background: 'linear-gradient(135deg, #1DB954, #169C46)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 12px rgba(29,185,84,0.25)',
          }}>
            <HardDrive size={isMobile ? 14 : 16} color="#fff" />
          </div>
          <div>
            <h2 style={{
              color: 'var(--color-text-primary)',
              fontSize: isMobile ? 17 : 20,
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-0.3px',
            }}>
              Téléchargements
            </h2>
            <p style={{
              color: 'var(--color-text-muted)',
              fontSize: isMobile ? 12 : 13,
              margin: '2px 0 0',
              fontWeight: 500,
            }}>
              {loadingDownloaded ? 'Chargement…' : `${downloadedAlbums.length} album${downloadedAlbums.length > 1 ? 's' : ''} disponible${downloadedAlbums.length > 1 ? 's' : ''} hors-ligne`}
            </p>
          </div>
        </div>

        {loadingDownloaded ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: isMobile ? 24 : 40 }}>
            <div className="loader-spinner" />
          </div>
        ) : downloadedAlbums.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: gridColumns,
            gap: gridGap,
          }}>
            {downloadedAlbums.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                variant="tile"
                isOffline={downloadedReadyMap.get(album.id) ?? false}
                onPress={() => navigate(`/album/${album.id}`)}
              />
            ))}
          </div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: isMobile ? 12 : 14, borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
          }}>
            <Download size={16} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
            <p style={{ color: 'var(--color-text-secondary)', fontSize: isMobile ? 13 : 14, lineHeight: '20px', margin: 0 }}>
              Aucun album téléchargé. Parcourez le catalogue et téléchargez des albums pour les écouter hors-ligne.
            </p>
          </div>
        )}
      </section>
    );
  }

  function LocalFilesSection() {
    return (
      <section style={{ marginBottom: 24 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: isMobile ? 14 : 20,
        }}>
          <div style={{
            width: isMobile ? 28 : 32,
            height: isMobile ? 28 : 32,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <FileAudio size={isMobile ? 14 : 16} color="var(--color-text-secondary)" />
          </div>
          <div>
            <h2 style={{
              color: 'var(--color-text-primary)',
              fontSize: isMobile ? 17 : 20,
              fontWeight: 700,
              margin: 0,
              letterSpacing: '-0.3px',
            }}>
              Fichiers importés
            </h2>
            <p style={{
              color: 'var(--color-text-muted)',
              fontSize: isMobile ? 12 : 13,
              margin: '2px 0 0',
              fontWeight: 500,
            }}>
              {localTracks.length > 0
                ? `${localTracks.length} fichier${localTracks.length > 1 ? 's' : ''} audio importé${localTracks.length > 1 ? 's' : ''}`
                : 'Importez des fichiers audio depuis votre appareil'}
            </p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: isMobile ? 16 : 24 }}>
          <PrimaryButton
            label="Sélectionner des fichiers audio"
            onPress={() => fileInputRef.current?.click()}
          />
        </div>

        {localError && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: 12, borderRadius: 'var(--radius-sm)',
            background: 'rgba(233,20,41,0.08)', border: '1px solid rgba(233,20,41,0.15)',
            marginBottom: 16,
          }}>
            <Trash2 size={14} color="var(--color-error)" />
            <p className="text-error" style={{ fontSize: 13, margin: 0 }}>{localError}</p>
          </div>
        )}

        {isLoadingLocal ? (
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
        ) : localTracks.length > 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column',
            borderRadius: 'var(--radius-md)', overflow: 'hidden',
            border: '1px solid var(--color-border-subtle)',
          }}>
            {localTracks.map((track, index) => (
              <button
                key={track.id}
                onClick={() => handleTrackPress(index)}
                style={{
                  display: 'flex', alignItems: 'center',
                  padding: isMobile ? '10px 12px' : '12px 16px',
                  border: 'none',
                  borderBottom: index < localTracks.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                  background: 'transparent', cursor: 'pointer',
                  textAlign: 'left', width: '100%',
                  transition: 'background-color var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: isMobile ? 36 : 40,
                  height: isMobile ? 36 : 40,
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--color-surface-elevated)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  marginRight: isMobile ? 10 : 14, flexShrink: 0,
                }}>
                  <Music size={isMobile ? 18 : 20} color="var(--color-text-muted)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    color: 'var(--color-text-primary)',
                    fontSize: isMobile ? 13 : 14,
                    fontWeight: 600,
                    margin: 0, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {formatTitle(track.title)}
                  </p>
                  <p style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: isMobile ? 11 : 12,
                    margin: '2px 0 0',
                  }}>
                    {track.artist}
                  </p>
                </div>
                <p style={{
                  color: 'var(--color-text-muted)',
                  fontSize: isMobile ? 12 : 13,
                  margin: 0,
                  fontVariantNumeric: 'tabular-nums',
                  marginLeft: isMobile ? 8 : 0,
                }}>
                  {track.duration > 0 ? formatDuration(track.duration) : '--:--'}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            padding: isMobile ? '24px 16px' : '40px 20px', textAlign: 'center',
          }}>
            <Music size={isMobile ? 24 : 32} color="var(--color-text-muted)" style={{ opacity: 0.4 }} />
            <p style={{ color: 'var(--color-text-muted)', fontSize: isMobile ? 13 : 14, margin: 0 }}>
              Sélectionnez des fichiers audio pour les écouter
            </p>
          </div>
        )}
      </section>
    );
  }

  // ───────── MOBILE HEADER ─────────
  function MobileHeader() {
    const tabCounts = {
      owned: ownedAlbums.length,
      downloaded: downloadedAlbums.length,
      files: localTracks.length,
    };
    const tabLabels: Record<MobileTab, string> = {
      owned: 'Possédés',
      downloaded: 'Téléchargés',
      files: 'Fichiers',
    };
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        paddingBottom: 16,
      }}>
        <h1 style={{
          color: 'var(--color-text-primary)',
          fontSize: 'clamp(28px, 3.5vw, 32px)',
          fontWeight: 700,
          letterSpacing: '-0.5px',
          margin: 0,
          lineHeight: 1.15,
        }}>
          Bibliothèque Locale
        </h1>
        {/* Tab selector */}
        <div style={{
          display: 'flex',
          gap: 0,
          background: 'var(--color-surface-elevated)',
          borderRadius: 'var(--radius-full)',
          padding: 3,
          alignSelf: 'flex-start',
        }}>
          {(['owned', 'downloaded', 'files'] as MobileTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-full)',
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: mobileTab === tab ? 'var(--color-bg-dark)' : 'transparent',
                color: mobileTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                transition: 'all var(--transition-fast) ease',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {tabLabels[tab]}
              {tabCounts[tab] > 0 && (
                <span style={{
                  fontSize: 10,
                  color: mobileTab === tab ? 'var(--color-text-muted)' : 'var(--color-text-muted)',
                  opacity: 0.6,
                }}>
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ───────── TAB SLIDE DIRECTION ─────────
  const prevTabRef = useRef<MobileTab>('owned');
  const [slideDirection, setSlideDirection] = useState<'right' | 'left' | null>(null);

  // Compute slide direction when tab changes (null initial = no animation on first render)
  useEffect(() => {
    const prevIdx = TAB_ORDER.indexOf(prevTabRef.current);
    const currIdx = TAB_ORDER.indexOf(mobileTab);
    if (currIdx > prevIdx) {
      setSlideDirection('right');
    } else if (currIdx < prevIdx) {
      setSlideDirection('left');
    }
    prevTabRef.current = mobileTab;
  }, [mobileTab]);

  // Animation class based on direction (empty on initial render)
  const tabAnimationClass = slideDirection === 'right' ? 'slide-in-right' : slideDirection === 'left' ? 'slide-in-left' : '';

  // ───────── PULL-TO-REFRESH ─────────
  const handleRefresh = useCallback(async () => {
    // Reload owned albums
    try {
      const albums = await listOwnedAlbums();
      setOwnedAlbums(albums.filter(a => ['published', 'scheduled'].includes(a.status)));
      setOwnedError(null);
    } catch {
      setOwnedError('Impossible de charger les albums possédés.');
    }

    // Reload downloaded albums
    try {
      const vault = await listVaultAlbums();
      setDownloadedAlbums(vault);
      const readyMap = new Map<string, boolean>();
      await Promise.all(
        vault.map(async (a) => {
          const ready = await isAlbumReadyOffline(a.id);
          readyMap.set(a.id, ready);
        }),
      );
      setDownloadedReadyMap(readyMap);
    } catch {
      // Silencieux
    }
  }, []);

  const {
    pullProgress,
    isReady,
    isRefreshing,
    containerProps,
    indicatorStyle,
  } = usePullToRefresh({
    onRefresh: handleRefresh,
    enabled: isMobile,
    threshold: 70,
  });

  // ───────── RENDU PRINCIPAL ─────────

  if (isMobile) {
    return (
      <Screen padded maxWidth="1000px">
        <div
          {...containerProps}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'none',
            WebkitOverflowScrolling: 'touch',
            position: 'relative',
            paddingTop: isRefreshing ? 40 : 0,
            transition: 'padding-top 0.25s ease',
          }}
        >
          {/* ── Pull-to-refresh indicator ── */}
          <div
            style={{
              position: 'absolute',
              top: isRefreshing ? 8 : 'auto',
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: 40,
              zIndex: 10,
              ...indicatorStyle,
            }}
          >
            {isRefreshing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    border: '2px solid var(--color-border-subtle)',
                    borderTopColor: 'var(--color-accent)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600 }}>
                  Mise à jour…
                </span>
              </div>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: `rotate(${Math.min(pullProgress * 180, 180)}deg)`,
                  transition: isRefreshing || isReady ? 'none' : 'transform 0.1s linear',
                  opacity: isReady ? 1 : Math.min(pullProgress * 2, 1),
                }}
              >
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
            )}
          </div>

          <MobileHeader />

          <div key={mobileTab} className={tabAnimationClass}>
            {mobileTab === 'owned' && <OwnedSection />}
            {mobileTab === 'downloaded' && <DownloadedSection />}
            {mobileTab === 'files' && <LocalFilesSection />}
          </div>

          {/* Bottom spacing for mobile nav */}
          <div style={{ height: 80 }} />
        </div>
      </Screen>
    );
  }

  return (
    <Screen padded maxWidth="1000px">
      <PageHeader
        title="Bibliothèque Locale"
        subtitle="Retrouvez vos albums possédés, téléchargés et fichiers importés."
      />

      <OwnedSection />
      <DownloadedSection />
      <LocalFilesSection />
    </Screen>
  );
}
