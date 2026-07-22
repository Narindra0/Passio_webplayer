import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Disc } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { FeatTrackCard } from '@/components/FeatTrackCard';
import type { TrackWithAlbum } from '@/components/TrackListItem';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { loadArtistFromFreeCatalogCache } from '@/services/freeCatalogSearch';
import { useCachedImage } from '@/hooks/useCachedImage';
import { getOptimizedImageUrl, isValidProfilePicture } from '@/utils/imageUtils';
import { isAlbumOwnedByDevice } from '@/services/albumOwnership';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';
import { getCachedArtistData } from '@/services/artistDataCache';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';

// ── Helper : détermine le sous-type d'un album (album/single/ep) ──
function getAlbumSubtype(summary: PublicAlbumSummary): 'album' | 'single' | 'ep' {
  const t = summary.type;
  if (t === 'single') return 'single';
  if (t === 'ep') return 'ep';
  return 'album';
}

// ── Helper : label affiché pour le type de release ──
function getReleaseTypeLabel(summary: PublicAlbumSummary): string | undefined {
  const t = summary.type;
  if (t === 'single') return 'Single';
  if (t === 'ep') return 'EP';
  return undefined; // default album → pas de label
}

type DiscographyFilter = 'all' | 'album' | 'single' | 'ep' | 'feat' | 'premium';

type DiscographyItem =
  | { type: 'album'; data: PublicAlbumSummary }
  | { type: 'feat'; data: TrackWithAlbum; sourceDate: string };

