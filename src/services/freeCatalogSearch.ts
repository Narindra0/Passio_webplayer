import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';
import type { TrackWithAlbum } from '@/components/TrackListItem';
import { freeCatalogDetailsMap, readFreeCatalogCache, type FreeCatalogCache } from '@/services/freeCatalogCache';
import { isAlbumReadyOffline } from '@/services/downloadManager';

export function mapTracksFromAlbum(album: PublicAlbumSummary, albumDetails: PublicAlbumDetails): TrackWithAlbum[] {
  return albumDetails.tracks.map((track) => ({
    id: track.id,
    album_id: album.id,
    title: track.title,
    artist_name: album.artist_name || album.artist?.name || 'Artiste inconnu',
    album_title: album.title,
    duration: track.duration,
    position: track.position,
    preview_url: track.preview_url,
    encrypted_audio_url: track.encrypted_audio_url,
    stream_url: track.stream_url,
    is_encrypted: track.is_encrypted,
    lyrics_url: track.lyrics_url,
    has_lyrics: track.has_lyrics,
    cover_url: album.cover_url,
  }));
}

export function buildArtistsFromAlbums(albums: PublicAlbumSummary[]) {
  const artistsMap = new Map<string, { id: string; name: string; profile_picture_url?: string | null; fallback_image_url?: string | null }>();
  albums.forEach((album) => {
    if (album.artist && album.status === 'published') {
      const artistId = album.artist.id || album.artist_name || album.id;
      if (!artistsMap.has(artistId)) {
        artistsMap.set(artistId, {
          id: artistId,
          name: album.artist.name || album.artist_name || 'Artiste inconnu',
          profile_picture_url: album.artist.profile_picture_url || album.artist_pdp,
          fallback_image_url: album.cover_url,
        });
      }
    }
  });
  return Array.from(artistsMap.values());
}

export function filterArtistAlbumsFromCache(cache: FreeCatalogCache, artistId: string): PublicAlbumSummary[] {
  return cache.albums.filter((album) => album.artist?.id === artistId || album.artist_name === artistId || album.id === artistId);
}

export function buildTracksFromCache(albums: PublicAlbumSummary[], detailsMap: Map<string, PublicAlbumDetails>): TrackWithAlbum[] {
  const tracks = albums.flatMap((album) => {
    const details = detailsMap.get(album.id);
    return details ? mapTracksFromAlbum(album, details) : [];
  });
  tracks.sort((a, b) => a.title.localeCompare(b.title));
  return tracks;
}

export type FreeCatalogSearchResults = {
  tracks: TrackWithAlbum[];
  albums: PublicAlbumSummary[];
  artists: { id: string; name: string; profile_picture_url?: string | null; fallback_image_url?: string | null }[];
  detailsMap: Map<string, PublicAlbumDetails>;
};

export async function searchFreeCatalogCache(query: string): Promise<FreeCatalogSearchResults | null> {
  const cache = await readFreeCatalogCache();
  if (!cache) return null;

  const offlineAlbums: PublicAlbumSummary[] = [];
  for (const album of cache.albums) {
    const ready = await isAlbumReadyOffline(album.id);
    if (ready) offlineAlbums.push(album);
  }

  const queryLower = query.trim().toLowerCase();
  if (!queryLower) return { tracks: [], albums: [], artists: [], detailsMap: freeCatalogDetailsMap(cache) };

  const detailsMap = freeCatalogDetailsMap(cache);
  const filteredAlbums = offlineAlbums.filter((album) => album.title?.toLowerCase().includes(queryLower) || album.artist_name?.toLowerCase().includes(queryLower));
  const tracks = buildTracksFromCache(filteredAlbums, detailsMap).filter((track) => track.title.toLowerCase().includes(queryLower));
  const artists = buildArtistsFromAlbums(offlineAlbums).filter((artist) => artist.name.toLowerCase().includes(queryLower));

  return { tracks, albums: filteredAlbums, artists, detailsMap };
}

export async function loadArtistFromFreeCatalogCache(artistId: string): Promise<{
  albums: PublicAlbumSummary[];
  topTracks: TrackWithAlbum[];
  detailsMap: Map<string, PublicAlbumDetails>;
  artistName: string;
  profilePicture: string | null;
} | null> {
  const cache = await readFreeCatalogCache();
  if (!cache) return null;

  const offlineAlbums: PublicAlbumSummary[] = [];
  for (const album of cache.albums) {
    const ready = await isAlbumReadyOffline(album.id);
    if (ready) offlineAlbums.push(album);
  }

  const artistAlbums = offlineAlbums.filter((album) => album.artist?.id === artistId || album.artist_name === artistId || album.id === artistId);
  if (artistAlbums.length === 0) return null;

  const detailsMap = freeCatalogDetailsMap(cache);
  const first = artistAlbums[0];
  const tracks = buildTracksFromCache(artistAlbums, detailsMap);

  return {
    albums: artistAlbums,
    topTracks: tracks.slice(0, 5),
    detailsMap,
    artistName: first.artist?.name || first.artist_name || 'Artiste inconnu',
    profilePicture: first.artist?.profile_picture_url || first.artist_pdp || first.cover_url || null,
  };
}
