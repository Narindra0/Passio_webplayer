import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CloudOff, Cloud, ArrowUpDown, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { AlbumCard } from '@/components/AlbumCard';
import { ArtistCard } from '@/components/ArtistCard';
import { TrackListItem } from '@/components/TrackListItem';
import type { TrackWithAlbum } from '@/components/TrackListItem';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { listVaultAlbums, isAlbumReadyOffline } from '@/services/downloadManager';
import { freeCatalogDetailsMap, readFreeCatalogCache, writeFreeCatalogCache } from '@/services/freeCatalogCache';
import { buildArtistsFromAlbums, mapTracksFromAlbum } from '@/services/freeCatalogSearch';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';

type FilterType = 'titres' | 'albums';

export function ExplorerScreen() {
  const navigate = useNavigate();
  const { effectiveMode, toggleMode } = useLibraryMode();
  const { playFromTrackList, currentTrack, isPlaying } = useAudioPlayback();
  const isOfflineMode = effectiveMode === 'offline';

  const [activeFilter, setActiveFilter] = useState<FilterType>('titres');
  const [vaultAlbums, setVaultAlbums] = useState<PublicAlbumSummary[]>([]);
  const [allAlbums, setAllAlbums] = useState<PublicAlbumSummary[]>([]);
  const [freeTracks, setFreeTracks] = useState<TrackWithAlbum[]>([]);
  const [displayedTracks, setDisplayedTracks] = useState<TrackWithAlbum[]>([]);
  const [artists, setArtists] = useState<{ id: string; name: string; profile_picture_url?: string | null; fallback_image_url?: string | null }[]>([]);
  const artistScrollRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [albumSortOption, setAlbumSortOption] = useState<'az' | 'recent'>('az');
  const [albumTypeFilter, setAlbumTypeFilter] = useState<'all' | 'album' | 'single'>('all');

  const ITEMS_PER_PAGE = 10;
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDataNotice(null);
    try {
      const albums = await listAlbums();
      setAllAlbums(albums);
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
      const tracks: TrackWithAlbum[] = [];
      for (const item of albumDetailsList) {
        if (item) tracks.push(...mapTracksFromAlbum(item.album, item.details));
      }
      tracks.sort((a, b) => a.title.localeCompare(b.title));
      setFreeTracks(tracks);
      setDisplayedTracks(tracks.slice(0, ITEMS_PER_PAGE));
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
        setAllAlbums(offlineAlbums);
        setArtists(buildArtistsFromAlbums(offlineAlbums));
        const tracks = offlineAlbums.flatMap((album) => {
          const details = detailsMap.get(album.id);
          return details ? mapTracksFromAlbum(album, details) : [];
        });
        tracks.sort((a, b) => a.title.localeCompare(b.title));
        setFreeTracks(tracks);
        setDisplayedTracks(tracks.slice(0, ITEMS_PER_PAGE));
        setDataNotice('Données hors-ligne : catalogue gratuit chargé depuis le cache local.');
      } else {
        setError('Erreur réseau inconnue');
      }
    } finally { setLoading(false); }
  }, [ITEMS_PER_PAGE]);

  const loadOfflineData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDataNotice(null);
    try {
      const albums = await listVaultAlbums();
      setVaultAlbums(albums);
      const cached = await readFreeCatalogCache();
      if (cached) {
        const detailsMap = freeCatalogDetailsMap(cached);
        albumCacheRef.current = detailsMap;
        const offlineAlbums: PublicAlbumSummary[] = [];
        for (const album of cached.albums) {
          if (await isAlbumReadyOffline(album.id)) offlineAlbums.push(album);
        }
        setAllAlbums(offlineAlbums);
        setArtists(buildArtistsFromAlbums(offlineAlbums));
        const tracks = offlineAlbums.flatMap((album) => {
          const details = detailsMap.get(album.id);
          return details ? mapTracksFromAlbum(album, details) : [];
        });
        tracks.sort((a, b) => a.title.localeCompare(b.title));
        setFreeTracks(tracks);
        setDisplayedTracks(tracks.slice(0, ITEMS_PER_PAGE));
        setDataNotice('Catalogue gratuit chargé depuis le cache local.');
      } else { setFreeTracks([]); albumCacheRef.current = new Map(); }
    } catch (loadError) {
      setVaultAlbums([]);
      setError(loadError instanceof Error ? loadError.message : 'Erreur chargement local');
    } finally { setLoading(false); }
  }, [ITEMS_PER_PAGE]);

  useEffect(() => {
    if (isOfflineMode) void loadOfflineData();
    else void loadData();
  }, [isOfflineMode, loadData, loadOfflineData]);

  async function handleTrackPress(track: TrackWithAlbum) {
    try { await playFromTrackList(freeTracks, albumCacheRef.current, track.id); }
    catch { /* ignore */ }
  }

  const displayedAlbums = selectedArtistId
    ? allAlbums.filter((a) => a.artist?.id === selectedArtistId || a.artist_name === artists.find((ar) => ar.id === selectedArtistId)?.name)
    : allAlbums;

  const sortedAlbums = useMemo(() => {
    let filtered = [...displayedAlbums];
    if (albumTypeFilter !== 'all') filtered = filtered.filter(album => album.type === albumTypeFilter);
    if (albumSortOption === 'az') filtered.sort((a, b) => a.title.localeCompare(b.title));
    else filtered.sort((a, b) => { const da = a.created_at ? new Date(a.created_at).getTime() : 0; const db = b.created_at ? new Date(b.created_at).getTime() : 0; return db - da; });
    return filtered;
  }, [displayedAlbums, albumSortOption, albumTypeFilter]);

  const scrollArtists = (direction: 'left' | 'right') => {
    if (!artistScrollRef.current) return;
    const scrollAmount = 720;
    artistScrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const loadMoreTracks = () => {
    const nextCount = displayedTracks.length + ITEMS_PER_PAGE;
    setDisplayedTracks(freeTracks.slice(0, nextCount));
  };

  return (
    <Screen gradient padded>
      {/* Red accent dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8 }}>
        <div style={{ width: 4, height: 28, borderRadius: 2, background: 'var(--color-accent-gradient)', flexShrink: 0 }} />
        <h1 style={{ color: 'var(--color-text-primary)', fontSize: 'clamp(28px, 3.5vw, 32px)', fontWeight: 700, letterSpacing: '-0.5px', margin: 0, lineHeight: 1.15 }}>
          {isOfflineMode ? 'Bibliothèque locale' : 'Découvrir'}
        </h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => navigate('/search')}
            className="btn-ghost"
            style={{ padding: 8 }}
          >
            <Search size={20} />
          </button>
          <button
            onClick={() => void toggleMode()}
            className="btn-ghost"
            style={{ padding: 8 }}
          >
            {isOfflineMode ? <CloudOff size={20} color="var(--color-accent)" /> : <Cloud size={20} />}
          </button>
        </div>
      </div>

      {dataNotice && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            marginBottom: 20,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-elevated)',
          }}
        >
          <CloudOff size={16} color="var(--color-text-muted)" />
          <p style={{ flex: 1, color: 'var(--color-text-secondary)', fontSize: 13, margin: 0 }}>{dataNotice}</p>
        </div>
      )}

      {isOfflineMode ? (
        loading ? (
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
        ) : error ? (
          <div className="flex justify-center p-6" style={{ color: 'var(--color-error)' }}>{error}</div>
        ) : (
          <>
            <div className="section-header">
              <h2 className="section-title">Téléchargés Pass'io</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {vaultAlbums.map((album) => (
                <AlbumCard key={album.id} album={album} onPress={() => navigate(`/album/${album.id}`)} />
              ))}
              {vaultAlbums.length === 0 && (
                <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 20 }}>
                  Aucun album Pass'io téléchargé.
                </p>
              )}
            </div>
            {freeTracks.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <div className="section-header">
                  <h2 className="section-title">Titres gratuits</h2>
                </div>
                <div>
                  {displayedTracks.map((track) => (
                    <TrackListItem key={track.id} track={track} isPlaying={currentTrack?.id === track.id && isPlaying} onPress={() => void handleTrackPress(track)} />
                  ))}
                </div>
                {displayedTracks.length < freeTracks.length && (
                  <button onClick={loadMoreTracks} className="btn-secondary" style={{ margin: '12px auto', display: 'flex' }}>
                    Afficher plus
                  </button>
                )}
              </div>
            )}
          </>
        )
      ) : (
        <>
          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
            <button onClick={() => setActiveFilter('titres')} className={`chip ${activeFilter === 'titres' ? 'chip-active' : ''}`}>
              Titres
            </button>
            <button onClick={() => { setSelectedArtistId(null); setActiveFilter('albums'); }} className={`chip ${activeFilter === 'albums' ? 'chip-active' : ''}`}>
              Albums
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
          ) : error ? (
            <div className="flex justify-center p-6" style={{ color: 'var(--color-error)' }}>{error}</div>
          ) : (
            <>
              {/* Artists Section — Spotify-style horizontal scroll */}
              {artists.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                  <div className="section-header">
                    <h2 className="section-title">Artistes populaires</h2>
                    <span
                      className="section-link"
                      onClick={() => navigate('/artists')}
                      style={{ cursor: 'pointer' }}
                    >
                      Voir tout
                    </span>
                  </div>
                  <div style={{ position: 'relative' }}>
                    {/* Left scroll button */}
                    {artists.length > 3 && (
                      <button
                        onClick={() => scrollArtists('left')}
                        style={{
                          position: 'absolute',
                          left: -8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          zIndex: 10,
                          width: 40,
                          height: 40,
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--color-surface-glass)',
                          backdropFilter: 'blur(12px)',
                          border: '1px solid var(--color-border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: 'var(--color-text-primary)',
                          boxShadow: 'var(--shadow-md)',
                          transition: 'all var(--transition-fast) ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--color-surface-hover)';
                          e.currentTarget.style.transform = 'translateY(-50%) scale(1.05)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'var(--color-surface-glass)';
                          e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                        }}
                      >
                        <ChevronLeft size={20} />
                      </button>
                    )}

                    <div
                      ref={artistScrollRef}
                      style={{
                        display: 'flex',
                        gap: 0,
                        overflowX: 'auto',
                        padding: '4px 0',
                        scrollbarWidth: 'none',
                        marginLeft: -4,
                        marginRight: -4,
                        scrollBehavior: 'smooth',
                      }}
                    >
                      {artists.map((artist) => (
                        <ArtistCard key={artist.id} artist={artist} onPress={() => navigate(`/artist/${artist.id}`)} />
                      ))}
                    </div>

                    {/* Right scroll button */}
                    {artists.length > 3 && (
                      <button
                        onClick={() => scrollArtists('right')}
                        style={{
                          position: 'absolute',
                          right: -8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          zIndex: 10,
                          width: 40,
                          height: 40,
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--color-surface-glass)',
                          backdropFilter: 'blur(12px)',
                          border: '1px solid var(--color-border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: 'var(--color-text-primary)',
                          boxShadow: 'var(--shadow-md)',
                          transition: 'all var(--transition-fast) ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--color-surface-hover)';
                          e.currentTarget.style.transform = 'translateY(-50%) scale(1.05)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'var(--color-surface-glass)';
                          e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                        }}
                      >
                        <ChevronRight size={20} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Tracks Section */}
              {activeFilter === 'titres' && (
                <div>
                  <div className="section-header">
                    <h2 className="section-title">Titres gratuits</h2>
                  </div>
                  <div>
                    {displayedTracks.map((track) => (
                      <TrackListItem key={track.id} track={track} isPlaying={currentTrack?.id === track.id && isPlaying} onPress={() => void handleTrackPress(track)} />
                    ))}
                  </div>
                  {displayedTracks.length < freeTracks.length && (
                    <button onClick={loadMoreTracks} className="btn-secondary" style={{ margin: '12px auto', display: 'flex' }}>
                      Afficher plus
                    </button>
                  )}
                  {freeTracks.length === 0 && (
                    <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 20 }}>
                      Aucun titre gratuit disponible
                    </p>
                  )}
                </div>
              )}

              {/* Albums Section — grid layout */}
              {activeFilter === 'albums' && (
                <div>
                  <div className="section-header">
                    <h2 className="section-title">
                      {selectedArtistId
                        ? `Albums — ${artists.find((a) => a.id === selectedArtistId)?.name ?? ''}`
                        : 'Tous les albums'}
                    </h2>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setAlbumSortOption(prev => prev === 'az' ? 'recent' : 'az')} className="btn-ghost" style={{ padding: 6 }}>
                        {albumSortOption === 'az' ? <ArrowUpDown size={18} /> : <Clock size={18} />}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                    {(['all', 'album', 'single'] as const).map((type) => (
                      <button key={type} onClick={() => setAlbumTypeFilter(type)} className={`chip ${albumTypeFilter === type ? 'chip-active' : ''}`}>
                        {type === 'all' ? 'Tous' : type === 'album' ? 'Albums' : 'Singles'}
                      </button>
                    ))}
                  </div>
                  {/* Grid layout for albums */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
                    gap: 16,
                  }}>
                    {sortedAlbums.map((album) => (
                      <AlbumCard key={album.id} album={album} variant="tile" onPress={() => navigate(`/album/${album.id}`)} />
                    ))}
                  </div>
                  {sortedAlbums.length === 0 && (
                    <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 20 }}>
                      Aucun album disponible
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
