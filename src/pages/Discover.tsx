import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, ChevronLeft, ChevronRight,
  ShoppingBag, Filter, Music, Disc, Play, Clock,
  Crown, Star, Store, User, ArrowUpDown, Headphones, Download, Flame,
} from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { PremiumAlbumCard } from '@/components/PremiumAlbumCard';
import { AlbumRow } from '@/components/AlbumRow';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { formatTitle } from '@/utils/formatTitle';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, listOwnedAlbums, unwrapAlbumDetails } from '@/services/api';
import { isAlbumReadyOffline, listVaultAlbums } from '@/services/downloadManager';
import { freeCatalogDetailsMap, readFreeCatalogCache, writeFreeCatalogCache, staleWhileRevalidate } from '@/services/freeCatalogCache';
import { buildArtistsFromAlbums, mapTracksFromAlbum } from '@/services/freeCatalogSearch';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { useMediaQuery } from '@/hooks/useMediaQuery';

import { getTopArtists, readListeningHistory } from '@/services/listeningHistory';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';
import { getRecommendations, getAlbumContextRecommendations, type ScoredArtist, type AlbumContextRecommendation } from '@/services/graphRecommendations';

// ── Helpers pour la section Perso (hors composant pour éviter de recréer les closures) ──
function getListeningLevel(totalPlays: number) {
  if (totalPlays < 3) return { label: 'Débutant', color: 'var(--color-text-muted)', threshold: 3 };
  if (totalPlays < 10) return { label: 'Régulier', color: 'var(--color-accent)', threshold: 10 };
  if (totalPlays < 30) return { label: 'Fidèle', color: '#FFD700', threshold: 30 };
  return { label: 'Expert', color: 'var(--color-accent)', threshold: Infinity };
}

function getRelativeTime(isoString: string) {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `il y a ${diffD}j`;
  return `il y a ${Math.floor(diffD / 7)} sem`;
}


import { useAudioPlayback } from '@/contexts/AudioContext';
import { ArtistRecommendations } from '@/components/ArtistRecommendations';
import { useLayout } from '@/contexts/LayoutContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { getPurchaseAlbumUrl } from '@/config/urls';
import { isPreorder, formatPublicationDate } from '@/utils/preorder';
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
// ⚡ Éviter le N+1 : ne charger les détails complets que pour les N premiers albums gratuits
// Les autres albums chargeront leurs détails au clic (page AlbumDetail)
const MAX_FREE_DETAILS_LOAD = 15;

