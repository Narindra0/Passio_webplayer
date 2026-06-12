import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search as SearchIcon, CloudOff } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { ArtistCard } from '@/components/ArtistCard';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { Screen, PageHeader } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { searchFreeCatalogCache } from '@/services/freeCatalogSearch';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';

export function SearchScreen() {
  const navigate = useNavigate();
  const { effectiveMode } = useLibraryMode();
  const { playFromTrackList, currentTrack, isPlaying } = useAudioPlayback();
  const isOfflineMode = effectiveMode === 'offline';
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<{ tracks: TrackWithAlbum[]; albums: PublicAlbumSummary[]; artists: { id: string; name: string; profile_picture_url?: string | null }[] }>({ tracks: [], albums: [], artists: [] });
  const [loading, setLoading] = useState(false);
  const [dataNotice, setDataNotice] = useState<string | null>(null);

  async function handleSearch(query: string) {
    if (!query.trim()) { setResults({ tracks: [], albums: [], artists: [] }); setDataNotice(null); return; }
    setLoading(true);
    setDataNotice(null);

    if (isOfflineMode) {
      const cached = await searchFreeCatalogCache(query);
      if (cached) { albumCacheRef.current = cached.detailsMap; setResults({ tracks: cached.tracks, albums: cached.albums, artists: cached.artists }); setDataNotice('Recherche limitée au catalogue gratuit en cache.'); }
      else { setResults({ tracks: [], albums: [], artists: [] }); setDataNotice('Aucun catalogue gratuit en cache.'); }
      setLoading(false);
      return;
    }

    try {
      const albums = await listAlbums();
      const queryLower = query.toLowerCase();
      const filteredAlbums = albums.filter((a) => a.title?.toLowerCase().includes(queryLower) || a.artist_name?.toLowerCase().includes(queryLower));
      const tracks: TrackWithAlbum[] = [];
      for (const album of filteredAlbums) {
        try {
          const raw = await getAlbum(album.id);
          const albumDetails = unwrapAlbumDetails(raw);
          albumCacheRef.current.set(album.id, albumDetails);
          tracks.push(...albumDetails.tracks.map((track) => ({ ...track, artist_name: album.artist_name || album.artist?.name || 'Artiste inconnu', album_title: album.title })));
        } catch { continue; }
      }
      const filteredTracks = tracks.filter((t) => t.title.toLowerCase().includes(queryLower));
      const artistsMap = new Map<string, { id: string; name: string; profile_picture_url?: string | null }>();
      albums.forEach((album) => {
        if (album.artist && album.status === 'published') {
          const artistId = album.artist.id || album.artist_name || album.id;
          if (!artistsMap.has(artistId)) artistsMap.set(artistId, { id: artistId, name: album.artist.name || album.artist_name || 'Artiste inconnu', profile_picture_url: album.artist.profile_picture_url || album.artist_pdp });
        }
      });
      const filteredArtists = Array.from(artistsMap.values()).filter((a) => a.name.toLowerCase().includes(queryLower));
      setResults({ tracks: filteredTracks, albums: filteredAlbums, artists: filteredArtists });
    } catch {
      const cached = await searchFreeCatalogCache(query);
      if (cached) { albumCacheRef.current = cached.detailsMap; setResults({ tracks: cached.tracks, albums: cached.albums, artists: cached.artists }); setDataNotice('Réseau indisponible. Résultats du cache.'); }
      else { setResults({ tracks: [], albums: [], artists: [] }); setDataNotice('Recherche impossible.'); }
    } finally { setLoading(false); }
  }

  return (
    <Screen gradient padded maxWidth="800px">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16 }}>
        <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ padding: 8 }}>
          <ArrowLeft size={24} />
        </button>
        <div className="search-bar" style={{ flex: 1 }}>
          <SearchIcon size={20} color="rgba(255,255,255,0.45)" />
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); void handleSearch(e.target.value); }}
            placeholder={isOfflineMode ? 'Rechercher (cache gratuit)...' : 'Rechercher...'}
            autoFocus
          />
        </div>
      </div>

        {dataNotice && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', marginBottom: 8, borderRadius: 14, backgroundColor: 'rgba(120,0,0,0.08)', border: '1px solid rgba(120,0,0,0.2)' }}>
            <CloudOff size={18} color="var(--color-accent)" />
            <p style={{ flex: 1, color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: '18px', margin: 0 }}>{dataNotice}</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
        ) : searchQuery.trim() ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {results.artists.length > 0 && (
              <div>
                <h3 style={{ color: '#fff', fontSize: 20, fontFamily: "var(--font-hanken)", fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 16px' }}>Artistes</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  {results.artists.map((artist) => (
                    <ArtistCard key={artist.id} artist={artist} onPress={() => navigate(`/artist/${artist.id}`)} />
                  ))}
                </div>
              </div>
            )}
            {results.albums.length > 0 && (
              <div>
                <h3 style={{ color: '#fff', fontSize: 20, fontFamily: "var(--font-hanken)", fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 16px' }}>Albums</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {results.albums.map((album) => (
                    <AlbumCard key={album.id} album={album} onPress={() => navigate(`/album/${album.id}`)} />
                  ))}
                </div>
              </div>
            )}
            {results.tracks.length > 0 && (
              <div>
                <h3 style={{ color: '#fff', fontSize: 20, fontFamily: "var(--font-hanken)", fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 16px' }}>Titres</h3>
                {results.tracks.map((track) => (
                  <TrackListItem key={track.id} track={track} isPlaying={currentTrack?.id === track.id && isPlaying} onPress={() => { void playFromTrackList(results.tracks, albumCacheRef.current, track.id); }} />
                ))}
              </div>
            )}
            {results.artists.length === 0 && results.albums.length === 0 && results.tracks.length === 0 && (
              <p className="text-muted text-center" style={{ marginTop: 40 }}>Aucun résultat trouvé</p>
            )}
          </div>
        ) : (
          <p className="text-muted text-center" style={{ marginTop: 40 }}>
            {isOfflineMode ? 'Recherchez parmi le catalogue gratuit en cache' : 'Entrez un terme de recherche pour trouver des artistes, albums ou titres'}
          </p>
        )}
    </Screen>
  );
}
