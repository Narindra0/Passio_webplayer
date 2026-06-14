import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpDown, ChevronLeft, ChevronRight, ListMusic, Search, ArrowLeft } from 'lucide-react';
import { Screen } from '@/components/Screen';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { freeCatalogDetailsMap, readFreeCatalogCache, writeFreeCatalogCache, staleWhileRevalidate } from '@/services/freeCatalogCache';
import { mapTracksFromAlbum } from '@/services/freeCatalogSearch';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { useAudioPlayback } from '@/contexts/AudioContext';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';

const TRACKS_PER_PAGE = 20;
const SORT_OPTIONS = ['Plus récent', 'Plus ancien', 'A-Z', 'Z-A'] as const;

export function TracksScreen() {
  const navigate = useNavigate();
  const { playFromTrackList, currentTrack, isPlaying } = useAudioPlayback();

  const [tracks, setTracks] = useState<TrackWithAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<string>('Plus récent');
  const [page, setPage] = useState(0);
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());

  function populateCache(detailsMap: Map<string, PublicAlbumDetails>) {
    albumCacheRef.current = detailsMap;
  }

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
        return { albums: freeAlbums, albumDetails: detailsMap };
      });

      if (cacheResult.data) {
        const detailsMap = freeCatalogDetailsMap(cacheResult.data);
        populateCache(detailsMap);
        const albums = cacheResult.data.albums;
        const allTracks: TrackWithAlbum[] = [];
        for (const album of albums) {
          const details = detailsMap.get(album.id);
          if (details) allTracks.push(...mapTracksFromAlbum(album, details));
        }
        setTracks(allTracks);
        setLoading(false);
        return;
      }

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

      populateCache(cache);
      const allTracks: TrackWithAlbum[] = [];
      for (const album of freeAlbums) {
        const details = cache.get(album.id);
        if (details) allTracks.push(...mapTracksFromAlbum(album, details));
      }
      setTracks(allTracks);
      await writeFreeCatalogCache(freeAlbums, cache);
    } catch {
      const cached = await readFreeCatalogCache();
      if (cached) {
        const detailsMap = freeCatalogDetailsMap(cached);
        populateCache(detailsMap);
        const allTracks: TrackWithAlbum[] = [];
        for (const album of cached.albums) {
          const details = detailsMap.get(album.id);
          if (details) allTracks.push(...mapTracksFromAlbum(album, details));
        }
        setTracks(allTracks);
      } else {
        setError('Impossible de charger le catalogue.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Filter + sort
  const filteredTracks = useMemo(() => {
    const search = query.trim().toLowerCase();
    let result = tracks.filter((t) => {
      if (!search) return true;
      return (
        t.title.toLowerCase().includes(search) ||
        t.artist_name.toLowerCase().includes(search) ||
        t.album_title.toLowerCase().includes(search)
      );
    });

    if (sortBy === 'Plus récent') {
      // Keep original order (newest first by album date)
    } else if (sortBy === 'Plus ancien') {
      result = [...result].reverse();
    } else if (sortBy === 'A-Z') {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'Z-A') {
      result = [...result].sort((a, b) => b.title.localeCompare(a.title));
    }

    return result;
  }, [tracks, query, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredTracks.length / TRACKS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedTracks = filteredTracks.slice(safePage * TRACKS_PER_PAGE, (safePage + 1) * TRACKS_PER_PAGE);

  function handleTrackPress(track: TrackWithAlbum) {
    playFromTrackList(tracks, albumCacheRef.current, track.id).catch(() => {});
  }

  return (
    <Screen gradient padded>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16 }}>
        <button
          onClick={() => navigate('/discover')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 'var(--radius-full)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
            cursor: 'pointer', color: 'var(--color-text-secondary)',
            fontSize: 13, fontWeight: 600,
            transition: 'all var(--transition-fast) ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
        >
          <ArrowLeft size={16} />
          Retour
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius-full)',
            background: 'var(--color-accent-gradient)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <ListMusic size={18} color="#fff" />
          </div>
          <div>
            <h1 style={{
              color: 'var(--color-text-primary)', fontSize: 22, fontWeight: 700,
              margin: 0, lineHeight: 1.2,
            }}>
              Catalogue des titres
            </h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: 0 }}>
              {tracks.length} titres disponibles
            </p>
          </div>
        </div>
      </div>

      {/* Search + sort bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} color="var(--color-text-muted)" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Rechercher un titre, artiste ou album…"
          />
        </div>
        <button
          onClick={() => {
            const idx = SORT_OPTIONS.indexOf(sortBy as typeof SORT_OPTIONS[number]);
            setSortBy(SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length]);
            setPage(0);
          }}
          title={`Tri : ${sortBy}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '0 16px', height: 44,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
            cursor: 'pointer', color: 'var(--color-text-secondary)',
            fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            transition: 'all var(--transition-fast) ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
        >
          <ArrowUpDown size={15} />
          {sortBy}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--color-text-muted)' }}>{error}</p>
          <button onClick={() => void loadData()} className="btn-secondary" style={{ marginTop: 12 }}>Réessayer</button>
        </div>
      ) : filteredTracks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--color-text-muted)' }}>
            {query.trim() ? 'Aucun titre ne correspond.' : 'Aucun titre disponible.'}
          </p>
        </div>
      ) : (
        <>
          {/* Grille 2 colonnes de titres */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '4px 24px',
          }}>
            {paginatedTracks.map((track) => {
              const isThisCurrent = currentTrack?.id === track.id;
              return (
                <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrackListItem
                    track={track}
                    isPlaying={isThisCurrent && isPlaying}
                    onPress={() => handleTrackPress(track)}
                  />
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 12, marginTop: 24, padding: '12px 0',
            }}>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 18px', borderRadius: 'var(--radius-full)',
                  background: safePage === 0 ? 'var(--color-surface)' : 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-subtle)',
                  cursor: safePage === 0 ? 'default' : 'pointer',
                  color: safePage === 0 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                  fontSize: 13, fontWeight: 600,
                  transition: 'all var(--transition-fast) ease',
                  opacity: safePage === 0 ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (safePage > 0) { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }
                }}
                onMouseLeave={(e) => {
                  if (safePage > 0) { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }
                }}
              >
                <ChevronLeft size={15} />
                Précédent
              </button>

              <span style={{
                color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {safePage + 1} / {totalPages}
              </span>

              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 18px', borderRadius: 'var(--radius-full)',
                  background: safePage >= totalPages - 1 ? 'var(--color-surface)' : 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-subtle)',
                  cursor: safePage >= totalPages - 1 ? 'default' : 'pointer',
                  color: safePage >= totalPages - 1 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                  fontSize: 13, fontWeight: 600,
                  transition: 'all var(--transition-fast) ease',
                  opacity: safePage >= totalPages - 1 ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (safePage < totalPages - 1) { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }
                }}
                onMouseLeave={(e) => {
                  if (safePage < totalPages - 1) { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }
                }}
              >
                Suivant
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