export function DiscoverScreen() {
  const navigate = useNavigate();
  const { playFromTrackList, currentTrack, isPlaying, isFullPlayerVisible } = useAudioPlayback();
  const { effectiveMode } = useLibraryMode();
  const isOfflineMode = effectiveMode === 'offline';

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
  const [mobileTab, setMobileTab] = useState<'titres' | 'albums' | 'perso'>('perso');
  const [persoTopArtists, setPersoTopArtists] = useState<{ artistId: string; artistName: string; playCount: number }[]>([]);
  const [persoFullHistory, setPersoFullHistory] = useState<Record<string, { artistId: string; artistName: string; playCount: number; lastPlayedAt: string }>>({});
  const [titresDisplayCount, setTitresDisplayCount] = useState(TITRES_INITIAL_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { isSidebarCollapsed } = useLayout();
  // Layout adaptatif : si sidebar ouverte + player visible → affichage réduit
  const isNarrowLayout = !isSidebarCollapsed && isFullPlayerVisible;
  const ALBUM_DISPLAY_COUNT = isNarrowLayout ? 8 : 10;
  const ALBUM_GRID_COLUMNS = isNarrowLayout ? 4 : 5;
  const PREMIUM_DISPLAY_COUNT = isNarrowLayout ? 3 : 4;
  const TRACK_DISPLAY_COUNT = isNarrowLayout ? 16 : 20;
  const TRACK_GRID_COLUMNS = isNarrowLayout ? 1 : 2;

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
    const paid = albums.filter((a) => !a.is_free && ['published', 'scheduled'].includes(a.status));
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
      const MAX_DETAILS = MAX_FREE_DETAILS_LOAD;
      const cacheResult = await staleWhileRevalidate(async () => {
        const albums = await listAlbums();
        const freeAlbums = albums.filter((a) => a.is_free === true);
        const detailsMap = new Map<string, PublicAlbumDetails>();
        // 🎯 Éviter le N+1 : ne charger les détails que des N premiers albums gratuits
        await Promise.all(
          freeAlbums.slice(0, MAX_DETAILS).map(async (album) => {
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
        const paidWithCover = albums.filter((a) => !a.is_free && a.cover_url && ['published', 'scheduled'].includes(a.status));
        const freeWithCover = albums.filter((a) => a.is_free && a.cover_url && ['published', 'scheduled'].includes(a.status));
        setBannerAlbums(
          paidWithCover.length >= 2 ? paidWithCover.slice(0, 3)
            : [...paidWithCover, ...freeWithCover].slice(0, 3),
        );

        const paid = albums.filter((a) => !a.is_free && ['published', 'scheduled'].includes(a.status));
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
      // 🎯 Éviter le N+1 : ne charger les détails que des N premiers albums gratuits
      await Promise.all(
        freeAlbums.slice(0, MAX_DETAILS).map(async (album) => {
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

      const paidWithCover = albums.filter((a) => !a.is_free && a.cover_url && ['published', 'scheduled'].includes(a.status));
      const freeWithCover = albums.filter((a) => a.is_free && a.cover_url && ['published', 'scheduled'].includes(a.status));
      setBannerAlbums(
        paidWithCover.length >= 2 ? paidWithCover.slice(0, 3)
          : [...paidWithCover, ...freeWithCover].slice(0, 3),
      );

      const paid = albums.filter((a) => !a.is_free && ['published', 'scheduled'].includes(a.status));
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
        const paid = offlineAlbums.filter((a) => !a.is_free && ['published', 'scheduled'].includes(a.status));
        setPaidAlbums(paid);
        // In cache fallback, all offline albums are owned
        const fallbackOwnedMap = new Map<string, boolean>();
        paid.forEach((a) => fallbackOwnedMap.set(a.id, true));
        setOwnedMap(fallbackOwnedMap);
        setArtists(buildArtistsFromAlbums(offlineAlbums));
        const bannerAlbums = offlineAlbums
          .filter((a) => a.cover_url && ['published', 'scheduled'].includes(a.status))
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

  // ⚡ Mode offline : charger UNIQUEMENT les albums du vault local
  const loadOfflineData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vaultAlbums = await listVaultAlbums();
      if (vaultAlbums.length === 0) {
        setLoading(false);
        return;
      }

      const sorted = [...vaultAlbums].sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
      setNewAlbums(sorted);

      const paidWithCover = vaultAlbums.filter((a) => !a.is_free && a.cover_url);
      const freeWithCover = vaultAlbums.filter((a) => a.is_free && a.cover_url);
      setBannerAlbums(
        paidWithCover.length >= 2 ? paidWithCover.slice(0, 3)
          : [...paidWithCover, ...freeWithCover].slice(0, 3),
      );

      const paid = vaultAlbums.filter((a) => !a.is_free && ['published', 'scheduled'].includes(a.status));
      setPaidAlbums(paid);

      // En offline, tous les albums du vault sont considérés possédés
      const ownedMap = new Map<string, boolean>();
      paid.forEach((a) => ownedMap.set(a.id, true));
      setOwnedMap(ownedMap);

      setArtists([]); // Pas de chargement artistes en offline
      setFreeTracks([]); // Pas de titres gratuits streamables
    } catch {
      setError('Aucun album disponible hors-ligne.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOfflineMode) {
      void loadOfflineData();
    } else {
      void loadData();
    }
  }, [isOfflineMode, loadData, loadOfflineData]);

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

  // Load Perso data from listening history
  useEffect(() => {
    const topArtists = getTopArtists(10);
    const history = readListeningHistory();
    setPersoTopArtists(topArtists.map(a => ({ artistId: a.artistId, artistName: a.artistName, playCount: a.playCount })));
    setPersoFullHistory(history);
  }, []);

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

  // Premium albums sorted by newest first
  const sortedPaidAlbums = [...paidAlbums].sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0;
    const db = b.created_at ? new Date(b.created_at).getTime() : 0;
    return db - da;
  });

  // Albums recommandés basés sur les artistes les plus écoutés
  const recommendedAlbums = useMemo(() => {
    if (persoTopArtists.length === 0) return [];
    const topNames = new Set(persoTopArtists.map(a => normalizeArtistName(a.artistName)));
    return newAlbums.filter(album => {
      const name = normalizeArtistName(album.artist_name || album.artist?.name || '');
      return topNames.has(name);
    });
  }, [persoTopArtists, newAlbums]);

  // Artistes recommandés par rebond de collaborations (scoring + cache)
  // Utilise le nouveau service graphRecommendations avec graphe pondéré
  const scoredArtists = useMemo(() => {
    if (persoTopArtists.length === 0 || freeTracks.length === 0) return [];
    return getRecommendations(
      freeTracks,
      persoTopArtists.map(a => ({ artistName: a.artistName, playCount: a.playCount })),
      persoFullHistory,
      20,
    );
  }, [persoTopArtists, freeTracks, persoFullHistory]);

  // Albums des artistes recommandés par collaborations
  const recommendedFeatAlbums = useMemo(() => {
    if (scoredArtists.length === 0) return [];
    const artistSet = new Set(scoredArtists.map(a => a.artistName));
    return newAlbums.filter(album => {
      const name = normalizeArtistName(album.artist_name || album.artist?.name || '');
      return artistSet.has(name);
    });
  }, [scoredArtists, newAlbums]);

  // Tracks des artistes recommandés par collaborations
  const recommendedFeatTracks = useMemo(() => {
    if (scoredArtists.length === 0) return [];
    const artistSet = new Set(scoredArtists.map(a => a.artistName));
    return freeTracks.filter(track => {
      const name = normalizeArtistName(track.artist_name);
      return artistSet.has(name);
    });
  }, [scoredArtists, freeTracks]);

  // Albums recommandés par contexte d'album (Track → Album → Autres tracks)
  // Si l'utilisateur écoute un artiste, on lui recommande les autres morceaux
  // des albums où cet artiste apparaît (en excluant les artistes déjà écoutés).
  const albumContextAlbums = useMemo(() => {
    if (persoTopArtists.length === 0 || freeTracks.length === 0) return [];
    const results = getAlbumContextRecommendations(
      freeTracks,
      persoTopArtists.map(a => ({ artistName: a.artistName, playCount: a.playCount })),
      persoFullHistory,
      6,
    );
    // Exclure les albums déjà présents dans les Nouveautés (éviter les doublons)
    const nouveauteIds = new Set(recommendedAlbums.map(a => a.id));
    return results.filter(r => !nouveauteIds.has(r.albumId));
  }, [persoTopArtists, freeTracks, persoFullHistory, recommendedAlbums]);

  // Artistes récents (triés par lastPlayedAt) et total des écoutes
  const persoDerived = useMemo(() => {
    const entries = Object.values(persoFullHistory);
    const totalPlays = entries.reduce((sum, e) => sum + e.playCount, 0);
    return { totalPlays };
  }, [persoFullHistory]);

  // Albums des artistes les plus écoutés, triés par nombre d'écoutes (pour la section "Vos albums fétiches")
  const persoAlbumsByPlays = useMemo(() => {
    if (persoTopArtists.length === 0) return [];
    const playCountMap = new Map(persoTopArtists.map(a => [normalizeArtistName(a.artistName), a.playCount]));
    return [...recommendedAlbums].sort((a, b) => {
      const aPlays = playCountMap.get(normalizeArtistName(a.artist_name || a.artist?.name || '')) || 0;
      const bPlays = playCountMap.get(normalizeArtistName(b.artist_name || b.artist?.name || '')) || 0;
      return bPlays - aPlays;
    });
  }, [recommendedAlbums, persoTopArtists]);

  // Albums "tendances" — découverts via collaborations, avec leur score
  const trendingAlbums = useMemo(() => {
    if (scoredArtists.length === 0 || newAlbums.length === 0) return [];
    const scoredMap = new Map(scoredArtists.map(a => [normalizeArtistName(a.artistName), a.score]));
    return newAlbums.filter(album => {
      const name = normalizeArtistName(album.artist_name || album.artist?.name || '');
      return scoredMap.has(name);
    }).slice(0, 8);
  }, [scoredArtists, newAlbums]);

  // Map artist ID → profile_picture_url (pour les photos des artistes dans Perso)
  const artistPhotoMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of artists) {
      const url = a.profile_picture_url || a.fallback_image_url;
      if (url) map.set(a.id, url);
    }
    return map;
  }, [artists]);

  // Titres récents — basés sur les artistes récemment écoutés
  const recentTracks = useMemo(() => {
    // Trier l'historique par lastPlayedAt (plus récent d'abord)
    const sorted = Object.values(persoFullHistory)
      .sort((a, b) => new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime())
      .slice(0, 3); // 3 artistes les plus récents
    
    // Trouver leurs titres dans freeTracks (via normalizeArtistName pour gérer accents/casse)
    const recentArtistNames = new Set(sorted.map(e => normalizeArtistName(e.artistName)));
    const matchedTracks = freeTracks.filter(track =>
      recentArtistNames.has(normalizeArtistName(track.artist_name))
    );
    
    // Retourner max 5 titres, dans l'ordre des artistes les plus récents (max 2 par artiste)
    const result: typeof freeTracks = [];
    for (const entry of sorted) {
      const name = normalizeArtistName(entry.artistName);
      const artistTracks = matchedTracks.filter(t => normalizeArtistName(t.artist_name) === name);
      result.push(...artistTracks.slice(0, 2));
      if (result.length >= 5) break;
    }
    return result.slice(0, 5);
  }, [persoFullHistory, freeTracks]);

  // Calcul des jours d'écoute récents pour la streak
  const listeningStreak = useMemo(() => {
    const days = new Set<string>();
    for (const entry of Object.values(persoFullHistory)) {
      const d = new Date(entry.lastPlayedAt);
      days.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    }
    const today = new Date();
    const week: { date: string; active: boolean; label: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
      week.push({
        date: key,
        active: days.has(key),
        label: dayLabels[d.getDay()],
      });
    }
    return week;
  }, [persoFullHistory]);

  // Suggestions aléatoires — albums que l'utilisateur n'a pas encore vus
  const randomSuggestions = useMemo(() => {
    if (newAlbums.length === 0) return [];
    // Exclure les albums déjà recommandés dans les sections personnalisées
    const seenIds = new Set([
      ...recommendedAlbums.map(a => a.id),
      ...recommendedFeatAlbums.map(a => a.id),
      ...trendingAlbums.map(a => a.id),
    ]);
    const unseen = newAlbums.filter(a => !seenIds.has(a.id));
    // Mélanger et prendre les 6 premiers
    const shuffled = [...unseen].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
  }, [newAlbums, recommendedAlbums, recommendedFeatAlbums, trendingAlbums]);

  // ── Tab transition: détection de la direction du slide ──
  const [tabTransitionKey, setTabTransitionKey] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'right' | 'left'>('right');
  const prevTabRef = useRef<'titres' | 'albums' | 'perso'>('titres');
  const [tabLoading, setTabLoading] = useState(false);
  const tabLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [skeletonExiting, setSkeletonExiting] = useState(false);
  const prevTabLoadingRef = useRef(tabLoading);

  useEffect(() => {
    const current = mobileTab;
    const prev = prevTabRef.current;
    if (current !== prev) {
      // Direction du slide
      const tabOrder = ['titres', 'albums', 'perso'];
      const currentIdx = tabOrder.indexOf(current);
      const prevIdx = tabOrder.indexOf(prev);
      setSlideDirection(currentIdx > prevIdx ? 'right' : 'left');
      setTabTransitionKey(prev => prev + 1);
      prevTabRef.current = current;

      // ⏳ Feedback visuel bref lors du changement d'onglet (Titres & Albums)
      if (current === 'titres' || current === 'albums') {
        setTabLoading(true);
        setSkeletonExiting(false);
        if (tabLoadingTimerRef.current) clearTimeout(tabLoadingTimerRef.current);
        tabLoadingTimerRef.current = setTimeout(() => setTabLoading(false), 300);
      }
    }
    return () => {
      if (tabLoadingTimerRef.current) clearTimeout(tabLoadingTimerRef.current);
    };
  }, [mobileTab]);

  // Détecter la fin du skeleton (tabLoading: true → false) → déclencher fondu de sortie
  useEffect(() => {
    const was = prevTabLoadingRef.current;
    prevTabLoadingRef.current = tabLoading;
    if (was && !tabLoading) {
      setSkeletonExiting(true);
      const t = setTimeout(() => setSkeletonExiting(false), 200);
      return () => clearTimeout(t);
    }
  }, [tabLoading]);
  return (
    <Screen gradient padded>
      {/* ========== HEADER ========== */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-full)',
            background: isOfflineMode
              ? 'linear-gradient(135deg, #555, #333)'
              : 'var(--color-accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: isOfflineMode ? 'none' : '0 0 16px rgba(220,20,60,0.25)',
          }}>
            <img
              src="https://i.ibb.co/LDJ2Vcrr/Logo-2.png"
              alt="Pass'io"
              style={{
                width: 22,
                height: 22,
                objectFit: 'contain',
                filter: 'brightness(0) invert(1)',
              }}
            />
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
              {isOfflineMode ? 'Bibliothèque' : 'Découverte'}
            </h1>
            <p className="desktop-only" style={{
              color: 'var(--color-text-secondary)',
              fontSize: 14,
              margin: '2px 0 0',
              lineHeight: 1.4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {isOfflineMode ? (
                <>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(220,20,60,0.08)',
                    border: '1px solid rgba(220,20,60,0.12)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--color-accent)',
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    Hors-ligne
                  </span>
                  Vos albums téléchargés
                </>
              ) : (
                'Nouveautés, collections et tendances'
              )}
            </p>
          </div>
        </div>
        {!isOfflineMode && (
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
        )}
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
                          {formatTitle(album.title)}
                        </h2>
                        <p style={{
                          color: 'rgba(255,255,255,0.9)',
                          fontSize: 18,
                          margin: '0 0 20px',
                        }}>
                          {artistName}
                        </p>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {(() => {
                            const preordered = isPreorder(album.publication_date);
                            if (!isPremium && preordered) {
                              return (
                                <div
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '14px 32px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    color: 'rgba(255,255,255,0.45)',
                                    fontSize: 14,
                                    fontWeight: 700,
                                    cursor: 'default',
                                    backdropFilter: 'blur(8px)',
                                  }}
                                >
                                  <Clock size={18} />
                                  Disponible le {formatPublicationDate(album.publication_date!)}
                                </div>
                              );
                            }
                            return (
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
                            );
                          })()}

                          {isPremium && price && (() => {
                            const preordered = isPreorder(album.publication_date);
                            return (
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
                                  background: preordered
                                    ? 'rgba(220,20,60,0.2)'
                                    : 'rgba(255,255,255,0.08)',
                                  border: preordered
                                    ? '1px solid rgba(220,20,60,0.3)'
                                    : '1px solid rgba(255,255,255,0.15)',
                                  cursor: 'pointer',
                                  color: '#fff',
                                  fontSize: 14,
                                  fontWeight: 700,
                                  textDecoration: 'none',
                                  backdropFilter: 'blur(8px)',
                                  transition: 'all var(--transition-fast) ease',
                                }}
                                onMouseEnter={(e) => {
                                  if (preordered) {
                                    e.currentTarget.style.background = 'rgba(220,20,60,0.3)';
                                  } else {
                                    e.currentTarget.style.background = 'rgba(255,215,0,0.15)';
                                    e.currentTarget.style.borderColor = '#FFD700';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (preordered) {
                                    e.currentTarget.style.background = 'rgba(220,20,60,0.2)';
                                  } else {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                                  }
                                }}
                              >
                                {preordered ? <Clock size={16} /> : <ShoppingBag size={16} />}
                                {preordered ? `Précommander — ${price}` : `Acheter — ${price}`}
                              </a>
                            );
                          })()}
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
                      {showAllPremium ? sortedPaidAlbums.length : Math.min(PREMIUM_DISPLAY_COUNT, sortedPaidAlbums.length)} album{sortedPaidAlbums.length > 1 ? 's' : ''} premium
                    </p>
                  </div>
                </div>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${PREMIUM_DISPLAY_COUNT}, 1fr)`,
                gap: 20,
              }} className="collections-grid">
                {(showAllPremium ? sortedPaidAlbums : sortedPaidAlbums.slice(0, PREMIUM_DISPLAY_COUNT)).map((album) => (
                  <PremiumAlbumCard
                    key={album.id}
                    album={album}
                    isOwned={ownedMap.get(album.id) ?? false}
                    onPress={() => navigate(`/album/${album.id}`)}
                  />
                ))}
              </div>
              {/* Voir plus / Voir moins */}
              {sortedPaidAlbums.length > PREMIUM_DISPLAY_COUNT && (
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

          {/* ──────── 3. ARTISTES — Recommandations + catalogue (fusionné) ──────── */}
          <ArtistRecommendations
            sectionTitle="Artistes"
            maxArtists={16}
            discoveryCount={4}
          />

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
                gridTemplateColumns: `repeat(${TRACK_GRID_COLUMNS}, 1fr)`,
                gap: TRACK_GRID_COLUMNS === 1 ? '2px' : '4px 24px',
                borderRadius: 'var(--radius-md)',
              }} className="tracks-grid-2col">
                {freeTracks.slice(0, TRACK_DISPLAY_COUNT).map((track, index) => (
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

          {/* ──────── 5. TOUS LES ALBUMS — Grille fluide 5×2 ──────── */}
          {filteredAlbums.length > 0 && (
            <div>
              <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Disc size={20} color="var(--color-accent)" />
                  <h2 className="section-title">Tous les albums</h2>
                </div>
                <span
                  className="section-link"
                  onClick={() => navigate('/catalog')}
                  style={{ cursor: 'pointer' }}
                >
                  Voir tout →
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${ALBUM_GRID_COLUMNS}, minmax(0, 1fr))`,
                gap: 16,
              }} className="albums-grid">
                {filteredAlbums.slice(0, ALBUM_DISPLAY_COUNT).map((album) => (
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

          {/* Bottom spacing */}
          <div style={{ height: 16 }} />
          </>
          )}

          {isMobile && (
            <>

            {/* ── PERSO (uniquement) ── */}
            
                  <div key={`tab-${tabTransitionKey}`} className={`slide-in-${slideDirection}`} style={{ padding: '0 8px' }}>
                    {/* ═══════════════════════════════════════
                        MESSAGE DACCUEIL CONTEXTUEL — Version premium
                        ═══════════════════════════════════════ */}
                    {(() => {
                      const hour = new Date().getHours();
                      let greeting: string;
                      if (hour < 6) greeting = 'Belle nuit';
                      else if (hour < 12) greeting = 'Bonjour';
                      else if (hour < 18) greeting = 'Bon après-midi';
                      else greeting = 'Bonsoir';
                      const artistCount = persoTopArtists.length;
                      return (
                        <div style={{ paddingBottom: 10 }}>
                          <h2 style={{
                            color: 'var(--color-text-primary)',
                            fontSize: 26,
                            fontWeight: 800,
                            letterSpacing: '-0.8px',
                            margin: 0,
                            lineHeight: '32px',
                            background: 'linear-gradient(135deg, var(--color-text-primary) 60%, var(--color-text-secondary))',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                          }}>
                            {greeting}
                          </h2>
                          {artistCount > 0 && (
                            <p style={{
                              color: 'var(--color-text-muted)',
                              fontSize: 14,
                              margin: '2px 0 0',
                              fontWeight: 500,
                              letterSpacing: '-0.1px',
                            }}>
                              {persoDerived.totalPlays} écoute{persoDerived.totalPlays > 1 ? 's' : ''} · {artistCount} artiste{artistCount > 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* ═══════════════════════════════════════
                        MODE HORS-LIGNE — Message dédié
                        ═══════════════════════════════════════ */}
                    {isOfflineMode && (
                      <div className="reveal-up" style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '14px 16px',
                        borderRadius: 'var(--radius-md)',
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        border: '1px solid rgba(139,92,246,0.08)',
                        marginBottom: 12,
                        transition: 'all 0.2s ease',
                      }}>
                        {/* Icon container */}
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: 'var(--radius-full)',
                          background: 'rgba(139,92,246,0.08)',
                          border: '1px solid rgba(139,92,246,0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(139,92,246)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            color: 'var(--color-text-primary)',
                            fontSize: 14,
                            fontWeight: 700,
                            letterSpacing: '-0.2px',
                            marginBottom: 1,
                          }}>
                            Mode hors-ligne
                          </div>
                          <div style={{
                            color: 'var(--color-text-secondary)',
                            fontSize: 12,
                            fontWeight: 500,
                            lineHeight: '18px',
                          }}>
                            {newAlbums.length > 0
                              ? `${newAlbums.length} album${newAlbums.length > 1 ? 's' : ''} disponible${newAlbums.length > 1 ? 's' : ''} sans connexion`
                              : 'Connectez-vous pour découvrir de nouveaux titres'}
                          </div>
                        </div>

                        {/* Link to local library */}
                        {newAlbums.length > 0 && (
                          <div
                            onClick={() => navigate('/local')}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '6px 10px',
                              borderRadius: 'var(--radius-full)',
                              background: 'rgba(139,92,246,0.08)',
                              border: '1px solid rgba(139,92,246,0.06)',
                              cursor: 'pointer',
                              color: 'rgb(139,92,246)',
                              fontSize: 11,
                              fontWeight: 700,
                              flexShrink: 0,
                              transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.15)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.08)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                          >
                            <span>Bibliothèque</span>
                            <ChevronRight size={12} />
                          </div>
                        )}
                      </div>
                    )}

                    {/* ═══════════════════════════════════════
                        ÉTAT VIDE — Invitation à explorer
                        ═══════════════════════════════════════ */}
                    {persoTopArtists.length === 0 && (
                      <div className="reveal-up" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 16,
                        padding: '28px 20px 24px',
                        borderRadius: 'var(--radius-md)',
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255,255,255,0.04)',
                        marginBottom: 12,
                        textAlign: 'center',
                        position: 'relative',
                        overflow: 'hidden',
                      }}>
                        {/* Decorative orb */}
                        <div style={{
                          position: 'absolute',
                          top: -40,
                          right: -40,
                          width: 120,
                          height: 120,
                          borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(220,20,60,0.06), transparent 70%)',
                          pointerEvents: 'none',
                        }} />
                        <div style={{
                          position: 'absolute',
                          bottom: -30,
                          left: -30,
                          width: 100,
                          height: 100,
                          borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(220,20,60,0.04), transparent 70%)',
                          pointerEvents: 'none',
                        }} />

                        {/* Welcome icon */}
                        <div style={{
                          width: 56,
                          height: 56,
                          borderRadius: 'var(--radius-full)',
                          background: 'linear-gradient(135deg, rgba(220,20,60,0.12), rgba(220,20,60,0.04))',
                          border: '1px solid rgba(220,20,60,0.08)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          boxShadow: '0 0 20px rgba(220,20,60,0.06)',
                          position: 'relative',
                          zIndex: 1,
                        }}>
                          <Sparkles size={24} color="var(--color-accent)" />
                        </div>

                        {/* Welcome text */}
                        <div style={{ position: 'relative', zIndex: 1 }}>
                          <h3 style={{
                            color: 'var(--color-text-primary)',
                            fontSize: 18,
                            fontWeight: 700,
                            margin: 0,
                            lineHeight: '24px',
                            letterSpacing: '-0.3px',
                          }}>
                            Bienvenue sur Pass'io
                          </h3>
                          <p style={{
                            color: 'var(--color-text-muted)',
                            fontSize: 13,
                            lineHeight: '20px',
                            margin: '6px 0 0',
                            fontWeight: 500,
                            maxWidth: 280,
                          }}>
                            Commencez à explorer les titres et artistes disponibles. Votre historique d'écoute apparaîtra ici.
                          </p>
                        </div>

                        {/* Quick actions */}
                        <div style={{
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          justifyContent: 'center',
                          position: 'relative',
                          zIndex: 1,
                        }}>
                          <button
                            onClick={() => setMobileTab('titres')}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '8px 18px',
                              borderRadius: 'var(--radius-full)',
                              background: 'rgba(220,20,60,0.08)',
                              border: '1px solid rgba(220,20,60,0.08)',
                              cursor: 'pointer',
                              color: 'var(--color-accent)',
                              fontSize: 12,
                              fontWeight: 700,
                              transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(220,20,60,0.14)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(220,20,60,0.08)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                          >
                            <Music size={13} />
                            Explorer les titres
                          </button>
                          <button
                            onClick={() => navigate('/artists')}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '8px 18px',
                              borderRadius: 'var(--radius-full)',
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px solid rgba(255,255,255,0.06)',
                              cursor: 'pointer',
                              color: 'var(--color-text-secondary)',
                              fontSize: 12,
                              fontWeight: 600,
                              transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                          >
                            <User size={13} />
                            Découvrir les artistes
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ═══════════════════════════════════════
                        GLASS STATS CARD — Moderne avec verre dépoli
                        ═══════════════════════════════════════ */}
                    {persoTopArtists.length > 0 && (
                      <div className="reveal-up delay-1" style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '14px 16px',
                        borderRadius: 'var(--radius-md)',
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        marginBottom: 12,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
                        transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.04)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                      >
                        {/* Decorative gradient orb */}
                        <div style={{
                          position: 'absolute',
                          top: -30,
                          right: -30,
                          width: 80,
                          height: 80,
                          borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(220,20,60,0.08), transparent)',
                          pointerEvents: 'none',
                        }} />

                        {/* Level badge with glow + label */}
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 4,
                          flexShrink: 0,
                        }}>
                          {/* Niveau label au-dessus de l'icône */}
                          <span style={{
                            fontSize: 8,
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.8px',
                            color: (() => {
                              const level = getListeningLevel(persoDerived.totalPlays);
                              return level.label === 'Expert' ? '#FFD700' : level.label === 'Fidèle' ? '#FFD700' : 'var(--color-text-muted)';
                            })(),
                            whiteSpace: 'nowrap',
                          }}>
                            {getListeningLevel(persoDerived.totalPlays).label}
                          </span>
                          <div style={{
                            width: 40,
                            height: 40,
                            borderRadius: 'var(--radius-full)',
                            background: (() => {
                              const level = getListeningLevel(persoDerived.totalPlays);
                              if (level.label === 'Expert') return 'linear-gradient(135deg, #FFD700, #DC143C)';
                              if (level.label === 'Fidèle') return 'linear-gradient(135deg, #FF6B6B, #DC143C)';
                              return 'var(--color-accent-gradient)';
                            })(),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            boxShadow: (() => {
                              const level = getListeningLevel(persoDerived.totalPlays);
                              if (level.label === 'Expert') return '0 0 16px rgba(255,215,0,0.3)';
                              if (level.label === 'Fidèle') return '0 0 14px rgba(255,107,107,0.25)';
                              return '0 0 12px rgba(220,20,60,0.2)';
                            })(),
                            position: 'relative',
                            zIndex: 1,
                          }}>
                            {(() => {
                              const level = getListeningLevel(persoDerived.totalPlays);
                              if (level.label === 'Expert') return <Crown size={18} color="#fff" />;
                              if (level.label === 'Fidèle') return <Star size={18} color="#fff" />;
                              if (level.label === 'Régulier') return <Flame size={18} color="#fff" />;
                              return <Sparkles size={18} color="#fff" />;
                            })()}
                          </div>
                        </div>

                        {/* Stats */}
                        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}>
                            <span style={{
                              color: 'var(--color-text-primary)',
                              fontSize: 18,
                              fontWeight: 800,
                              fontVariantNumeric: 'tabular-nums',
                              lineHeight: '20px',
                              letterSpacing: '-0.3px',
                            }}>
                              {persoDerived.totalPlays}
                            </span>
                            <span style={{
                              color: 'var(--color-text-muted)',
                              fontSize: 12,
                              fontWeight: 500,
                            }}>
                              écoutes
                            </span>

                          </div>
                          <div style={{
                            color: 'var(--color-text-secondary)',
                            fontSize: 12,
                            fontWeight: 500,
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}>
                            <span>Top :</span>
                            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                              {persoTopArtists[0]?.artistName}
                            </span>
                            <span style={{ color: 'var(--color-accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {persoTopArtists[0]?.playCount}
                            </span>
                            <span style={{ color: 'var(--color-text-muted)' }}>éc.</span>
                          </div>
                        </div>

                        {/* Streak pill avec glow */}
                        {listeningStreak.filter(d => d.active).length > 0 && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '5px 10px',
                            borderRadius: 'var(--radius-full)',
                            background: 'linear-gradient(135deg, rgba(220,20,60,0.1), rgba(220,20,60,0.04))',
                            border: '1px solid rgba(220,20,60,0.1)',
                            flexShrink: 0,
                            position: 'relative',
                            zIndex: 1,
                            boxShadow: '0 0 8px rgba(220,20,60,0.05)',
                          }}>
                            <Flame size={13} color="var(--color-accent)" style={{ filter: 'drop-shadow(0 0 3px rgba(220,20,60,0.3))' }} />
                            <span style={{ color: 'var(--color-accent)', fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                              {listeningStreak.filter(d => d.active).length}
                            </span>
                            <span style={{ color: 'var(--color-text-muted)', fontSize: 8, fontWeight: 600, letterSpacing: '0.3px' }}>
                              JOURS
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ═══════════════════════════════════════
                        QUICK ACTIONS — Verre dépoli
                        ═══════════════════════════════════════ */}
                    {persoTopArtists.length > 0 && (
                      <div className="reveal-up delay-1" style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 8,
                        marginBottom: 20,
                      }}>
                        {[
                          { label: 'Titres', icon: 'Music', tab: 'titres' as const },
                          { label: 'Artistes', icon: 'User', path: '/artists' },
                          { label: 'Albums', icon: 'Disc', path: '/catalog' },
                        ].map((item) => {
                          const Icon = item.icon === 'Music' ? Music : item.icon === 'User' ? User : Disc;
                          return (
                            <button
                              key={item.label}
                              onClick={() => {
                                if (item.tab) setMobileTab(item.tab);
                                else if (item.path) navigate(item.path);
                              }}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 8,
                                padding: '12px 8px',
                                borderRadius: 'var(--radius-md)',
                                background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                                backdropFilter: 'blur(8px)',
                                WebkitBackdropFilter: 'blur(8px)',
                                border: '1px solid rgba(255,255,255,0.04)',
                                cursor: 'pointer',
                                color: 'var(--color-text-secondary)',
                                fontSize: 11,
                                fontWeight: 600,
                                transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                letterSpacing: '0.2px',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                            >
                              <div style={{
                                width: 34,
                                height: 34,
                                borderRadius: 'var(--radius-full)',
                                background: 'linear-gradient(135deg, rgba(220,20,60,0.08), rgba(220,20,60,0.02))',
                                border: '1px solid rgba(220,20,60,0.06)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                transition: 'all 0.25s ease',
                              }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(220,20,60,0.15), rgba(220,20,60,0.05))'; e.currentTarget.style.boxShadow = '0 0 10px rgba(220,20,60,0.1)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(220,20,60,0.08), rgba(220,20,60,0.02))'; e.currentTarget.style.boxShadow = 'none'; }}
                              >
                                <Icon size={16} color="var(--color-accent)" />
                              </div>
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* ═══════════════════════════════════════
                        SECTION: FAIT POUR VOUS — Premium
                        ═══════════════════════════════════════ */}
                    {persoTopArtists.length > 0 && (recommendedAlbums.length > 0 || (scoredArtists.length > 0 && recommendedFeatAlbums.length > 0)) && (
                      <div className="reveal-up delay-2" style={{ marginBottom: 16, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 16 }}>
                        {/* Section header avec barre décorative */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          marginBottom: 14,
                          paddingLeft: 12,
                          borderLeft: '3px solid var(--color-accent)',
                        }}>
                          <span style={{
                            color: 'var(--color-text-primary)',
                            fontSize: 18,
                            fontWeight: 800,
                            letterSpacing: '-0.4px',
                          }}>
                            Fait pour vous
                          </span>
                          <Sparkles size={14} color="var(--color-accent)" style={{ opacity: 0.6 }} />
                        </div>

                        {/* NOUVEAUTÉS POUR VOUS */}
                        {recommendedAlbums.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <AlbumRow
                              title="Nouveautés"
                              icon={<Music size={14} color="var(--color-accent)" />}
                              albums={recommendedAlbums}
                              cardWidth={150}
                              maxItems={8}
                              footerLink={{ label: 'Tout voir', to: '/catalog' }}
                              onFooterPress={() => navigate('/catalog')}
                              onAlbumPress={(id) => navigate(`/album/${id}`)}
                              renderCardOverlay={(album) => {
                                const isPremium = !album.is_free;
                                const albumArtistName = album.artist_name || album.artist?.name || '';
                                const matched = persoTopArtists.find(a =>
                                  normalizeArtistName(a.artistName) === normalizeArtistName(albumArtistName)
                                );
                                return (
                                  <>
                                    {isPremium && (
                                      <div style={{
                                        position: 'absolute', top: 5, right: 5,
                                        background: 'linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,215,0,0.05))',
                                        backdropFilter: 'blur(8px)',
                                        WebkitBackdropFilter: 'blur(8px)',
                                        borderRadius: 'var(--radius-full)',
                                        padding: '2px 7px',
                                        border: '1px solid rgba(255,215,0,0.15)',
                                      }}>
                                        <span style={{ color: '#FFD700', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Premium</span>
                                      </div>
                                    )}
                                    {matched && (
                                      <div style={{
                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                        background: 'linear-gradient(transparent 30%, rgba(0,0,0,0.9))',
                                        padding: '24px 7px 7px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                      }}>
                                        <span style={{
                                          display: 'inline-flex', width: 12, height: 12,
                                          borderRadius: 'var(--radius-full)',
                                          background: 'rgba(220,20,60,0.8)',
                                          alignItems: 'center', justifyContent: 'center',
                                          flexShrink: 0,
                                        }}>
                                          <Sparkles size={7} color="#fff" />
                                        </span>
                                        <span style={{ fontSize: 8, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {matched.artistName}
                                        </span>
                                      </div>
                                    )}
                                  </>
                                );
                              }}
                            />
                          </div>
                        )}

                        {/* QUELQUES ALBUMS PREMIUM */}
                        {sortedPaidAlbums.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <AlbumRow
                              title="Premium"
                              icon={<Crown size={14} color="#FFD700" />}
                              albums={sortedPaidAlbums.slice(0, 6)}
                              cardWidth={150}
                              maxItems={4}
                              accentColor="#FFD700"
                              iconBg="linear-gradient(135deg, #FFD700, #FFA500)"
                              onAlbumPress={(id) => navigate(`/album/${id}`)}
                            />
                          </div>
                        )}

                        {/* DANS LE MÊME ALBUM — Contexte d'album */}
                        {albumContextAlbums.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <AlbumRow
                              title="Dans le même album"
                              icon={<Disc size={14} color="#fff" />}
                              albums={albumContextAlbums.map((a: AlbumContextRecommendation) => ({
                                id: a.albumId,
                                title: a.albumTitle,
                                cover_url: a.coverUrl,
                                artist_name: a.artistName,
                                artist_id: '',
                                price_ariary: 0,
                                is_free: true,
                                type: 'album' as const,
                                status: 'published' as const,
                              }))}
                              cardWidth={150}
                              maxItems={4}
                              iconBg="var(--color-accent-gradient)"
                              onAlbumPress={(id) => navigate(`/album/${id}`)}
                              renderBadge={(album) => {
                                const ctx = albumContextAlbums.find((a: AlbumContextRecommendation) => a.albumId === album.id);
                                if (!ctx || ctx.newTrackCount <= 0) return null;
                                return (
                                  <span style={{
                                    fontSize: 9, fontWeight: 700,
                                    color: 'var(--color-accent)',
                                    background: 'var(--color-accent-soft)',
                                    padding: '1px 6px',
                                    borderRadius: 'var(--radius-full)',
                                  }}>
                                    +{ctx.newTrackCount} nouveau{ctx.newTrackCount > 1 ? 'x' : ''}
                                  </span>
                                );
                              }}
                              renderCardOverlay={(album) => {
                                const ctx = albumContextAlbums.find((a: AlbumContextRecommendation) => a.albumId === album.id);
                                if (!ctx || ctx.triggerArtists.length === 0) return null;
                                return (
                                  <div style={{
                                    position: 'absolute', top: 5, left: 5,
                                    background: 'linear-gradient(135deg, rgba(220,20,60,0.15), rgba(220,20,60,0.05))',
                                    backdropFilter: 'blur(8px)',
                                    WebkitBackdropFilter: 'blur(8px)',
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '3px 7px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    maxWidth: 'calc(100% - 10px)',
                                    overflow: 'hidden',
                                    border: '1px solid rgba(220,20,60,0.1)',
                                  }}>
                                    <img
                                      src="https://i.ibb.co/LDJ2Vcrr/Logo-2.png"
                                      alt=""
                                      style={{
                                        width: 10, height: 10,
                                        objectFit: 'contain',
                                        filter: 'brightness(0) invert(1)',
                                        flexShrink: 0,
                                      }}
                                    />
                                    <span style={{
                                      fontSize: 8, fontWeight: 700,
                                      color: 'rgba(255,255,255,0.9)',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}>
                                      {ctx.triggerArtists[0]}
                                    </span>
                                  </div>
                                );
                              }}
                            />
                          </div>
                        )}

                        {/* DÉCOUVERTES VIA COLLABORATIONS */}
                        {scoredArtists.length > 0 && recommendedFeatAlbums.length > 0 && (
                          <div>
                            <AlbumRow
                              title="Collaborations"
                              icon={<Sparkles size={14} color="rgba(139,92,246,0.9)" />}
                              albums={recommendedFeatAlbums}
                              accentColor="rgba(139,92,246,0.6)"
                              iconBg="linear-gradient(135deg, rgba(139,92,246,0.3), rgba(139,92,246,0.1))"
                              cardWidth={150}
                              maxItems={8}
                              footerLink={{ label: 'Tout voir', to: '/catalog' }}
                              onFooterPress={() => navigate('/catalog')}
                              onAlbumPress={(id) => navigate(`/album/${id}`)}
                              renderCardOverlay={(album) => {
                                const normName = normalizeArtistName(album.artist_name || album.artist?.name || '');
                                const scored = scoredArtists.find(s => normalizeArtistName(s.artistName) === normName);
                                return scored && scored.via.length > 0 ? (
                                  <div style={{
                                    position: 'absolute', top: 5, left: 5,
                                    background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(139,92,246,0.05))',
                                    backdropFilter: 'blur(8px)',
                                    WebkitBackdropFilter: 'blur(8px)',
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '3px 7px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    maxWidth: 'calc(100% - 10px)',
                                    overflow: 'hidden',
                                    border: '1px solid rgba(139,92,246,0.1)',
                                  }}>
                                    <Sparkles size={8} color="rgba(139,92,246,0.9)" />
                                    <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      Via {scored.via[0]}
                                    </span>
                                  </div>
                                ) : null;
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* ═══════════════════════════════════════
                        SECTION: VOS ALBUMS FÉTICHES
                        ═══════════════════════════════════════ */}
                    {persoTopArtists.length > 0 && persoAlbumsByPlays.length > 0 && (
                      <div className="reveal-up delay-3" style={{ marginBottom: 16, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 16 }}>
                        <AlbumRow
                          title="Vos albums fétiches"
                          icon={<Disc size={14} color="var(--color-accent)" />}
                          albums={persoAlbumsByPlays}
                          cardWidth={150}
                          maxItems={6}
                          onAlbumPress={(id) => navigate(`/album/${id}`)}
                        />
                      </div>
                    )}

                    {/* ═══════════════════════════════════════
                        SECTION: TENDANCES — Découvertes populaires
                        ═══════════════════════════════════════ */}
                    {persoTopArtists.length > 0 && trendingAlbums.length > 0 && (
                      <div className="reveal-up delay-4">
                        <AlbumRow
                          title="Tendances"
                          icon={<Sparkles size={14} color="#fff" />}
                          albums={trendingAlbums}
                          accentColor="#7C3AED"
                          iconBg="linear-gradient(135deg, #7C3AED, #A855F7)"
                          badgeColor="#A855F7"
                          cardWidth={130}
                          maxItems={8}
                          onAlbumPress={(id) => navigate(`/album/${id}`)}
                          renderBadge={(album) => {
                            const normName = normalizeArtistName(album.artist_name || album.artist?.name || '');
                            const scored = scoredArtists.find(s => normalizeArtistName(s.artistName) === normName);
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{
                                  fontSize: 9, fontWeight: 700,
                                  padding: '1px 6px', borderRadius: 'var(--radius-full)',
                                  background: 'rgba(124,58,237,0.12)',
                                  color: '#A855F7',
                                }}>
                                  Découverte
                                </span>
                                {scored && (
                                  <span style={{ fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                                    +{scored.score}
                                  </span>
                                )}
                              </div>
                            );
                          }}
                        />
                      </div>
                    )}

                    {/* ═══════════════════════════════════════
                        SECTION: VOS TITRES — Premium
                        ═══════════════════════════════════════ */}
                    {(recentTracks.length > 0 || freeTracks.length > 0) && (
                      <div className="reveal-up delay-5" style={{ marginBottom: 16, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 16 }}>
                        {/* Section header */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          marginBottom: 14,
                          paddingLeft: 12,
                          borderLeft: '3px solid var(--color-accent)',
                        }}>
                          <span style={{
                            color: 'var(--color-text-primary)',
                            fontSize: 18,
                            fontWeight: 800,
                            letterSpacing: '-0.4px',
                          }}>
                            Vos titres
                          </span>
                          <Music size={13} color="var(--color-accent)" style={{ opacity: 0.6 }} />
                        </div>

                        {/* TITRES RÉCENTS */}
                        {recentTracks.length > 0 && (
                          <div style={{ marginBottom: 16 }}>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 6,
                              paddingRight: 4,
                            }}>
                              <span style={{
                                color: 'var(--color-text-muted)',
                                fontSize: 11,
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.6px',
                              }}>
                                Récemment écoutés
                              </span>
                            </div>
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              borderRadius: 'var(--radius-sm)',
                              overflow: 'hidden',
                              background: 'rgba(255,255,255,0.01)',
                              border: '1px solid rgba(255,255,255,0.03)',
                            }}>
                              {recentTracks.map((track, index) => (
                                <div key={track.id} style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '6px 10px',
                                  borderBottom: index < recentTracks.length - 1 ? '1px solid rgba(255,255,255,0.02)' : 'none',
                                  transition: 'background 0.15s ease',
                                }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                >
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

                        {/* NOUVEAUX TITRES */}
                        {freeTracks.length > 0 && (
                          <div>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 6,
                              paddingRight: 4,
                            }}>
                              <span style={{
                                color: 'var(--color-text-muted)',
                                fontSize: 11,
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.6px',
                              }}>
                                Nouveautés catalogue
                              </span>
                              <div
                                onClick={() => navigate('/tracks')}
                                style={{
                                  color: 'var(--color-text-muted)',
                                  fontSize: 10,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: '4px 10px',
                                  borderRadius: 'var(--radius-full)',
                                  border: '1px solid rgba(255,255,255,0.04)',
                                  transition: 'all 0.2s ease',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; }}
                              >
                                <span>Tout voir</span>
                                <ChevronRight size={11} />
                              </div>
                            </div>
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              borderRadius: 'var(--radius-sm)',
                              overflow: 'hidden',
                              background: 'rgba(255,255,255,0.01)',
                              border: '1px solid rgba(255,255,255,0.03)',
                            }}>
                              {freeTracks.slice(0, 5).map((track, index) => (
                                <div key={track.id} style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '6px 10px',
                                  borderBottom: index < 4 ? '1px solid rgba(255,255,255,0.02)' : 'none',
                                  transition: 'background 0.15s ease',
                                }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                >
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
                      </div>
                    )}

                    {/* ═══════════════════════════════════════
                        SECTION: VOS ARTISTES — Premium
                        ═══════════════════════════════════════ */}
                    {persoTopArtists.length > 0 && (
                      <div className="reveal-up delay-6" style={{ marginBottom: 12, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 16 }}>
                        {/* Section header */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          marginBottom: 12,
                          paddingLeft: 12,
                          borderLeft: '3px solid var(--color-accent)',
                        }}>
                          <span style={{
                            color: 'var(--color-text-primary)',
                            fontSize: 18,
                            fontWeight: 800,
                            letterSpacing: '-0.4px',
                          }}>
                            Vos artistes
                          </span>
                          <User size={13} color="var(--color-accent)" style={{ opacity: 0.6 }} />
                        </div>

                        {/* Top artists list */}
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          border: '1px solid rgba(255,255,255,0.03)',
                        }}>
                          {persoTopArtists.slice(0, 5).map((artist, index) => {
                            const photoUrl = artistPhotoMap.get(artist.artistId);
                            const initial = artist.artistName.charAt(0).toUpperCase();
                            return (
                            <button
                              key={artist.artistId}
                              onClick={() => navigate(`/artist/${artist.artistId}`)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '10px 12px',
                                background: index === 0 ? 'rgba(220,20,60,0.03)' : 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                                transition: 'background 0.15s ease',
                                borderBottom: index < 4 ? '1px solid rgba(255,255,255,0.02)' : 'none',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                                const avatar = e.currentTarget.children[0] as HTMLElement;
                                if (avatar) avatar.style.transform = 'scale(1.12)';
                                const info = e.currentTarget.children[1] as HTMLElement;
                                if (info) {
                                  const nameSpan = info.querySelector('span') as HTMLElement;
                                  if (nameSpan) nameSpan.style.color = 'var(--color-accent)';
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = index === 0 ? 'rgba(220,20,60,0.03)' : 'transparent';
                                const avatar = e.currentTarget.children[0] as HTMLElement;
                                if (avatar) avatar.style.transform = 'scale(1)';
                                const info = e.currentTarget.children[1] as HTMLElement;
                                if (info) {
                                  const nameSpan = info.querySelector('span') as HTMLElement;
                                  if (nameSpan) nameSpan.style.color = '';
                                }
                              }}
                            >
                              {/* Avatar — photo ou initiales */}
                              <div style={{
                                width: 40,
                                height: 40,
                                borderRadius: 'var(--radius-full)',
                                overflow: 'hidden',
                                flexShrink: 0,
                                background: photoUrl
                                  ? 'transparent'
                                  : index === 0
                                    ? 'linear-gradient(135deg, #DC143C, #8B0000)'
                                    : 'var(--color-surface-elevated)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: photoUrl && index === 0
                                  ? '0 0 0 2px var(--color-accent)'
                                  : 'none',
                                transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                              }}>
                                {photoUrl ? (
                                  <img
                                    src={photoUrl}
                                    alt={artist.artistName}
                                    loading="lazy"
                                    decoding="async"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  />
                                ) : (
                                  <span style={{
                                    color: index === 0 ? '#fff' : 'var(--color-text-muted)',
                                    fontSize: 15,
                                    fontWeight: 700,
                                  }}>
                                    {initial}
                                  </span>
                                )}
                              </div>

                              {/* Info */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {/* Rank badge */}
                                  {index === 0 ? (
                                    <Crown size={11} color="var(--color-accent)" />
                                  ) : (
                                    <span style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 700, minWidth: 10 }}>
                                      {index + 1}
                                    </span>
                                  )}
                                  <span style={{
                                    color: 'var(--color-text-primary)',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    flex: 1,
                                    transition: 'color 0.2s ease',
                                  }}>
                                    {artist.artistName}
                                  </span>
                                </div>
                                <span style={{
                                  color: 'var(--color-accent)',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  marginLeft: index === 0 ? 0 : 16,
                                }}>
                                  {artist.playCount} écoute{artist.playCount > 1 ? 's' : ''}
                                </span>
                              </div>
                            </button>
                            );
                          })}
                        </div>

                        {/* Voir tous */}
                        <button
                          onClick={() => navigate('/artists')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            padding: '10px',
                            marginTop: 8,
                            borderRadius: 'var(--radius-sm)',
                            background: 'rgba(255,255,255,0.01)',
                            border: '1px solid rgba(255,255,255,0.04)',
                            cursor: 'pointer',
                            width: '100%',
                            color: 'var(--color-text-muted)',
                            fontSize: 12,
                            fontWeight: 600,
                            transition: 'all 0.2s ease',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.01)'; e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; }}
                        >
                          Voir tous les artistes
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    )}

                    {/* ── SUGGESTIONS ALÉATOIRES — Pour découvrir */}
                    {randomSuggestions.length > 0 && (
                      <div className="reveal-up delay-6" style={{ marginTop: 4 }}>
                        <AlbumRow
                          title="Suggestions"
                          icon={<Sparkles size={14} color="var(--color-accent)" />}
                          albums={randomSuggestions}
                          cardWidth={150}
                          maxItems={6}
                          onAlbumPress={(id) => navigate(`/album/${id}`)}
                        />
                      </div>
                    )}

                  </div>

            {/* Bottom spacing pour le MobileNav */}
            <div style={{ height: 80 }} />
          </>
          )}
        </div>
      )}
    </Screen>
  );
}
