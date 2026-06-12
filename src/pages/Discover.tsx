import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Clock, TrendingUp, ChevronLeft, ChevronRight, ShoppingBag, Filter, Music, Users, Disc, Trophy, Play, Heart } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { ArtistCard } from '@/components/ArtistCard';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { isAlbumReadyOffline } from '@/services/downloadManager';
import { freeCatalogDetailsMap, readFreeCatalogCache, writeFreeCatalogCache, staleWhileRevalidate } from '@/services/freeCatalogCache';
import { buildArtistsFromAlbums, mapTracksFromAlbum } from '@/services/freeCatalogSearch';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { getPurchaseAlbumUrl } from '@/config/urls';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';

interface FilterState {
  albumType: string;
  priceFilter: string;
  sortBy: string;
}

const ALBUM_TYPES = ['Tous', 'album', 'single', 'ep'];
const PRICE_FILTERS = ['Tous', 'Gratuit', 'Payant'];
const SORT_OPTIONS = ['Plus récent', 'Plus ancien', 'A-Z', 'Z-A'];

export function DiscoverScreen() {
  const navigate = useNavigate();
  const { playFromTrackList, currentTrack, isPlaying } = useAudioPlayback();

  const [newAlbums, setNewAlbums] = useState<PublicAlbumSummary[]>([]);
  const [paidAlbums, setPaidAlbums] = useState<PublicAlbumSummary[]>([]);
  const [freeTracks, setFreeTracks] = useState<TrackWithAlbum[]>([]);
  const [artists, setArtists] = useState<{ id: string; name: string; profile_picture_url?: string | null; fallback_image_url?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerAlbums, setBannerAlbums] = useState<PublicAlbumSummary[]>([]);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    albumType: 'Tous',
    priceFilter: 'Tous',
    sortBy: 'Plus récent',
  });
  const bannerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());
  const scrollRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Auto-advance banners using real album data when available
  useEffect(() => {
    const count = bannerAlbums.length || 1;
    const interval = setInterval(() => {
      setCurrentBannerIndex((prev) => (prev + 1) % count);
    }, 5000);
    bannerIntervalRef.current = interval;
    return () => clearInterval(interval);
  }, [bannerAlbums.length]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Stratégie stale-while-revalidate : vérifier le cache d'abord
      const cacheResult = await staleWhileRevalidate(async () => {
        const albums = await listAlbums();
        const freeAlbums = albums.filter((a) => a.is_free === true);
        const detailsMap = new Map<string, PublicAlbumDetails>();
        const albumDetailsList = await Promise.all(
          freeAlbums.map(async (album) => {
            try {
              const offline = await resolveOfflinePlayback(album.id);
              if (offline.metadata) { detailsMap.set(album.id, offline.metadata); return { album, details: offline.metadata }; }
              const details = unwrapAlbumDetails(await getAlbum(album.id));
              detailsMap.set(album.id, details);
              return { album, details };
            } catch { return null; }
          }),
        );
        return { albums, albumDetails: detailsMap };
      });

      // Si on a des données en cache, les utiliser immédiatement
      if (cacheResult.data) {
        const { albums, albumDetails } = cacheResult.data;
        const detailsMap = freeCatalogDetailsMap(cacheResult.data);
        albumCacheRef.current = detailsMap;

        const sorted = [...albums].sort((a, b) => {
          const da = a.created_at ? new Date(a.created_at).getTime() : 0;
          const db = b.created_at ? new Date(b.created_at).getTime() : 0;
          return db - da;
        });
        setNewAlbums(sorted);

        const bannerAlbums = albums
          .filter((a) => a.cover_url && a.status === 'published')
          .slice(0, 5);
        setBannerAlbums(bannerAlbums);

        const paid = albums.filter((a) => !a.is_free && a.status === 'published');
        setPaidAlbums(paid.slice(0, 4));

        const tracks: TrackWithAlbum[] = [];
        for (const album of albums) {
          const details = detailsMap.get(album.id);
          if (details) tracks.push(...mapTracksFromAlbum(album, details));
        }
        tracks.sort((a, b) => {
          const albumA = albums.find((al) => al.id === a.album_id);
          const albumB = albums.find((al) => al.id === b.album_id);
          const da = albumA?.created_at ? new Date(albumA.created_at).getTime() : 0;
          const db = albumB?.created_at ? new Date(albumB.created_at).getTime() : 0;
          return db - da;
        });
        setFreeTracks(tracks.slice(0, 20));

        setArtists(buildArtistsFromAlbums(albums));

        // Si le cache était périmé, un rafraîchissement arrière-plan est en cours
        // Les données seront mises à jour lors du prochain chargement
        setLoading(false);
        return;
      }

      // Aucun cache disponible — faire l'appel réseau normal
      const albums = await listAlbums();
      const freeAlbums = albums.filter((a) => a.is_free === true);
      const cache = new Map<string, PublicAlbumDetails>();
      const albumDetailsList = await Promise.all(
        freeAlbums.map(async (album) => {
          try {
            const offline = await resolveOfflinePlayback(album.id);
            if (offline.metadata) { cache.set(album.id, offline.metadata); return { album, details: offline.metadata }; }
            const details = unwrapAlbumDetails(await getAlbum(album.id));
            cache.set(album.id, details);
            return { album, details };
          } catch { return null; }
        }),
      );
      albumCacheRef.current = cache;

      const sorted = [...albums].sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
      setNewAlbums(sorted);

      const bannerAlbums = albums
        .filter((a) => a.cover_url && a.status === 'published')
        .slice(0, 5);
      setBannerAlbums(bannerAlbums);

      const paid = albums.filter((a) => !a.is_free && a.status === 'published');
      setPaidAlbums(paid.slice(0, 4));

      const tracks: TrackWithAlbum[] = [];
      for (const item of albumDetailsList) {
        if (item) tracks.push(...mapTracksFromAlbum(item.album, item.details));
      }
      tracks.sort((a, b) => {
        const albumA = albums.find((al) => al.id === a.album_id);
        const albumB = albums.find((al) => al.id === b.album_id);
        const da = albumA?.created_at ? new Date(albumA.created_at).getTime() : 0;
        const db = albumB?.created_at ? new Date(albumB.created_at).getTime() : 0;
        return db - da;
      });
      setFreeTracks(tracks.slice(0, 20));

      await writeFreeCatalogCache(freeAlbums, cache);
      setArtists(buildArtistsFromAlbums(albums));
    } catch {
      // Fallback : utiliser le cache même s'il est périmé
      const cached = await readFreeCatalogCache();
      if (cached) {
        const detailsMap = freeCatalogDetailsMap(cached);
        albumCacheRef.current = detailsMap;
        const offlineAlbums: PublicAlbumSummary[] = [];
        for (const album of cached.albums) {
          if (await isAlbumReadyOffline(album.id)) offlineAlbums.push(album);
        }
        const sorted = [...offlineAlbums].sort((a, b) => {
          const da = a.created_at ? new Date(a.created_at).getTime() : 0;
          const db = b.created_at ? new Date(b.created_at).getTime() : 0;
          return db - da;
        });
        setNewAlbums(sorted);
        const paid = offlineAlbums.filter((a) => !a.is_free && a.status === 'published');
        setPaidAlbums(paid.slice(0, 4));
        setArtists(buildArtistsFromAlbums(offlineAlbums));
        const bannerAlbums = offlineAlbums
          .filter((a) => a.cover_url && a.status === 'published')
          .slice(0, 5);
        setBannerAlbums(bannerAlbums);
        const tracks = offlineAlbums.flatMap((album) => {
          const details = detailsMap.get(album.id);
          return details ? mapTracksFromAlbum(album, details) : [];
        });
        tracks.sort((a, b) => {
          const albumA = offlineAlbums.find((al) => al.id === a.album_id);
          const albumB = offlineAlbums.find((al) => al.id === b.album_id);
          const da = albumA?.created_at ? new Date(albumA.created_at).getTime() : 0;
          const db = albumB?.created_at ? new Date(albumB.created_at).getTime() : 0;
          return db - da;
        });
        setFreeTracks(tracks.slice(0, 20));
      } else {
        setError('Impossible de charger les nouveautés.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const scrollSection = (key: string, direction: 'left' | 'right') => {
    const ref = scrollRefs.current[key];
    if (!ref) return;
    const scrollAmount = 380;
    ref.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  async function handleTrackPress(track: TrackWithAlbum) {
    try { await playFromTrackList(freeTracks, albumCacheRef.current, track.id); }
    catch { /* ignore */ }
  }

  const filteredAlbums = newAlbums
    .filter(album => {
      // Filtre par type d'album
      if (filters.albumType !== 'Tous') {
        const albumType = album.type || 'album';
        if (albumType !== filters.albumType) return false;
      }
      // Filtre gratuit/payant
      if (filters.priceFilter !== 'Tous') {
        if (filters.priceFilter === 'Gratuit' && !album.is_free) return false;
        if (filters.priceFilter === 'Payant' && album.is_free) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (filters.sortBy === 'Plus récent') {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      }
      if (filters.sortBy === 'Plus ancien') {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return da - db;
      }
      if (filters.sortBy === 'A-Z') return (a.title || '').localeCompare(b.title || '');
      if (filters.sortBy === 'Z-A') return (b.title || '').localeCompare(a.title || '');
      return 0;
    });

  return (
    <Screen gradient padded>
      {/* Header with Filter Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 16px rgba(220,20,60,0.25)',
          }}>
            <Sparkles size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{
              color: 'var(--color-text-primary)',
              fontSize: 'clamp(28px, 3.5vw, 32px)',
              fontWeight: 700,
              letterSpacing: '-0.5px',
              margin: 0,
              lineHeight: 1.15,
            }}>
              Découverte
            </h1>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: 14,
              margin: '2px 0 0',
              lineHeight: 1.4,
            }}>
              Nouveautés et tendances
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn-ghost"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 'var(--radius-full)',
            background: showFilters ? 'var(--color-surface-elevated)' : 'transparent',
            border: showFilters ? '1px solid var(--color-border-highlight)' : '1px solid var(--color-border-subtle)',
          }}
        >
          <Filter size={18} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Filtres</span>
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          padding: '16px 0',
          borderBottom: '1px solid var(--color-border-subtle)',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
            <label style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>Type</label>
            <select
              value={filters.albumType}
              onChange={(e) => setFilters({ ...filters, albumType: e.target.value })}
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
                fontSize: 14,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {ALBUM_TYPES.map(type => (
                <option key={type} value={type}>{type === 'Tous' ? 'Tous' : type.charAt(0).toUpperCase() + type.slice(1)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
            <label style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>Prix</label>
            <select
              value={filters.priceFilter}
              onChange={(e) => setFilters({ ...filters, priceFilter: e.target.value })}
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
                fontSize: 14,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {PRICE_FILTERS.map(price => (
                <option key={price} value={price}>{price}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
            <label style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 600 }}>Trier par</label>
            <select
              value={filters.sortBy}
              onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
                fontSize: 14,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {SORT_OPTIONS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: '60px 0' }}>
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 16, padding: '60px 20px', textAlign: 'center',
        }}>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 15, margin: 0 }}>{error}</p>
          <button onClick={() => void loadData()} className="btn-secondary">Réessayer</button>
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
          {/* Rotating Banner Carousel — alimenté par les albums réels */}
          {bannerAlbums.length > 0 && (
            <div className="desktop-only">
              <div style={{
                position: 'relative',
                width: '100%',
                height: 340,
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}>
                {bannerAlbums.map((album, index) => {
                  const artistName = album.artist_name || album.artist?.name || 'Artiste';
                  const albumType = album.type === 'single' ? 'Single' : album.type === 'ep' ? 'EP' : 'Album';
                  return (
                    <div
                      key={album.id}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: index === currentBannerIndex ? 1 : 0,
                        transition: 'opacity 0.6s ease-in-out',
                        display: 'flex',
                        alignItems: 'flex-end',
                      }}
                    >
                      {/* Background Image */}
                      <div style={{ position: 'absolute', inset: 0 }}>
                        <img
                          src={album.cover_url || ''}
                          alt={album.title}
                          loading="lazy"
                          decoding="async"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'linear-gradient(135deg, rgba(220,20,60,0.85), rgba(100,10,40,0.85))',
                        }} />
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'linear-gradient(90deg, rgba(0,0,0,0.7) 0%, transparent 50%, rgba(0,0,0,0.4) 100%)',
                        }} />
                      </div>
                      {/* Banner Content */}
                      <div
                        style={{
                          position: 'relative',
                          zIndex: 10,
                          padding: '40px 60px',
                          maxWidth: 600,
                          cursor: 'pointer',
                        }}
                        onClick={() => navigate(`/album/${album.id}`)}
                      >
                        <p style={{
                          color: 'rgba(255,255,255,0.8)',
                          fontSize: 14,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '1.5px',
                          margin: '0 0 8px',
                        }}>
                          {album.is_free ? 'Gratuit' : 'Premium'} · {albumType}
                        </p>
                        <h2 style={{
                          color: '#fff',
                          fontSize: 48,
                          fontWeight: 800,
                          lineHeight: '52px',
                          margin: '0 0 8px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {album.title}
                        </h2>
                        <p style={{
                          color: 'rgba(255,255,255,0.9)',
                          fontSize: 18,
                          margin: '0 0 24px',
                        }}>
                          {artistName}
                        </p>
                        <button
                          className="btn-primary"
                          style={{
                            padding: '14px 32px',
                            fontSize: 16,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/album/${album.id}`);
                          }}
                        >
                          <Play size={20} fill="#fff" />
                          Découvrir
                        </button>
                      </div>
                    </div>
                  );
                })}
                {/* Banner Navigation Dots */}
                <div style={{
                  position: 'absolute',
                  bottom: 24,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  gap: 8,
                  zIndex: 20,
                }}>
                  {bannerAlbums.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentBannerIndex(index)}
                      style={{
                        width: index === currentBannerIndex ? 24 : 8,
                        height: 8,
                        borderRadius: 'var(--radius-full)',
                        background: index === currentBannerIndex ? '#fff' : 'rgba(255,255,255,0.4)',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Premium Projects Banner — Desktop only */}
          {paidAlbums.length > 0 && (
            <div className="desktop-only">
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: 'var(--radius-full)',
                    background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                  }}>
                    ★
                  </div>
                  <h2 className="section-title">Projets Premium</h2>
                </div>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: 16,
              }}>
                {paidAlbums.slice(0, 4).map((album) => (
                  <PromoBannerCard
                    key={album.id}
                    album={album}
                    onPress={() => navigate(`/album/${album.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Trending Top 3 - Horizontal Scroll */}
          {artists.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Trophy size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Top 3 du moment</h2>
                </div>
              </div>
              <div style={{ position: 'relative' }}>
                <div
                  ref={(el) => { scrollRefs.current['trending'] = el; }}
                  style={{
                    display: 'flex',
                    gap: 16,
                    overflowX: 'auto',
                    padding: '4px 0',
                    scrollbarWidth: 'none',
                    scrollBehavior: 'smooth',
                  }}
                >
                  {/* Top Artists */}
                  {artists.slice(0, 3).map((artist, index) => (
                    <div key={artist.id} style={{ minWidth: 280, flexShrink: 0 }}>
                      <div style={{
                        position: 'relative',
                        borderRadius: 'var(--radius-lg)',
                        overflow: 'hidden',
                        background: 'var(--color-surface-elevated)',
                        padding: 20,
                        cursor: 'pointer',
                        transition: 'transform var(--transition-normal) ease',
                      }}
                        onClick={() => navigate(`/artist/${artist.id}`)}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                      >
                        <div style={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          width: 40,
                          height: 40,
                          borderRadius: 'var(--radius-full)',
                          background: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 20,
                          fontWeight: 800,
                          color: index === 0 ? '#000' : '#fff',
                          boxShadow: 'var(--shadow-md)',
                        }}>
                          {index + 1}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 20 }}>
                          <div style={{
                            width: 80,
                            height: 80,
                            borderRadius: 'var(--radius-full)',
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}>
                            {(artist.profile_picture_url || artist.fallback_image_url) ? (
                              <img
                                src={artist.profile_picture_url || artist.fallback_image_url || ''}
                                alt={artist.name}
                                loading="lazy"
                                decoding="async"
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <div style={{
                                width: '100%',
                                height: '100%',
                                background: 'var(--color-accent)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 32,
                                fontWeight: 800,
                                color: '#fff',
                              }}>
                                {artist.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{
                              color: 'var(--color-text-secondary)',
                              fontSize: 12,
                              fontWeight: 600,
                              margin: 0,
                            }}>
                              Artiste
                            </p>
                            <h3 style={{
                              color: 'var(--color-text-primary)',
                              fontSize: 20,
                              fontWeight: 700,
                              margin: '4px 0',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {artist.name}
                            </h3>
                            <p style={{
                              color: 'var(--color-text-muted)',
                              fontSize: 13,
                              margin: 0,
                            }}>
                              Artiste à découvrir
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Top Albums */}
                  {newAlbums.slice(0, 3).map((album, index) => (
                    <div key={album.id} style={{ minWidth: 280, flexShrink: 0 }}>
                      <div style={{
                        position: 'relative',
                        borderRadius: 'var(--radius-lg)',
                        overflow: 'hidden',
                        background: 'var(--color-surface-elevated)',
                        padding: 20,
                        cursor: 'pointer',
                        transition: 'transform var(--transition-normal) ease',
                      }}
                        onClick={() => navigate(`/album/${album.id}`)}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                      >
                        <div style={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          width: 40,
                          height: 40,
                          borderRadius: 'var(--radius-full)',
                          background: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 20,
                          fontWeight: 800,
                          color: index === 0 ? '#000' : '#fff',
                          boxShadow: 'var(--shadow-md)',
                        }}>
                          {index + 1}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 20 }}>
                          <div style={{
                            width: 80,
                            height: 80,
                            borderRadius: 'var(--radius-sm)',
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}>
                            {album.cover_url ? (
                              <img
                                src={album.cover_url}
                                alt={album.title}
                                loading="lazy"
                                decoding="async"
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <div style={{
                                width: '100%',
                                height: '100%',
                                background: 'var(--color-accent)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 32,
                                fontWeight: 800,
                                color: '#fff',
                              }}>
                                ♪
                              </div>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{
                              color: 'var(--color-text-secondary)',
                              fontSize: 12,
                              fontWeight: 600,
                              margin: 0,
                            }}>
                              Album
                            </p>
                            <h3 style={{
                              color: 'var(--color-text-primary)',
                              fontSize: 20,
                              fontWeight: 700,
                              margin: '4px 0',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {album.title}
                            </h3>
                            <p style={{
                              color: 'var(--color-text-muted)',
                              fontSize: 13,
                              margin: 0,
                            }}>
                              {album.artist_name || album.artist?.name}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {artists.length + newAlbums.length > 4 && (
                  <>
                    <button
                      onClick={() => scrollSection('trending', 'left')}
                      className="btn-ghost"
                      style={{
                        position: 'absolute',
                        left: -10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-full)',
                        padding: 0,
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border-subtle)',
                        zIndex: 10,
                      }}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button
                      onClick={() => scrollSection('trending', 'right')}
                      className="btn-ghost"
                      style={{
                        position: 'absolute',
                        right: -10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-full)',
                        padding: 0,
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border-subtle)',
                        zIndex: 10,
                      }}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* New Releases — Horizontal Scroll */}
          {filteredAlbums.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Nouveautés</h2>
                </div>
              </div>
              <div style={{ position: 'relative' }}>
                <div
                  ref={(el) => { scrollRefs.current['newAlbums'] = el; }}
                  style={{
                    display: 'flex',
                    gap: 16,
                    overflowX: 'auto',
                    padding: '4px 0',
                    scrollbarWidth: 'none',
                    scrollBehavior: 'smooth',
                  }}
                >
                  {filteredAlbums.slice(0, 20).map((album) => (
                    <div key={album.id} style={{ width: 180, flexShrink: 0 }}>
                      <AlbumCard album={album} variant="tile" onPress={() => navigate(`/album/${album.id}`)} />
                    </div>
                  ))}
                </div>
                {filteredAlbums.length > 5 && (
                  <>
                    <button
                      onClick={() => scrollSection('newAlbums', 'left')}
                      className="btn-ghost"
                      style={{
                        position: 'absolute',
                        left: -10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-full)',
                        padding: 0,
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border-subtle)',
                        zIndex: 10,
                      }}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button
                      onClick={() => scrollSection('newAlbums', 'right')}
                      className="btn-ghost"
                      style={{
                        position: 'absolute',
                        right: -10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-full)',
                        padding: 0,
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border-subtle)',
                        zIndex: 10,
                      }}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Trending Tracks — Horizontal Scroll */}
          {freeTracks.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Music size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Titres du moment</h2>
                </div>
              </div>
              <div style={{ position: 'relative' }}>
                <div
                  ref={(el) => { scrollRefs.current['tracks'] = el; }}
                  style={{
                    display: 'flex',
                    gap: 12,
                    overflowX: 'auto',
                    padding: '4px 0',
                    scrollbarWidth: 'none',
                    scrollBehavior: 'smooth',
                  }}
                >
                  {freeTracks.slice(0, 15).map((track, index) => (
                    <div key={track.id} style={{ minWidth: 300, flexShrink: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-md)',
                        background: 'transparent',
                        cursor: 'pointer',
                        transition: 'background-color var(--transition-fast) ease',
                      }}
                        onClick={() => void handleTrackPress(track)}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-surface-elevated)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{
                          width: 24,
                          color: 'var(--color-text-muted)',
                          fontSize: 14,
                          fontWeight: 600,
                          textAlign: 'center',
                        }}>
                          {index + 1}
                        </span>
                        <div style={{
                          width: 56,
                          height: 56,
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          flexShrink: 0,
                        }}>
                          {track.cover_url ? (
                            <img
                              src={track.cover_url}
                              alt={track.title}
                              loading="lazy"
                              decoding="async"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{
                              width: '100%',
                              height: '100%',
                              background: 'var(--color-surface-elevated)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 24,
                            }}>
                              ♪
                            </div>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            color: 'var(--color-text-primary)',
                            fontSize: 14,
                            fontWeight: 600,
                            margin: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {track.title}
                          </p>
                          <p style={{
                            color: 'var(--color-text-secondary)',
                            fontSize: 13,
                            margin: '2px 0 0',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {track.artist_name}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button style={{
                            width: 36,
                            height: 36,
                            borderRadius: 'var(--radius-full)',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                          >
                            <Heart size={18} />
                          </button>
                          {currentTrack?.id === track.id && isPlaying ? (
                            <div style={{
                              width: 36,
                              height: 36,
                              borderRadius: 'var(--radius-full)',
                              background: 'var(--color-accent)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}>
                              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                                {[1, 2, 3].map((i) => (
                                  <div key={i} style={{
                                    width: 3,
                                    height: 12 + Math.sin(Date.now() / 200 + i) * 6,
                                    background: '#fff',
                                    borderRadius: 'var(--radius-full)',
                                    transition: 'height 0.1s ease',
                                  }} />
                                ))}
                              </div>
                            </div>
                          ) : (
                            <button style={{
                              width: 36,
                              height: 36,
                              borderRadius: 'var(--radius-full)',
                              background: 'var(--color-accent)',
                              border: 'none',
                              color: '#fff',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}>
                              <Play size={18} fill="#fff" style={{ marginLeft: 2 }} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {freeTracks.length > 4 && (
                  <>
                    <button
                      onClick={() => scrollSection('tracks', 'left')}
                      className="btn-ghost"
                      style={{
                        position: 'absolute',
                        left: -10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-full)',
                        padding: 0,
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border-subtle)',
                        zIndex: 10,
                      }}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button
                      onClick={() => scrollSection('tracks', 'right')}
                      className="btn-ghost"
                      style={{
                        position: 'absolute',
                        right: -10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-full)',
                        padding: 0,
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border-subtle)',
                        zIndex: 10,
                      }}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Artists to Discover — Horizontal Scroll */}
          {artists.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Users size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Artistes à découvrir</h2>
                </div>
                <span
                  className="section-link"
                  onClick={() => navigate('/artists')}
                  style={{ cursor: 'pointer' }}
                >
                  Voir tout
                </span>
              </div>
              <div style={{ position: 'relative' }}>
                <div
                  ref={(el) => { scrollRefs.current['artists'] = el; }}
                  style={{
                    display: 'flex',
                    gap: 12,
                    overflowX: 'auto',
                    padding: '4px 0',
                    scrollbarWidth: 'none',
                    scrollBehavior: 'smooth',
                  }}
                >
                  {artists.slice(0, 15).map((artist) => (
                    <div key={artist.id} style={{ minWidth: 170, flexShrink: 0 }}>
                      <ArtistCard
                        artist={artist}
                        onPress={() => navigate(`/artist/${artist.id}`)}
                      />
                    </div>
                  ))}
                </div>
                {artists.length > 5 && (
                  <>
                    <button
                      onClick={() => scrollSection('artists', 'left')}
                      className="btn-ghost"
                      style={{
                        position: 'absolute',
                        left: -10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-full)',
                        padding: 0,
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border-subtle)',
                        zIndex: 10,
                      }}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button
                      onClick={() => scrollSection('artists', 'right')}
                      className="btn-ghost"
                      style={{
                        position: 'absolute',
                        right: -10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-full)',
                        padding: 0,
                        background: 'var(--color-bg-dark)',
                        border: '1px solid var(--color-border-subtle)',
                        zIndex: 10,
                      }}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* All Albums Grid */}
          {filteredAlbums.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Disc size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Tous les albums</h2>
                </div>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
                gap: 16,
              }}>
                {filteredAlbums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    variant="tile"
                    onPress={() => navigate(`/album/${album.id}`)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}

interface PromoBannerProps {
  album: PublicAlbumSummary;
  onPress: () => void;
}

function PromoBannerCard({ album, onPress }: PromoBannerProps) {
  const coverColors = useAlbumColors(album.cover_url);
  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';
  const price = album.price_ariary > 0
    ? `${album.price_ariary.toLocaleString()} Ar`
    : 'Gratuit';

  return (
    <button
      onClick={onPress}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 20,
        padding: 20,
        borderRadius: 'var(--radius-lg)',
        background: coverColors.gradientStyle || 'var(--color-surface-elevated)',
        border: '1px solid var(--color-border-subtle)',
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: 180,
        overflow: 'hidden',
        transition: 'all var(--transition-normal) ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
        e.currentTarget.style.borderColor = 'var(--color-border-highlight)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = 'var(--color-border-subtle)';
      }}
    >        {album.cover_url && (
        <div
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            overflow: 'hidden',
            zIndex: 0,
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <img
            src={album.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 0.15,
              filter: 'blur(20px)',
              transform: 'scale(1.2)',
            }}
          />
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: '60%',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
          zIndex: 1,
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          width: 120,
          height: 120,
          minWidth: 120,
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
          flexShrink: 0,
        }}
      >
        {album.cover_url ? (
          <img
            src={album.cover_url}
            alt={album.title}
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: '100%', height: '100%',
              background: 'var(--color-surface-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 32, color: 'var(--color-text-muted)' }}>♪</span>
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 24,
            height: 24,
            borderRadius: 'var(--radius-full)',
            background: 'linear-gradient(135deg, #FFD700, #FFA500)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          ★
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 2,
          flex: 1,
          minWidth: 0,
          paddingBottom: 4,
        }}
      >
        <p
          style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            margin: '0 0 6px',
          }}
        >
          Projet Premium
        </p>
        <h3
          style={{
            color: '#fff',
            fontSize: 18,
            fontWeight: 700,
            lineHeight: '22px',
            margin: '0 0 4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {album.title}
        </h3>
        <p
          style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: 13,
            fontWeight: 500,
            margin: '0 0 12px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artistName}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              color: '#FFD700',
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {price}
          </span>
          <a
            href={getPurchaseAlbumUrl(album.id)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              textDecoration: 'none',
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-accent-light)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--color-accent)';
            }}
          >
            <ShoppingBag size={14} />
            Acheter
          </a>
        </div>
      </div>
    </button>
  );
}
