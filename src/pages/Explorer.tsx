import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CloudOff, Cloud, Compass, ArrowUpDown, Clock } from 'lucide-react';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { AlbumCard } from '@/components/AlbumCard';
import { ArtistCard } from '@/components/ArtistCard';
import { TrackListItem } from '@/components/TrackListItem';
import type { TrackWithAlbum } from '@/components/TrackListItem';
import { Screen, PageHeader } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
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

  const loadMoreTracks = () => {
    const nextCount = displayedTracks.length + ITEMS_PER_PAGE;
    setDisplayedTracks(freeTracks.slice(0, nextCount));
  };

  return (
    <Screen gradient padded>
      <PageHeader 
        title={isOfflineMode ? 'Bibliothèque locale' : 'Découvrir'}
        accent={!isOfflineMode}
        style={{ paddingTop: 'var(--header-padding)' }}
      >
        <button onClick={() => void toggleMode()} className="btn btn-ghost" style={{ padding: 8 }}>
          {isOfflineMode ? <CloudOff size={22} color="var(--color-accent)" /> : <Cloud size={22} />}
        </button>
        {!isOfflineMode && (
          <button onClick={() => navigate('/search')} className="btn btn-ghost" style={{ padding: 8 }}>
            <Search size={22} />
          </button>
        )}
      </PageHeader>

      {dataNotice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', marginBottom: 16, borderRadius: 14, backgroundColor: 'rgba(120,0,0,0.08)', border: '1px solid rgba(120,0,0,0.2)' }}>
          <CloudOff size={18} color="var(--color-accent)" />
          <p style={{ flex: 1, color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: '18px', margin: 0 }}>{dataNotice}</p>
        </div>
      )}

      {isOfflineMode ? (
        loading ? (
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
        ) : error ? (
          <div className="flex justify-center p-6 text-error">{error}</div>
        ) : (
          <>
            <SectionTitle>Téléchargés Pass'io</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
              {vaultAlbums.map((album) => (
                <AlbumCard key={album.id} album={album} onPress={() => navigate(`/album/${album.id}`)} />
              ))}
              {vaultAlbums.length === 0 && <p className="text-muted text-center" style={{ marginTop: 8 }}>Aucun album Pass'io téléchargé.</p>}
            </div>
            {freeTracks.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <SectionTitle>Titres gratuits (cache)</SectionTitle>
                <div style={{ marginTop: 16 }}>
                  {displayedTracks.map((track) => (
                    <TrackListItem key={track.id} track={track} isPlaying={currentTrack?.id === track.id && isPlaying} onPress={() => void handleTrackPress(track)} />
                  ))}
                </div>
                {displayedTracks.length < freeTracks.length && (
                  <button onClick={loadMoreTracks} className="btn btn-secondary" style={{ margin: '12px auto', display: 'flex' }}>Charger plus</button>
                )}
              </div>
            )}
          </>
        )
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button onClick={() => setActiveFilter('titres')} className={`chip ${activeFilter === 'titres' ? 'chip-active' : ''}`}>Titres</button>
            <button onClick={() => { setSelectedArtistId(null); setActiveFilter('albums'); }} className={`chip ${activeFilter === 'albums' ? 'chip-active' : ''}`}>Albums</button>
          </div>

          {loading ? (
            <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
          ) : error ? (
            <div className="flex justify-center p-6 text-error">{error}</div>
          ) : (
            <>
              {artists.length > 0 && activeFilter !== 'albums' && (
                <div style={{ marginBottom: 24 }}>
                  <SectionTitle>Artistes</SectionTitle>
                  <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '12px 0', scrollbarWidth: 'none' }}>
                    {artists.map((artist) => (
                      <ArtistCard key={artist.id} artist={artist} onPress={() => navigate(`/artist/${artist.id}`)} />
                    ))}
                  </div>
                </div>
              )}

              {activeFilter === 'titres' && (
                <div style={{ marginBottom: 24 }}>
                  <SectionTitle>Titres gratuits</SectionTitle>
                  <div style={{ marginTop: 16 }}>
                    {displayedTracks.map((track) => (
                      <TrackListItem key={track.id} track={track} isPlaying={currentTrack?.id === track.id && isPlaying} onPress={() => void handleTrackPress(track)} />
                    ))}
                  </div>
                  {displayedTracks.length < freeTracks.length && (
                    <button onClick={loadMoreTracks} className="btn btn-secondary" style={{ margin: '12px auto', display: 'flex' }}>Charger plus</button>
                  )}
                  {freeTracks.length === 0 && <p className="text-muted text-center" style={{ marginTop: 20 }}>Aucun titre gratuit disponible</p>}
                </div>
              )}

              {activeFilter === 'albums' && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <SectionTitle>{selectedArtistId ? `Albums — ${artists.find((a) => a.id === selectedArtistId)?.name ?? ''}` : 'Tous les albums'}</SectionTitle>
                    <button onClick={() => setAlbumSortOption(prev => prev === 'az' ? 'recent' : 'az')} className="btn btn-ghost" style={{ padding: 8 }}>
                      {albumSortOption === 'az' ? <ArrowUpDown size={20} /> : <Clock size={20} />}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    {(['all', 'album', 'single'] as const).map((type) => (
                      <button key={type} onClick={() => setAlbumTypeFilter(type)} className={`chip ${albumTypeFilter === type ? 'chip-active' : ''}`}>
                        {type === 'all' ? 'Tous' : type === 'album' ? 'Albums' : 'Singles'}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {sortedAlbums.map((album) => (
                      <AlbumCard key={album.id} album={album} onPress={() => navigate(`/album/${album.id}`)} />
                    ))}
                  </div>
                  {sortedAlbums.length === 0 && <p className="text-muted text-center" style={{ marginTop: 20 }}>Aucun album disponible</p>}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