export function ArtistDiscographyScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playFromTrackList, currentTrack, isPlaying } = useAudioPlayback();

  const [artistName, setArtistName] = useState('Artiste');
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [albums, setAlbums] = useState<PublicAlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownedMap, setOwnedMap] = useState<Map<string, boolean>>(new Map());
  const [collabAlbums, setCollabAlbums] = useState<PublicAlbumSummary[]>([]);
  const [collaborationTracks, setCollaborationTracks] = useState<TrackWithAlbum[]>([]);
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());
  const [discographyFilter, setDiscographyFilter] = useState<DiscographyFilter>('all');

  // ── Chargement des données (identique à ArtistDetail) ──
  useEffect(() => {
    const artistId = id;
    if (!artistId) return;

    // ⚡ Cache check : instant si déjà chargé depuis ArtistDetail
    const cached = getCachedArtistData(artistId);
    if (cached) {
      setArtistName(cached.artistName);
      setProfilePicture(cached.profilePicture);
      setAlbums(cached.albums);
      setOwnedMap(cached.ownedMap);
      setCollabAlbums(cached.collabAlbums);
      setCollaborationTracks(cached.collaborationTracks);
      albumCacheRef.current = cached.albumCache;
      setLoading(false);
      return;
    }

    async function loadData() {
      try {
        setLoading(true);
        const allAlbums = await listAlbums();

        const artistAlbums = allAlbums.filter((a) => a.artist?.id === artistId || a.artist_name === artistId || a.id === artistId);
        setAlbums(artistAlbums);

        if (artistAlbums.length > 0) {
          const first = artistAlbums[0];
          const name = first.artist?.name || first.artist_name || 'Artiste inconnu';
          setArtistName(name);
          setProfilePicture(
            (isValidProfilePicture(first.artist?.profile_picture_url) ? first.artist?.profile_picture_url : null) ||
            (isValidProfilePicture(first.artist_pdp) ? first.artist_pdp : null) ||
            first.cover_url ||
            null
          );

          const normalizedName = normalizeArtistName(name);

          const otherFreeAlbums = allAlbums.filter(
            (a) => a.is_free && a.id !== artistId && a.artist?.id !== artistId && a.artist_name !== artistId,
          );

          const [ownership, cache] = await Promise.all([
            (async () => {
              const map = new Map<string, boolean>();
              const paidAlbums = artistAlbums.filter((a) => !a.is_free);
              if (paidAlbums.length > 0) {
                await Promise.all(paidAlbums.map(async (a) => {
                  try { map.set(a.id, await isAlbumOwnedByDevice(a.id)); }
                  catch { map.set(a.id, false); }
                }));
              }
              return map;
            })(),
            (async () => {
              const c = new Map<string, PublicAlbumDetails>();
              const albumsToLoad = [...artistAlbums, ...otherFreeAlbums];
              await Promise.all(albumsToLoad.map(async (album) => {
                try {
                  const offline = await resolveOfflinePlayback(album.id);
                  if (offline.metadata) {
                    c.set(album.id, offline.metadata);
                    return;
                  }
                  if (album.is_free) {
                    c.set(album.id, unwrapAlbumDetails(await getAlbum(album.id)));
                  }
                } catch { /* skip */ }
              }));
              return c;
            })(),
          ]);

          setOwnedMap(ownership);
          albumCacheRef.current = cache;

          // ── Détecter les collaborations ──
          const foundIds = new Set<string>();
          const foundAlbums: PublicAlbumSummary[] = [];
          const foundTracks: TrackWithAlbum[] = [];
          const addAlbumIfNew = (album: PublicAlbumSummary) => {
            if (!foundIds.has(album.id)) {
              foundIds.add(album.id);
              foundAlbums.push(album);
            }
          };
          for (const album of allAlbums) {
            if (album.artists?.some((a) => a.id === artistId)) addAlbumIfNew(album);
          }
          for (const album of otherFreeAlbums) {
            const details = cache.get(album.id);
            if (!details?.tracks) continue;
            let hasFeatOnAlbum = false;
            for (const track of details.tracks) {
              if (hasFeatArtists(track.title)) {
                const { featNames } = parseFeatArtists(track.title);
                if (featNames.some((fn) => normalizeArtistName(fn) === normalizedName)) {
                  hasFeatOnAlbum = true;
                  foundTracks.push({
                    id: track.id, album_id: album.id, title: track.title,
                    artist_name: album.artist_name || album.artist?.name || 'Artiste inconnu',
                    album_title: album.title, duration: track.duration, position: track.position,
                    preview_url: track.preview_url, encrypted_audio_url: track.encrypted_audio_url,
                    stream_url: track.stream_url, is_encrypted: track.is_encrypted,
                    lyrics_url: track.lyrics_url, has_lyrics: track.has_lyrics, cover_url: album.cover_url,
                  });
                }
              }
            }
            if (hasFeatOnAlbum) addAlbumIfNew(album);
          }
          setCollabAlbums(foundAlbums);
          foundTracks.sort((a, b) => (a.album_title || '').localeCompare(b.album_title || '') || a.title.localeCompare(b.title));
          setCollaborationTracks(foundTracks);

          // Note : le cache est géré par ArtistDetail (seul writer)
        }
      } catch {
        const fallback = await loadArtistFromFreeCatalogCache(id!);
        if (fallback) { setAlbums(fallback.albums); setArtistName(fallback.artistName); setProfilePicture(fallback.profilePicture); albumCacheRef.current = fallback.detailsMap; }
      } finally { setLoading(false); }
    }
    void loadData();
  }, [id]);

  const cachedProfile = useCachedImage(profilePicture);

  // ── Items de la discographie ──
  const discographyItems = useMemo((): DiscographyItem[] => {
    const items: DiscographyItem[] = albums.map((a) => ({ type: 'album', data: a }));
    const collabDateMap = new Map<string, string>();
    for (const ca of collabAlbums) {
      if (ca.created_at) collabDateMap.set(ca.id, ca.created_at);
    }
    for (const ft of collaborationTracks) {
      const sourceDate = collabDateMap.get(ft.album_id) || new Date().toISOString();
      items.push({ type: 'feat', data: ft, sourceDate });
    }
    return items.sort((a, b) => {
      const da = a.type === 'album'
        ? (a.data.created_at ? new Date(a.data.created_at).getTime() : 0)
        : new Date(a.sourceDate).getTime();
      const db = b.type === 'album'
        ? (b.data.created_at ? new Date(b.data.created_at).getTime() : 0)
        : new Date(b.sourceDate).getTime();
      return db - da;
    });
  }, [albums, collabAlbums, collaborationTracks]);

  // ── Compteurs par type ──
  const filterCounts = useMemo(() => {
    let albumCount = 0, singleCount = 0, epCount = 0;
    for (const item of discographyItems) {
      if (item.type === 'feat') continue;
      const subtype = getAlbumSubtype(item.data);
      if (subtype === 'single') singleCount++;
      else if (subtype === 'ep') epCount++;
      else albumCount++;
    }
    const featCount = discographyItems.filter(i => i.type === 'feat').length;
    const premiumCount = discographyItems.filter(i => i.type === 'album' && !(i.data as PublicAlbumSummary).is_free).length;
    return { all: discographyItems.length, album: albumCount, single: singleCount, ep: epCount, feat: featCount, premium: premiumCount };
  }, [discographyItems]);

  // ── Items filtrés ──
  const filteredDiscography = useMemo((): DiscographyItem[] => {
    switch (discographyFilter) {
      case 'album': case 'single': case 'ep':
        return discographyItems.filter(i => i.type === 'album' && getAlbumSubtype(i.data) === discographyFilter);
      case 'feat':
        return discographyItems.filter(i => i.type === 'feat');
      case 'premium':
        return discographyItems.filter(i => i.type === 'album' && !(i.data as PublicAlbumSummary).is_free);
      default:
        return discographyItems;
    }
  }, [discographyItems, discographyFilter]);

  // ── Sous-titre dynamique ──
  const discographySubtitle = useMemo(() => {
    const c = filterCounts;
    const parts: string[] = [];
    if (discographyFilter === 'all' || discographyFilter === 'album') {
      if (c.album > 0) parts.push(`${c.album} album${c.album > 1 ? 's' : ''}`);
    }
    if (discographyFilter === 'all' || discographyFilter === 'single') {
      if (c.single > 0) parts.push(`${c.single} single${c.single > 1 ? 's' : ''}`);
    }
    if (discographyFilter === 'all' || discographyFilter === 'ep') {
      if (c.ep > 0) parts.push(`${c.ep} EP${c.ep > 1 ? 's' : ''}`);
    }
    if (discographyFilter === 'all' || discographyFilter === 'feat') {
      if (c.feat > 0) parts.push(`${c.feat} feat.`);
    }
    if ((discographyFilter === 'all' || discographyFilter === 'premium') && c.premium > 0) {
      parts.push(`${c.premium} premium`);
    }
    return parts.join(' · ');
  }, [filterCounts, discographyFilter]);

  // ── Composé des filtres ──
  const filterDefs: { key: DiscographyFilter; label: string }[] = [
    { key: 'all', label: 'Tout' },
  ];
  if (filterCounts.album > 0) filterDefs.push({ key: 'album', label: 'Albums' });
  if (filterCounts.single > 0) filterDefs.push({ key: 'single', label: 'Singles' });
  if (filterCounts.ep > 0) filterDefs.push({ key: 'ep', label: 'EPs' });
  if (filterCounts.feat > 0) filterDefs.push({ key: 'feat', label: 'Feats' });
  if (filterCounts.premium > 0) filterDefs.push({ key: 'premium', label: 'Premium' });

  // ── Rendu d'une carte album ──
  const renderAlbumCard = (album: PublicAlbumSummary) => {
    const isPaid = !album.is_free;
    const isOwned = ownedMap.get(album.id) ?? false;
    const premiumLabel = isPaid
      ? isOwned
        ? '✓ Possédé'
        : album.price_ariary > 0
          ? `${album.price_ariary.toLocaleString()} Ar`
          : 'Premium'
      : undefined;
    return (
      <AlbumCard
        key={album.id}
        album={album}
        variant="tile"
        premiumLabel={premiumLabel}
        releaseTypeLabel={getReleaseTypeLabel(album)}
        disableDataSaver={true}
        onPress={() => navigate(`/album/${album.id}`)}
      />
    );
  };

  // ── Rendu d'une carte feat ──
  const renderFeatCard = (track: TrackWithAlbum) => {
    const isCurrent = currentTrack?.id === track.id;
    return (
      <FeatTrackCard
        key={`feat-${track.id}`}
        track={track}
        isPlaying={isPlaying}
        isCurrent={isCurrent}
        sourceArtistName={track.artist_name}
        onPress={() => handleCollabTrackPress(track)}
      />
    );
  };

  const handleCollabTrackPress = (track: TrackWithAlbum) => {
    void playFromTrackList(collaborationTracks, albumCacheRef.current, track.id);
  };

  return (
    <Screen padded={false}>
      {/* ========== HEADER ========== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-dark)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--color-text-primary)',
            transition: 'all var(--transition-fast) ease',
            flexShrink: 0,
          }}
        >
          <ChevronLeft size={20} />
        </button>

        {profilePicture && (
          <div
            style={{
              width: 36,
              height: 36,
              minWidth: 36,
              borderRadius: 'var(--radius-full)',
              overflow: 'hidden',
              backgroundColor: 'var(--color-surface-elevated)',
            }}
          >
            <img
              src={getOptimizedImageUrl(cachedProfile || profilePicture)}
              alt={artistName}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {artistName}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--color-text-muted)',
              fontWeight: 500,
            }}
          >
            {discographySubtitle || 'Discographie'}
          </p>
        </div>
      </div>

      {/* ========== FILTERS ========== */}
      {discographyItems.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            padding: '8px 16px',
            borderBottom: '1px solid var(--color-border-subtle)',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            backgroundColor: 'var(--color-bg-dark)',
          }}
        >
          {filterDefs.map(({ key, label }) => {
            const count = filterCounts[key];
            const active = discographyFilter === key;
            if (count === 0) return null;
            return (
              <button
                key={key}
                onClick={() => setDiscographyFilter(key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  background: active
                    ? 'var(--color-accent)'
                    : 'var(--color-surface-elevated)',
                  color: active ? '#fff' : 'var(--color-text-secondary)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all var(--transition-fast) ease',
                  flexShrink: 0,
                }}
              >
                {label}
                <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 600 }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ========== CONTENT ========== */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px var(--page-padding)' }}>
        {loading ? (
          /* ── Skeleton loading ── */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: 12,
            }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="skeleton" style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-md)' }} />
                <div className="skeleton" style={{ width: '80%', height: 14, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: '60%', height: 11, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        ) : filteredDiscography.length === 0 ? (
          /* ── Empty state ── */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              textAlign: 'center',
            }}
          >
            <Disc size={48} color="var(--color-text-muted)" style={{ opacity: 0.3, marginBottom: 16 }} />
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>
              Aucun résultat
            </p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: 0 }}>
              Aucune release ne correspond à ce filtre.
            </p>
          </div>
        ) : (
          /* ── Grille responsive ── */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: 12,
            }}
          >
            {filteredDiscography.map((item) => {
              if (item.type === 'album') {
                return (
                  <div key={item.data.id}>
                    {renderAlbumCard(item.data)}
                  </div>
                );
              }
              return renderFeatCard(item.data);
            })}
          </div>
        )}
      </div>
    </Screen>
  );
}
