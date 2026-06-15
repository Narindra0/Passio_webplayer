import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, ChevronLeft, ChevronRight,
  ShoppingBag, Filter, Music, Users, Disc, Play,
  Crown, Store, User, ArrowUpDown,
} from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { PremiumAlbumCard } from '@/components/PremiumAlbumCard';
import { ArtistCard } from '@/components/ArtistCard';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, listOwnedAlbums, unwrapAlbumDetails } from '@/services/api';
import { isAlbumReadyOffline } from '@/services/downloadManager';
import { freeCatalogDetailsMap, readFreeCatalogCache, writeFreeCatalogCache, staleWhileRevalidate } from '@/services/freeCatalogCache';
import { buildArtistsFromAlbums, mapTracksFromAlbum } from '@/services/freeCatalogSearch';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { useMediaQuery } from '@/hooks/useMediaQuery';
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
const TITRES_INITIAL_PAGE_SIZE = 15;
const TITRES_SCROLL_INCREMENT = 10;

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
  const [ownedMap, setOwnedMap] = useState<Map<string, boolean>>(new Map());
  const bannerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showAllPremium, setShowAllPremium] = useState(false);
  const [catalogSortBy, setCatalogSortBy] = useState('A-Z');
  const [mobileTab, setMobileTab] = useState<'titres' | 'albums'>('titres');
  const [titresDisplayCount, setTitresDisplayCount] = useState(TITRES_INITIAL_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());
  const scrollRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Auto-advance banners
  useEffect(() => {
    const count = bannerAlbums.length || 1;
    const interval = setInterval(() => {
      setCurrentBannerIndex((prev) => (prev + 1) % count);
    }, 5000);
    bannerIntervalRef.current = interval;
    return () => clearInterval(interval);
  }, [bannerAlbums.length]);

  const loadOwnershipStatus = useCallback(async (albums: PublicAlbumSummary[]) => {
    const paid = albums.filter((a) => !a.is_free && a.status === 'published');
    const map = new Map<string, boolean>();
    try {
      // 🎯 Un SEUL appel API au lieu de N appels individuels
      //    listOwnedAlbums() est déjà caché 60s dans isAlbumOwnedByDevice
      const ownedAlbums = await listOwnedAlbums();
      const ownedIds = new Set(ownedAlbums.map((a) => a.id));
      paid.forEach((a) => map.set(a.id, ownedIds.has(a.id)));
    } catch {
      // Si listOwnedAlbums échoue, tout est considéré non possédé
      // (aucun 403 en cascade)
      paid.forEach((a) => map.set(a.id, false));
    }
    setOwnedMap(map);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cacheResult = await staleWhileRevalidate(async () => {
        const albums = await listAlbums();
        const freeAlbums = albums.filter((a) => a.is_free === true);
        const detailsMap = new Map<string, PublicAlbumDetails>();
        await Promise.all(
          freeAlbums.map(async (album) => {
            try {
              const offline = await resolveOfflinePlayback(album.id);
              if (offline.metadata) { detailsMap.set(album.id, offline.metadata); return; }
              const details = unwrapAlbumDetails(await getAlbum(album.id));
              detailsMap.set(album.id, details);
            } catch { /* skip */ }
          }),
        );
        return { albums, albumDetails: detailsMap };
      });

      if (cacheResult.data) {
        const { albums } = cacheResult.data;
        const detailsMap = freeCatalogDetailsMap(cacheResult.data);
        albumCacheRef.current = detailsMap;

        const sorted = [...albums].sort((a, b) => {
          const da = a.created_at ? new Date(a.created_at).getTime() : 0;
          const db = b.created_at ? new Date(b.created_at).getTime() : 0;
          return db - da;
        });
        setNewAlbums(sorted);

        // Banner: prioritize paid albums, fallback to free
        const paidWithCover = albums.filter((a) => !a.is_free && a.cover_url && a.status === 'published');
        const freeWithCover = albums.filter((a) => a.is_free && a.cover_url && a.status === 'published');
        setBannerAlbums(
          paidWithCover.length >= 2 ? paidWithCover.slice(0, 3)
            : [...paidWithCover, ...freeWithCover].slice(0, 3),
        );

        const paid = albums.filter((a) => !a.is_free && a.status === 'published');
        setPaidAlbums(paid);

        // Load ownership for paid albums
        void loadOwnershipStatus(albums);

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
        setFreeTracks(tracks);
        setArtists(buildArtistsFromAlbums(albums));
        setLoading(false);
        return;
      }

      // No cache — network fetch
      const albums = await listAlbums();
      const freeAlbums = albums.filter((a) => a.is_free === true);
      const cache = new Map<string, PublicAlbumDetails>();
      await Promise.all(
        freeAlbums.map(async (album) => {
          try {
            const offline = await resolveOfflinePlayback(album.id);
            if (offline.metadata) { cache.set(album.id, offline.metadata); return; }
            const details = unwrapAlbumDetails(await getAlbum(album.id));
            cache.set(album.id, details);
          } catch { /* skip */ }
        }),
      );
      albumCacheRef.current = cache;

      const sorted = [...albums].sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
      setNewAlbums(sorted);

      const paidWithCover = albums.filter((a) => !a.is_free && a.cover_url && a.status === 'published');
      const freeWithCover = albums.filter((a) => a.is_free && a.cover_url && a.status === 'published');
      setBannerAlbums(
        paidWithCover.length >= 2 ? paidWithCover.slice(0, 3)
          : [...paidWithCover, ...freeWithCover].slice(0, 3),
      );

      const paid = albums.filter((a) => !a.is_free && a.status === 'published');
      setPaidAlbums(paid);

      // Load ownership
      void loadOwnershipStatus(albums);

      const tracks: TrackWithAlbum[] = [];
      for (const album of albums) {
        const details = cache.get(album.id);
        if (details) tracks.push(...mapTracksFromAlbum(album, details));
      }
      tracks.sort((a, b) => {
        const albumA = albums.find((al) => al.id === a.album_id);
        const albumB = albums.find((al) => al.id === b.album_id);
        const da = albumA?.created_at ? new Date(albumA.created_at).getTime() : 0;
        const db = albumB?.created_at ? new Date(albumB.created_at).getTime() : 0;
        return db - da;
      });
      setFreeTracks(tracks);

      await writeFreeCatalogCache(freeAlbums, cache);
      setArtists(buildArtistsFromAlbums(albums));
    } catch {
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
        setPaidAlbums(paid);
        // In cache fallback, all offline albums are owned
        const fallbackOwnedMap = new Map<string, boolean>();
        paid.forEach((a) => fallbackOwnedMap.set(a.id, true));
        setOwnedMap(fallbackOwnedMap);
        setArtists(buildArtistsFromAlbums(offlineAlbums));
        const bannerAlbums = offlineAlbums
          .filter((a) => a.cover_url && a.status === 'published')
          .slice(0, 3);
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
        setFreeTracks(tracks);
      } else {
        setError('Impossible de charger les nouveautés.');
      }
    } finally {
      setLoading(false);
    }
  }, [loadOwnershipStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // IntersectionObserver pour l'infinite scroll des titres mobile
  useEffect(() => {
    if (mobileTab !== 'titres') return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setTitresDisplayCount((prev) =>
            Math.min(prev + TITRES_SCROLL_INCREMENT, freeTracks.length),
          );
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [mobileTab, freeTracks.length, catalogSortBy]);

  // Reset display count when sort changes
  useEffect(() => {
    setTitresDisplayCount(TITRES_INITIAL_PAGE_SIZE);
  }, [catalogSortBy]);

  const scrollSection = (key: string, direction: 'left' | 'right') => {
    const ref = scrollRefs.current[key];
    if (!ref) return;
    const scrollAmount = 380;
    ref.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  function PaginationBar({ page, totalPages, onPrev, onNext }: {
    page: number;
    totalPages: number;
    onPrev: () => void;
    onNext: () => void;
  }) {
    if (totalPages <= 1) return null;
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        marginTop: 20,
        padding: '12px 0',
      }}>
        <button
          onClick={onPrev}
          disabled={page === 0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 18px',
            borderRadius: 'var(--radius-full)',
            background: page === 0 ? 'var(--color-surface)' : 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
            cursor: page === 0 ? 'default' : 'pointer',
            color: page === 0 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
            fontSize: 13,
            fontWeight: 600,
            transition: 'all var(--transition-fast) ease',
            opacity: page === 0 ? 0.4 : 1,
          }}
          onMouseEnter={(e) => {
            if (page > 0) { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }
          }}
          onMouseLeave={(e) => {
            if (page > 0) { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }
          }}
        >
          <ChevronLeft size={15} />
          Précédent
        </button>

        <span style={{ color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {page + 1} / {totalPages}
        </span>

        <button
          onClick={onNext}
          disabled={page >= totalPages - 1}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 18px',
            borderRadius: 'var(--radius-full)',
            background: page >= totalPages - 1 ? 'var(--color-surface)' : 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
            cursor: page >= totalPages - 1 ? 'default' : 'pointer',
            color: page >= totalPages - 1 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
            fontSize: 13,
            fontWeight: 600,
            transition: 'all var(--transition-fast) ease',
            opacity: page >= totalPages - 1 ? 0.4 : 1,
          }}
          onMouseEnter={(e) => {
            if (page < totalPages - 1) { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }
          }}
          onMouseLeave={(e) => {
            if (page < totalPages - 1) { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }
          }}
        >
          Suivant
          <ChevronRight size={15} />
        </button>
      </div>
    );
  }

  async function handleTrackPress(track: TrackWithAlbum) {
    try { await playFromTrackList(freeTracks, albumCacheRef.current, track.id); }
    catch { /* ignore */ }
  }

  const filteredAlbums = newAlbums
    .filter(album => {
      // Only show albums (no singles or EPs)
      const albumType = album.type || 'album';
      if (albumType !== 'album') return false;

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

  // Pagination — albums
  const [albumPage, setAlbumPage] = useState(0);
  const ALBUMS_PER_PAGE = 8;
  const totalAlbumPages = Math.max(1, Math.ceil(filteredAlbums.length / ALBUMS_PER_PAGE));

  // Reset album page when filters change
  useEffect(() => { setAlbumPage(0); }, [filters]);

  // Premium albums sorted by newest first
  const sortedPaidAlbums = [...paidAlbums].sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0;
    const db = b.created_at ? new Date(b.created_at).getTime() : 0;
    return db - da;
  });

  return (
    <Screen gradient padded>
      {/* ========== HEADER ========== */}
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
            <p className="desktop-only" style={{
              color: 'var(--color-text-secondary)',
              fontSize: 14,
              margin: '2px 0 0',
              lineHeight: 1.4,
            }}>
              Nouveautés, collections et tendances
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn-ghost desktop-only"
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

      {/* ========== CONTENT ========== */}
      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 48, maxWidth: 1200, margin: '0 auto', width: '100%' }} className="discover-content">

          {!isMobile && (
            <>

          {/* ──────── 1. HERO — Premium Shop Window ──────── */}
          {bannerAlbums.length > 0 && (
            <div>
              <div style={{
                position: 'relative',
                width: '100%',
                height: 280,
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}>
                {bannerAlbums.slice(0, 3).map((album, index) => {
                  const artistName = album.artist_name || album.artist?.name || 'Artiste';
                  const albumType = album.type === 'single' ? 'Single' : album.type === 'ep' ? 'EP' : 'Album';
                  const isPremium = !album.is_free;
                  const price = album.price_ariary > 0
                    ? `${album.price_ariary.toLocaleString()} Ar`
                    : null;

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
                          background: isPremium
                            ? 'linear-gradient(135deg, rgba(180,120,20,0.75) 0%, rgba(139,0,0,0.85) 50%, rgba(60,10,30,0.85) 100%)'
                            : 'linear-gradient(135deg, rgba(220,20,60,0.85), rgba(100,10,40,0.85))',
                        }} />
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'linear-gradient(90deg, rgba(0,0,0,0.7) 0%, transparent 50%, rgba(0,0,0,0.4) 100%)',
                        }} />
                      </div>

                      {/* Decorative gold sparkles for premium */}
                      {isPremium && (
                        <div style={{
                          position: 'absolute',
                          top: 40,
                          right: 60,
                          zIndex: 5,
                          opacity: 0.15,
                          fontSize: 120,
                          color: '#FFD700',
                          fontWeight: 100,
                          lineHeight: 1,
                          fontFamily: 'serif',
                          pointerEvents: 'none',
                        }}>
                          ✦
                        </div>
                      )}

                      {/* Banner Content */}
                      <div
                        style={{
                          position: 'relative',
                          zIndex: 10,
                          padding: '40px 60px',
                          maxWidth: 650,
                          cursor: 'pointer',
                        }}
                        onClick={() => navigate(`/album/${album.id}`)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          {isPremium && (
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 10px',
                              borderRadius: 'var(--radius-full)',
                              background: 'rgba(255,215,0,0.15)',
                              border: '1px solid rgba(255,215,0,0.2)',
                            }}>
                              <Crown size={12} color="#FFD700" />
                              <span style={{ color: '#FFD700', fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                                Premium
                              </span>
                            </div>
                          )}
                          <p style={{
                            color: 'rgba(255,255,255,0.7)',
                            fontSize: 13,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '1.2px',
                            margin: 0,
                          }}>
                            {isPremium ? 'Collection' : 'Gratuit'} · {albumType}
                          </p>
                        </div>

                        <h2 style={{
                          color: '#fff',
                          fontSize: 48,
                          fontWeight: 800,
                          lineHeight: '52px',
                          margin: '0 0 6px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {album.title}
                        </h2>
                        <p style={{
                          color: 'rgba(255,255,255,0.9)',
                          fontSize: 18,
                          margin: '0 0 20px',
                        }}>
                          {artistName}
                        </p>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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

                          {isPremium && price && (
                            <a
                              href={getPurchaseAlbumUrl(album.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '12px 24px',
                                borderRadius: 'var(--radius-full)',
                                background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                cursor: 'pointer',
                                color: '#fff',
                                fontSize: 14,
                                fontWeight: 700,
                                textDecoration: 'none',
                                backdropFilter: 'blur(8px)',
                                transition: 'all var(--transition-fast) ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255,215,0,0.15)';
                                e.currentTarget.style.borderColor = '#FFD700';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                              }}
                            >
                              <ShoppingBag size={16} />
                              Acheter — {price}
                            </a>
                          )}
                        </div>
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

          {/* ──────── 2. COLLECTIONS PAYANTES ──────── */}
          {sortedPaidAlbums.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-full)',
                    background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: '0 0 12px rgba(255,215,0,0.25)',
                  }}>
                    <Store size={16} color="#000" />
                  </div>
                  <div>
                    <h2 className="section-title" style={{ margin: 0 }}>Collections Payantes</h2>
                    <p style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 13,
                      margin: '2px 0 0',
                      fontWeight: 500,
                    }}>
                      {showAllPremium ? sortedPaidAlbums.length : Math.min(4, sortedPaidAlbums.length)} album{sortedPaidAlbums.length > 1 ? 's' : ''} premium
                    </p>
                  </div>
                </div>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 20,
              }} className="collections-grid">
                {(showAllPremium ? sortedPaidAlbums : sortedPaidAlbums.slice(0, 4)).map((album) => (
                  <PremiumAlbumCard
                    key={album.id}
                    album={album}
                    isOwned={ownedMap.get(album.id) ?? false}
                    onPress={() => navigate(`/album/${album.id}`)}
                  />
                ))}
              </div>
              {/* Voir plus / Voir moins */}
              {sortedPaidAlbums.length > 4 && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
                  <button
                    onClick={() => setShowAllPremium(!showAllPremium)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 24px',
                      borderRadius: 'var(--radius-full)',
                      background: showAllPremium ? 'var(--color-surface-elevated)' : 'linear-gradient(135deg, #FFD700, #FFA500)',
                      border: showAllPremium ? '1px solid var(--color-border-subtle)' : 'none',
                      cursor: 'pointer',
                      color: showAllPremium ? 'var(--color-text-secondary)' : '#000',
                      fontSize: 13,
                      fontWeight: 700,
                      transition: 'all var(--transition-fast) ease',
                    }}
                    onMouseEnter={(e) => {
                      if (showAllPremium) {
                        e.currentTarget.style.background = 'var(--color-surface-hover)';
                        e.currentTarget.style.color = 'var(--color-text-primary)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (showAllPremium) {
                        e.currentTarget.style.background = 'var(--color-surface-elevated)';
                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                      }
                    }}
                  >
                    {showAllPremium ? (
                      <>Réduire <ChevronLeft size={16} style={{ transform: 'rotate(-90deg)' }} /></>
                    ) : (
                      <>Voir les {sortedPaidAlbums.length} albums <ChevronRight size={16} style={{ transform: 'rotate(90deg)' }} /></>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ──────── 3. ARTISTES — Top tendances + à découvrir ──────── */}
          {artists.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Users size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Artistes</h2>
                </div>
                <span className="section-link" onClick={() => navigate('/artists')} style={{ cursor: 'pointer' }}>
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
                  {artists.slice(0, 10).map((artist) => (
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

          {/* ──────── 4. TITRES GRATUITS — Aperçu rapide avec lien vers le catalogue ──────── */}
          {freeTracks.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Music size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Titres Gratuits</h2>
                </div>
                <span
                  className="section-link"
                  onClick={() => navigate('/tracks')}
                  style={{ cursor: 'pointer' }}
                >
                  Voir tout →
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '4px 24px',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
              }} className="tracks-grid-2col">
                {freeTracks.slice(0, 20).map((track, index) => (
                  <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 24,
                      color: currentTrack?.id === track.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      fontSize: 12,
                      fontWeight: 600,
                      textAlign: 'center',
                      flexShrink: 0,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {index + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <TrackListItem
                        track={track}
                        isPlaying={currentTrack?.id === track.id && isPlaying}
                        onPress={() => void handleTrackPress(track)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ──────── 5. TOUS LES ALBUMS — Paginé ──────── */}
          {filteredAlbums.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Disc size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Tous les albums</h2>
                </div>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600 }}>
                  {filteredAlbums.length} albums · Page {albumPage + 1}/{totalAlbumPages}
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
                gap: 16,
              }} className="albums-grid">
                {filteredAlbums
                  .slice(albumPage * ALBUMS_PER_PAGE, (albumPage + 1) * ALBUMS_PER_PAGE)
                  .map((album) => (
                    <AlbumCard
                      key={album.id}
                      album={album}
                      variant="tile"
                      onPress={() => navigate(`/album/${album.id}`)}
                    />
                  ))}
              </div>
              {/* Pagination */}
              {totalAlbumPages > 1 && (
                <PaginationBar
                  page={albumPage}
                  totalPages={totalAlbumPages}
                  onPrev={() => setAlbumPage((p) => Math.max(0, p - 1))}
                  onNext={() => setAlbumPage((p) => Math.min(totalAlbumPages - 1, p + 1))}
                />
              )}
            </div>
          )}

          {/* Bottom spacing */}
          <div style={{ height: 16 }} />
          </>
          )}

          {isMobile && (
            <>

            {/* ──────── M1. ARTISTES ──────── */}
            {artists.length > 0 && (
              <div>
                <div className="section-header">
                  <h2 className="section-title">Artistes</h2>
                  <span className="section-link" onClick={() => navigate('/artists')} style={{ cursor: 'pointer' }}>
                    Voir tout
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  gap: 8,
                  overflowX: 'auto',
                  paddingBottom: 4,
                  scrollbarWidth: 'none',
                }}>
                  {artists.slice(0, 8).map((artist) => (
                    <button
                      key={artist.id}
                      onClick={() => navigate(`/artist/${artist.id}`)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 6px',
                        borderRadius: 'var(--radius-md)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        minWidth: 90,
                        flexShrink: 0,
                      }}
                    >
                      <div style={{
                        width: 56,
                        height: 56,
                        borderRadius: 'var(--radius-full)',
                        overflow: 'hidden',
                        backgroundColor: 'var(--color-surface-elevated)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: 'var(--shadow-sm)',
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
                          <User size={22} color="var(--color-text-muted)" />
                        )}
                      </div>
                      <span style={{
                        color: 'var(--color-text-primary)',
                        fontSize: 11,
                        fontWeight: 600,
                        lineHeight: '14px',
                        textAlign: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 80,
                      }}>
                        {artist.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ──────── M2. TABS: Titres / Albums ──────── */}
            {(freeTracks.length > 0 || filteredAlbums.length > 0) && (
              <div style={{ marginTop: 4 }}>
                {/* Tab selector + sort button */}
                <div style={{
                  display: 'flex',
                  gap: 6,
                  marginBottom: 12,
                  alignItems: 'center',
                }}>
                  <div style={{
                    display: 'flex',
                    gap: 0,
                    flex: 1,
                    background: 'var(--color-surface-elevated)',
                    borderRadius: 'var(--radius-full)',
                    padding: 3,
                    alignSelf: 'flex-start',
                  }}>
                    <button
                      onClick={() => setMobileTab('titres')}
                      style={{
                        flex: 1,
                        padding: '8px 20px',
                        borderRadius: 'var(--radius-full)',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        background: mobileTab === 'titres' ? 'var(--color-bg-dark)' : 'transparent',
                        color: mobileTab === 'titres' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                        transition: 'all var(--transition-fast) ease',
                      }}
                    >
                      Titres
                    </button>
                    <button
                      onClick={() => setMobileTab('albums')}
                      style={{
                        flex: 1,
                        padding: '8px 20px',
                        borderRadius: 'var(--radius-full)',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        background: mobileTab === 'albums' ? 'var(--color-bg-dark)' : 'transparent',
                        color: mobileTab === 'albums' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                        transition: 'all var(--transition-fast) ease',
                      }}
                    >
                      Albums
                    </button>
                  </div>

                  {/* Sort toggle button */}
                  <button
                    onClick={() => {
                      const options = ['A-Z', 'Z-A', 'Plus récent', 'Plus ancien'];
                      const idx = options.indexOf(catalogSortBy);
                      setCatalogSortBy(options[(idx + 1) % options.length]);
                    }}
                    title={`Tri : ${catalogSortBy}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-full)',
                      border: '1px solid var(--color-border-subtle)',
                      background: 'var(--color-surface-elevated)',
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      transition: 'all var(--transition-fast) ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                  >
                    <ArrowUpDown size={14} />
                    <span>{catalogSortBy}</span>
                  </button>
                </div>

                {/* Titres tab content */}
                {mobileTab === 'titres' && freeTracks.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {(() => {
                        let sorted = [...freeTracks];
                        if (catalogSortBy === 'Plus récent') {
                          // Already sorted by newest first
                        } else if (catalogSortBy === 'Plus ancien') {
                          sorted.reverse();
                        } else if (catalogSortBy === 'A-Z') {
                          sorted.sort((a, b) => a.title.localeCompare(b.title));
                        } else if (catalogSortBy === 'Z-A') {
                          sorted.sort((a, b) => b.title.localeCompare(a.title));
                        }
                        const visibleTracks = sorted.slice(0, titresDisplayCount);
                        return (
                          <>
                            {visibleTracks.map((track, index) => (
                              <div key={track.id} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '6px 0',
                                borderBottom: index < visibleTracks.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                              }}>
                                <span style={{
                                  width: 20,
                                  color: currentTrack?.id === track.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  textAlign: 'center',
                                  flexShrink: 0,
                                  fontVariantNumeric: 'tabular-nums',
                                }}>
                                  {index + 1}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <TrackListItem
                                    track={track}
                                    isPlaying={currentTrack?.id === track.id && isPlaying}
                                    onPress={() => void handleTrackPress(track)}
                                  />
                                </div>
                              </div>
                            ))}
                            {/* Sentinel + loading indicator for infinite scroll */}
                            {titresDisplayCount < sorted.length && (
                              <div ref={sentinelRef} style={{
                                display: 'flex',
                                justifyContent: 'center',
                                padding: '12px 0',
                              }}>
                                <div style={{
                                  width: 20,
                                  height: 20,
                                  border: '2px solid var(--color-border-subtle)',
                                  borderTopColor: 'var(--color-accent)',
                                  borderRadius: '50%',
                                  animation: 'spin 0.8s linear infinite',
                                }} />
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Albums tab content */}
                {mobileTab === 'albums' && filteredAlbums.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {(() => {
                      const sorted = [...filteredAlbums];
                      if (catalogSortBy === 'A-Z') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                      else if (catalogSortBy === 'Z-A') sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
                      else if (catalogSortBy === 'Plus récent') sorted.sort((a, b) => {
                        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
                        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
                        return db - da;
                      });
                      else if (catalogSortBy === 'Plus ancien') sorted.sort((a, b) => {
                        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
                        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
                        return da - db;
                      });
                      return sorted.map((album) => (
                      <button
                        key={album.id}
                        onClick={() => navigate(`/album/${album.id}`)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 0',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          borderBottom: '1px solid var(--color-border-subtle)',
                          textAlign: 'left',
                          width: '100%',
                        }}
                      >
                        {/* Cover */}
                        <div style={{
                          width: 44,
                          height: 44,
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          flexShrink: 0,
                          backgroundColor: 'var(--color-surface-elevated)',
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
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--color-text-muted)',
                              fontSize: 18,
                            }}>
                              ♪
                            </div>
                          )}
                        </div>
                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{
                            color: 'var(--color-text-primary)',
                            fontSize: 13,
                            fontWeight: 600,
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {album.title}
                          </span>
                          <span style={{
                            color: 'var(--color-text-muted)',
                            fontSize: 12,
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginTop: 1,
                          }}>
                            {album.artist_name || album.artist?.name || 'Artiste inconnu'}
                          </span>
                        </div>
                        {/* Free / Premium badge */}
                        {!album.is_free && (
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#FFD700',
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-full)',
                            background: 'rgba(255,215,0,0.1)',
                            border: '1px solid rgba(255,215,0,0.2)',
                            flexShrink: 0,
                          }}>
                            Premium
                          </span>
                        )}
                      </button>                      ));
                    })()}
                  </div>
                )}
              </div>
            )}

            <div style={{ height: 16 }} />
          </>
          )}
        </div>
      )}
    </Screen>
  );
}
