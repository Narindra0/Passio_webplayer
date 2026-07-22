import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search as SearchIcon, CloudOff } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { ArtistCard } from '@/components/ArtistCard';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { searchFreeCatalogCache } from '@/services/freeCatalogSearch';
import { readFreeCatalogCache, freeCatalogDetailsMap } from '@/services/freeCatalogCache';
import { useDebounce } from '@/hooks/useDebounce';
import { fuzzyMatch } from '@/utils/fuzzySearch';
import { isValidProfilePicture } from '@/utils/imageUtils';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';

// ── Cache localStorage pour la liste d'albums ──
const ALBUM_LIST_CACHE_KEY = 'passio_album_list_v1';
const ALBUM_LIST_TTL = 5 * 60 * 1000; // 5 minutes

interface AlbumListCache {
  cachedAt: string;
  albums: PublicAlbumSummary[];
}

function readAlbumListCache(): PublicAlbumSummary[] | null {
  try {
    const raw = localStorage.getItem(ALBUM_LIST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AlbumListCache;
    if (!Array.isArray(parsed.albums)) return null;
    const age = Date.now() - new Date(parsed.cachedAt).getTime();
    if (age > ALBUM_LIST_TTL) return null;
    return parsed.albums;
  } catch { return null; }
}

function writeAlbumListCache(albums: PublicAlbumSummary[]): void {
  try {
    localStorage.setItem(ALBUM_LIST_CACHE_KEY, JSON.stringify({
      cachedAt: new Date().toISOString(),
      albums,
    }));
  } catch { /* QuotaExceededError — ignore */ }
}

// ── Résultats typés ──
type SearchResults = {
  tracks: TrackWithAlbum[];
  albums: PublicAlbumSummary[];
  artists: { id: string; name: string; profile_picture_url?: string | null }[];
};

const EMPTY_RESULTS: SearchResults = { tracks: [], albums: [], artists: [] };

export function SearchScreen() {
  const navigate = useNavigate();
  const { effectiveMode } = useLibraryMode();
  const { playFromTrackList, currentTrack, isPlaying } = useAudioPlayback();
  const isOfflineMode = effectiveMode === 'offline';

  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebounce(rawQuery, 200); // 200ms pour un bon équilibre
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [dataNotice, setDataNotice] = useState<string | null>(null);

  // Refs pour le contrôle des requêtes
  const abortRef = useRef<AbortController | null>(null);
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());

  // ── Recherche déclenchée par le changement du debouncedQuery ──
  useEffect(() => {
    const query = debouncedQuery.trim();
    if (!query) {
      setResults(EMPTY_RESULTS);
      setDataNotice(null);
      setLoading(false);
      return;
    }

    // Annuler la requête précédente si encore en cours
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const abortController = new AbortController();
    abortRef.current = abortController;

    setLoading(true);
    setDataNotice(null);

    void performSearch(query, abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [debouncedQuery, isOfflineMode]);

  async function performSearch(query: string, signal: AbortSignal) {
    // ── Mode hors-ligne : recherche dans le cache gratuit ──
    if (isOfflineMode) {
      const cached = await searchFreeCatalogCache(query);
      if (signal.aborted) return;
      if (cached) {
        albumCacheRef.current = cached.detailsMap;
        setResults({
          tracks: cached.tracks,
          albums: cached.albums,
          artists: cached.artists,
        });
        setDataNotice('Recherche limitée au catalogue gratuit en cache.');
      } else {
        setResults(EMPTY_RESULTS);
        setDataNotice('Aucun catalogue gratuit en cache.');
      }
      setLoading(false);
      return;
    }

    try {
      // 1. Essayer le cache local d'abord (stale-while-revalidate)
      const cachedAlbums = readAlbumListCache();
      let albums: PublicAlbumSummary[];

      if (cachedAlbums) {
        albums = cachedAlbums;
        // Rafraîchir en arrière-plan
        listAlbums()
          .then((fresh) => {
            if (!signal.aborted) {
              writeAlbumListCache(fresh);
            }
          })
          .catch(() => { /* silencieux */ });
      } else {
        // Pas de cache → attendre le réseau
        albums = await listAlbums();
        if (signal.aborted) return;
        writeAlbumListCache(albums);
      }

      // 2. Essayer le cache du catalogue gratuit (déjà chargé)
      const freeCache = await readFreeCatalogCache();
      const freeDetailsMap = freeCache ? freeCatalogDetailsMap(freeCache) : null;

      // 3. Filtrer les albums (recherche floue)
      const filteredAlbums = albums.filter(
        (a) =>
          fuzzyMatch(query, a.title || '') ||
          fuzzyMatch(query, a.artist_name || '') ||
          fuzzyMatch(query, a.artist?.name || ''),
      );

      // 4. Récupérer les détails des albums en PARALLÈLE avec Promise.allSettled
      //    On utilise d'abord le cache gratuit si disponible, puis on complète via le réseau
      const detailsPromises = filteredAlbums.map(async (album) => {
        if (signal.aborted) return null;

        // Vérifier le cache gratuit d'abord
        if (freeDetailsMap?.has(album.id)) {
          const details = freeDetailsMap.get(album.id)!;
          albumCacheRef.current.set(album.id, details);
          return { album, details };
        }

        // Sinon, appel réseau
        try {
          const raw = await getAlbum(album.id);
          if (signal.aborted) return null;
          const details = unwrapAlbumDetails(raw);
          albumCacheRef.current.set(album.id, details);
          return { album, details };
        } catch {
          return null;
        }
      });

      const settledResults = await Promise.allSettled(detailsPromises);
      if (signal.aborted) return;

      // 5. Construire les pistes et artistes
      const tracks: TrackWithAlbum[] = [];
      for (const result of settledResults) {
        if (result.status === 'fulfilled' && result.value) {
          const { album, details } = result.value;
          const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';
          tracks.push(
            ...details.tracks.map((track) => ({
              ...track,
              artist_name: artistName,
              album_title: album.title,
            })),
          );
        }
      }

      const filteredTracks = tracks.filter((t) =>
        fuzzyMatch(query, t.title),
      );

      // Artistes (parcours limité aux albums filtrés)
      const artistsMap = new Map<
        string,
        { id: string; name: string; profile_picture_url?: string | null }
      >();
      filteredAlbums.forEach((album) => {
        if (album.artist && album.status === 'published') {
          const artistId = album.artist.id || album.artist_name || album.id;
          if (!artistsMap.has(artistId)) {
            artistsMap.set(artistId, {
              id: artistId,
              name: album.artist.name || album.artist_name || 'Artiste inconnu',
              profile_picture_url: isValidProfilePicture(album.artist.profile_picture_url) ? album.artist.profile_picture_url : album.artist_pdp,
            });
          }
        }
      });
      const filteredArtists = Array.from(artistsMap.values()).filter((a) =>
        fuzzyMatch(query, a.name),
      );

      setResults({
        tracks: filteredTracks,
        albums: filteredAlbums,
        artists: filteredArtists,
      });
    } catch {
      if (signal.aborted) return;

      // Fallback : essayer le cache gratuit
      const cached = await searchFreeCatalogCache(query);
      if (signal.aborted) return;
      if (cached) {
        albumCacheRef.current = cached.detailsMap;
        setResults({
          tracks: cached.tracks,
          albums: cached.albums,
          artists: cached.artists,
        });
        setDataNotice('Réseau indisponible. Résultats du cache.');
      } else {
        setResults(EMPTY_RESULTS);
        setDataNotice('Recherche impossible.');
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }

  // ── Navigation clavier ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setRawQuery('');
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <Screen gradient padded maxWidth="800px">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16 }}>
        <button onClick={() => navigate(-1)} className="btn-ghost" style={{ padding: 8 }}>
          <ArrowLeft size={24} />
        </button>
        <div className="search-bar" style={{ flex: 1, maxWidth: '100%' }}>
          <SearchIcon size={20} color="rgba(255,255,255,0.45)" />
          <input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isOfflineMode ? 'Rechercher (cache gratuit)...' : 'Rechercher par titre, artiste, album…'}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          {rawQuery && (
            <button
              onClick={() => setRawQuery('')}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '50%',
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                transition: 'all var(--transition-fast)',
              }}
              aria-label="Effacer la recherche"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Notice d'information */}
      {dataNotice && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            marginBottom: 8,
            borderRadius: 14,
            backgroundColor: 'rgba(120,0,0,0.08)',
            border: '1px solid rgba(120,0,0,0.2)',
            animation: 'slideDown 0.2s ease',
          }}
        >
          <CloudOff size={18} color="var(--color-accent)" />
          <p
            style={{
              flex: 1,
              color: 'rgba(255,255,255,0.75)',
              fontSize: 13,
              lineHeight: '18px',
              margin: 0,
            }}
          >
            {dataNotice}
          </p>
        </div>
      )}

      {/* Contenu */}
      {loading && rawQuery.trim() ? (
        <div className="flex justify-center p-10">
          <div className="loader-spinner" />
        </div>
      ) : debouncedQuery.trim() ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {/* Artistes */}
          {results.artists.length > 0 && (
            <div>
              <h3
                style={{
                  color: '#fff',
                  fontSize: 20,
                  fontFamily: 'var(--font-hanken)',
                  fontWeight: 700,
                  letterSpacing: '-0.5px',
                  margin: '0 0 16px',
                }}
              >
                Artistes
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                {results.artists.map((artist) => (
                  <ArtistCard
                    key={artist.id}
                    artist={artist}
                    onPress={() => navigate(`/artist/${artist.id}`)}
                    disableDataSaver
                  />
                ))}
              </div>
            </div>
          )}

          {/* Albums */}
          {results.albums.length > 0 && (
            <div>
              <h3
                style={{
                  color: '#fff',
                  fontSize: 20,
                  fontFamily: 'var(--font-hanken)',
                  fontWeight: 700,
                  letterSpacing: '-0.5px',
                  margin: '0 0 16px',
                }}
              >
                Albums
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {results.albums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    onPress={() => navigate(`/album/${album.id}`)}
                    disableDataSaver
                  />
                ))}
              </div>
            </div>
          )}

          {/* Titres */}
          {results.tracks.length > 0 && (
            <div>
              <h3
                style={{
                  color: '#fff',
                  fontSize: 20,
                  fontFamily: 'var(--font-hanken)',
                  fontWeight: 700,
                  letterSpacing: '-0.5px',
                  margin: '0 0 16px',
                }}
              >
                Titres
              </h3>
              {results.tracks.map((track) => (
                <TrackListItem
                  key={track.id}
                  track={track}
                  isPlaying={currentTrack?.id === track.id && isPlaying}
                  onPress={() => {
                    void playFromTrackList(results.tracks, albumCacheRef.current, track.id);
                  }}
                />
              ))}
            </div>
          )}

          {/* Aucun résultat */}
          {results.artists.length === 0 &&
            results.albums.length === 0 &&
            results.tracks.length === 0 && (
              <p className="text-muted text-center" style={{ marginTop: 40 }}>
                Aucun résultat pour « {debouncedQuery} »
              </p>
            )}
        </div>
      ) : (
        <p className="text-muted text-center" style={{ marginTop: 40 }}>
          {isOfflineMode
            ? 'Recherchez parmi le catalogue gratuit en cache'
            : 'Entrez un terme de recherche pour trouver des artistes, albums ou titres'}
        </p>
      )}
    </Screen>
  );
}
