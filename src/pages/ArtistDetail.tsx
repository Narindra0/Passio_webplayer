import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Crown, Disc, Lock, Pause, Play, Clock } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { FeatTrackCard } from '@/components/FeatTrackCard';
import type { TrackWithAlbum } from '@/components/TrackListItem';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { loadArtistFromFreeCatalogCache } from '@/services/freeCatalogSearch';
import { useCachedImage } from '@/hooks/useCachedImage';
import { isAlbumOwnedByDevice } from '@/services/albumOwnership';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';
import { formatTitle } from '@/utils/formatTitle';
import { ArtistRecommendations } from '@/components/ArtistRecommendations';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';
import {
  getPrimaryTextColor,
  getSecondaryTextColor,
  getMutedTextColor,
  getBadgeBackground,
  getBadgeBorder,
} from '@/services/colorExtractor';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ArtistDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playFromTrackList, currentTrack, isPlaying } = useAudioPlayback();

  const [artistName, setArtistName] = useState('Artiste');
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [albums, setAlbums] = useState<PublicAlbumSummary[]>([]);
  const [topTracks, setTopTracks] = useState<TrackWithAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownedMap, setOwnedMap] = useState<Map<string, boolean>>(new Map());
  // Albums de collaboration (pour le sous-titre) + tracks individuelles (pour l'affichage)
  const [collabAlbums, setCollabAlbums] = useState<PublicAlbumSummary[]>([]);
  const [collaborationTracks, setCollaborationTracks] = useState<TrackWithAlbum[]>([]);
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());

  useEffect(() => {
    if (!id) return;
    async function loadData() {
      try {
        setLoading(true);
        const allAlbums = await listAlbums();

        // ── Séparer les albums de l'artiste des autres ──
        const artistAlbums = allAlbums.filter((a) => a.artist?.id === id || a.artist_name === id || a.id === id);
        setAlbums(artistAlbums);

        if (artistAlbums.length > 0) {
          const first = artistAlbums[0];
          const name = first.artist?.name || first.artist_name || 'Artiste inconnu';
          setArtistName(name);
          setProfilePicture(first.artist?.profile_picture_url || first.artist_pdp || first.cover_url || null);

          const normalizedName = normalizeArtistName(name);

          // ── Albums d'autres artistes qui pourraient contenir l'artiste en feat ──
          //    On prend TOUS les albums gratuits des autres artistes (car le champ
          //    `artists[]` n'est souvent pas renvoyé par l'API listAlbums).
          //    On charge leurs détails en parallèle pour analyser les titres de pistes.
          const otherFreeAlbums = allAlbums.filter(
            (a) => a.is_free && a.id !== id && a.artist?.id !== id && a.artist_name !== id,
          );

          // ⚡ TOUT CHARGER EN PARALLÈLE : ownership + détails albums
          const [ownership, cache] = await Promise.all([
            // 1. Vérifier la propriété des albums payants (en parallèle)
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

            // 2. Charger les détails des albums de l'artiste + albums gratuits des autres (en parallèle)
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

          // ── Construire la liste des tracks de l'artiste ──
          const trackList: TrackWithAlbum[] = [];
          for (const album of artistAlbums) {
            const details = cache.get(album.id);
            if (!details) continue;
            trackList.push(...details.tracks.map((track) => ({
              id: track.id, album_id: album.id, title: track.title,
              artist_name: album.artist_name || album.artist?.name || 'Artiste inconnu',
              album_title: album.title, duration: track.duration, position: track.position,
              preview_url: track.preview_url, encrypted_audio_url: track.encrypted_audio_url,
              stream_url: track.stream_url, is_encrypted: track.is_encrypted,
              lyrics_url: track.lyrics_url, has_lyrics: track.has_lyrics, cover_url: album.cover_url,
            })));
          }
          trackList.sort((a, b) => a.title.localeCompare(b.title));
          setTopTracks(trackList.slice(0, 5));

          // ── Détecter les collaborations ──
          //    On collecte les albums ET les tracks individuelles où l'artiste est en feat
          const foundIds = new Set<string>();
          const foundAlbums: PublicAlbumSummary[] = [];
          const foundTracks: TrackWithAlbum[] = [];
          const addAlbumIfNew = (album: PublicAlbumSummary) => {
            if (!foundIds.has(album.id)) {
              foundIds.add(album.id);
              foundAlbums.push(album);
            }
          };
          // 1. Albums où l'artiste est dans artists[] (si renseigné)
          for (const album of allAlbums) {
            if (album.artists?.some((a) => a.id === id)) addAlbumIfNew(album);
          }
          // 2. Albums gratuits : scanner les titres pour trouver les feats individuels
          for (const album of otherFreeAlbums) {
            const details = cache.get(album.id);
            if (!details?.tracks) continue;
            let hasFeatOnAlbum = false;
            for (const track of details.tracks) {
              if (hasFeatArtists(track.title)) {
                const { featNames } = parseFeatArtists(track.title);
                if (featNames.some((fn) => normalizeArtistName(fn) === normalizedName)) {
                  hasFeatOnAlbum = true;
                  // Track individuelle avec la cover de l'album source
                  foundTracks.push({
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
                  });
                }
              }
            }
            if (hasFeatOnAlbum) addAlbumIfNew(album);
          }
          setCollabAlbums(foundAlbums);
          foundTracks.sort((a, b) => (a.album_title || '').localeCompare(b.album_title || '') || a.title.localeCompare(b.title));
          setCollaborationTracks(foundTracks);
        }
      } catch {
        const fallback = await loadArtistFromFreeCatalogCache(id!);
        if (fallback) { setAlbums(fallback.albums); setArtistName(fallback.artistName); setProfilePicture(fallback.profilePicture); albumCacheRef.current = fallback.detailsMap; setTopTracks(fallback.topTracks); }
      } finally { setLoading(false); }
    }
    void loadData();
  }, [id]);

  const cachedProfile = useCachedImage(profilePicture);
  const profileColors = useAlbumColors(profilePicture);

  const tracksWithPaidFlag = useMemo(() => {
    return topTracks.map((track) => {
      const album = albums.find((a) => a.id === track.album_id);
      const isPaidAlbum = album ? !album.is_free : false;
      const isTrackOwned = album ? ownedMap.get(album.id) ?? false : false;
      return { ...track, _isPaidNotOwned: isPaidAlbum && !isTrackOwned, _canPlay: (album?.is_free ?? false) || isTrackOwned };
    });
  }, [topTracks, albums, ownedMap]);

  const handleTrackPress = (track: TrackWithAlbum) => { void playFromTrackList(topTracks, albumCacheRef.current, track.id); };

  const handleCollabTrackPress = (track: TrackWithAlbum) => {
    void playFromTrackList(collaborationTracks, albumCacheRef.current, track.id);
  };

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
        onPress={() => navigate(`/album/${album.id}`)}
      />
    );
  };

  // ── Items de la discographie : albums de l'artiste + feat tracks, triés par date ──
  //    Les feat tracks reprennent la date de l'album source pour le tri chronologique.
  type DiscographyItem =
    | { type: 'album'; data: PublicAlbumSummary }
    | { type: 'feat'; data: TrackWithAlbum; sourceDate: string };

  const discographyItems = useMemo((): DiscographyItem[] => {
    const items: DiscographyItem[] = albums.map((a) => ({ type: 'album', data: a }));
    // Indexer les albums de collaboration par ID pour récupérer leur date
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

  const canPlayAny = tracksWithPaidFlag.some((t) => t._canPlay);
  const priceAlbums = albums.filter((a) => !a.is_free && a.price_ariary > 0);

  const totalDuration = tracksWithPaidFlag.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalDurationLabel = formatDuration(totalDuration);

  // Build artist lookup map from all albums for clickable feat links
  const artistIdMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const album of albums) {
      if (album.artist?.id && album.artist?.name) {
        map[normalizeArtistName(album.artist.name)] = album.artist.id;
      }
      if (album.artists) {
        for (const a of album.artists) {
          if (a.name) map[normalizeArtistName(a.name)] = a.id;
        }
      }
    }
    return map;
  }, [albums]);

  return (
    <Screen padded={false}>
      {/* ========== HERO ========== */}
      <div className="artist-hero"
        style={{
          position: 'relative',
          minHeight: 'clamp(280px, 40vh, 400px)',
          background: profileColors.gradientStyle,
          transition: 'background 0.6s ease',
          display: 'flex',
          alignItems: 'flex-end',
          padding: '48px 32px 32px',
        }}
      >
        {/* Back button */}
        <button className="artist-back"
          onClick={() => navigate(-1)}
          style={{
            position: 'absolute',
            top: 20,
            left: 24,
            width: 36,
            height: 36,
            borderRadius: 'var(--radius-full)',
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(8px)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 2,
            color: 'var(--color-text-primary)',
            transition: 'all var(--transition-fast) ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.7)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.5)'; }}
        >
          <ChevronLeft size={22} />
        </button>

        {/* Background image */}
        {profilePicture && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            overflow: 'hidden',
            zIndex: 0,
          }}>
            <img
              src={cachedProfile || profilePicture}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.3 }}
            />
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: '70%',
              background: 'linear-gradient(transparent, #1A0505)',
            }} />
          </div>
        )}

        {/* Artist info row */}
        <div className="artist-info-row"
          style={{
            display: 'flex',
            gap: 28,
            alignItems: 'flex-end',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Circular artist image */}
          <div className="artist-avatar"
            style={{
              width: 180,
              height: 180,
              minWidth: 180,
              borderRadius: 'var(--radius-full)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-xl)',
              backgroundColor: 'var(--color-surface-elevated)',
            }}
          >
            {profilePicture ? (
              <img src={cachedProfile || profilePicture} alt={artistName} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#1a1a1a',
              }}>
                <span style={{ fontSize: 60, color: 'var(--color-text-muted)', fontWeight: 800 }}>
                  {artistName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Name + actions */}
          <div className="artist-info" style={{ paddingBottom: 8 }}>
            <p style={{
              color: getSecondaryTextColor(profileColors.colors, 'var(--color-accent)'),
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              marginBottom: 8,
            }}>
              Artiste
            </p>
            <h1 style={{
              color: getPrimaryTextColor(profileColors.colors, 'var(--color-text-primary)'),
              fontSize: 'clamp(32px, 5vw, 56px)',
              fontWeight: 800,
              letterSpacing: '-1.5px',
              lineHeight: 1.05,
              margin: '0 0 8px',
            }}>
              {artistName}
            </h1>

            {/* Metadata — dynamic colors */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <span style={{ color: getSecondaryTextColor(profileColors.colors, 'var(--color-text-secondary)'), fontSize: 14, fontWeight: 500 }}>
                {priceAlbums.length > 0 && (
                  <span>{priceAlbums.length} album{priceAlbums.length > 1 ? 's' : ''} premium</span>
                )}
              </span>
              {topTracks.length > 0 && (
                <>
                  <span style={{ color: getMutedTextColor(profileColors.colors, 'var(--color-text-muted)'), fontSize: 12 }}>·</span>
                  <span style={{ color: getSecondaryTextColor(profileColors.colors, 'var(--color-text-secondary)'), fontSize: 14, fontWeight: 500 }}>
                    {topTracks.length} titre{topTracks.length > 1 ? 's' : ''}
                  </span>
                </>
              )}
              {totalDuration > 0 && (
                <>
                  <span style={{ color: getMutedTextColor(profileColors.colors, 'var(--color-text-muted)'), fontSize: 12 }}>·</span>
                  <span style={{ color: getSecondaryTextColor(profileColors.colors, 'var(--color-text-secondary)'), fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {totalDurationLabel}
                  </span>
                </>
              )}
            </div>

            {/* Action buttons */}
            {!loading && tracksWithPaidFlag.length > 0 && (
              <div className="artist-cta-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => handleTrackPress(topTracks[0])}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 24px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--color-accent)',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    transition: 'all var(--transition-fast) ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.background = 'var(--color-accent-light)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'var(--color-accent)'; }}
                >
                  <Play size={18} fill="#fff" />
                  {canPlayAny ? 'Tout écouter' : 'Découvrir'}
                </button>

                {priceAlbums.length > 0 && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 14px',
                    borderRadius: 'var(--radius-full)',
                    background: getBadgeBackground(profileColors.colors, profileColors.colors?.isDark ?? true, true),
                    border: `1px solid ${getBadgeBorder(profileColors.colors, profileColors.colors?.isDark ?? true, true)}`,
                    color: '#FFD700',
                    fontSize: 12,
                    fontWeight: 700,
                  }}>
                    <Crown size={12} />
                    {priceAlbums.length} premium
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========== CONTENT ========== */}
      <div className="artist-content" style={{ padding: 'var(--page-padding)', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {loading ? (
          <div className="artist-skeleton" style={{ padding: 'var(--page-padding)', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
            {/* Section header skeleton */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
            }}>
              <div className="skeleton" style={{ width: 160, height: 22, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: 100, height: 14, borderRadius: 4 }} />
            </div>

            {/* Track list header skeleton */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '0 16px 12px',
              borderBottom: '1px solid var(--color-border-subtle)',
              marginBottom: 6,
            }}>
              <div className="skeleton" style={{ width: 28, height: 12, borderRadius: 4 }} />
              <div className="skeleton" style={{ flex: 1, height: 12, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: 48, height: 12, borderRadius: 4 }} />
            </div>

            {/* Track row skeletons */}
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '10px 16px',
              }}>
                <div className="skeleton" style={{ width: 28, height: 14, borderRadius: 4 }} />
                <div style={{ flex: '0 0 50%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="skeleton" style={{ width: '65%', height: 15, borderRadius: 4 }} />
                  <div className="skeleton" style={{ width: '40%', height: 12, borderRadius: 4 }} />
                </div>
                <div style={{ flex: 1 }} />
                <div className="skeleton" style={{ width: 36, height: 12, borderRadius: 4 }} />
              </div>
            ))}

            {/* Divider */}
            <div style={{ height: 32 }} />

            {/* Discography section header skeleton */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
            }}>
              <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 'var(--radius-full)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div className="skeleton" style={{ width: 140, height: 20, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: 100, height: 12, borderRadius: 4 }} />
              </div>
            </div>

            {/* Albums grid skeleton */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: 16,
            }}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '16px' }}>
                  <div className="skeleton" style={{ width: 120, height: 120, borderRadius: 'var(--radius-sm)' }} />
                  <div className="skeleton" style={{ width: '90%', height: 14, borderRadius: 4 }} />
                  <div className="skeleton" style={{ width: '60%', height: 12, borderRadius: 4 }} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* ========== TOP TRACKS ========== */}
            {topTracks.length > 0 && (
              <div>
                <div className="section-header">
                  <h2 className="section-title">Titres populaires</h2>
                  <span className="section-link">{topTracks.length} titre{topTracks.length > 1 ? 's' : ''}</span>
                </div>

                {/* Track list header */}
                <div className="artist-track-header"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '0 16px 12px',
                    borderBottom: '1px solid var(--color-border-subtle)',
                    marginBottom: 6,
                  }}
                >
                  <span style={{ width: 28, color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>#</span>
                  <span style={{ flex: 1, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                    Titre
                  </span>
                  <span style={{ width: 48, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <Clock size={14} />
                  </span>
                </div>

                {/* Track rows */}
                {tracksWithPaidFlag.map((track, index) => {
                  const isCurrent = currentTrack?.id === track.id;
                  const isThisPlaying = isCurrent && isPlaying;
                  const featResult = hasFeatArtists(track.title) ? parseFeatArtists(track.title) : null;
                  return (
                    <button
                      key={track.id}
                      onClick={() => handleTrackPress(track)}
                      disabled={!track._canPlay && !track._isPaidNotOwned}
                      className="artist-track"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        padding: '10px 16px',
                        width: '100%',
                        background: isCurrent ? 'var(--color-accent-soft)' : 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        cursor: track._canPlay || track._isPaidNotOwned ? 'pointer' : 'default',
                        textAlign: 'left',
                        opacity: !track._canPlay && !track._isPaidNotOwned ? 0.5 : 1,
                        transition: 'background-color var(--transition-fast) ease, padding var(--transition-fast) ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrent && (track._canPlay || track._isPaidNotOwned)) e.currentTarget.style.background = 'var(--color-surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrent) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {/* Number or equalizer */}
                      <div style={{ width: 28, textAlign: 'center', flexShrink: 0 }}>
                        {isThisPlaying ? (
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16, justifyContent: 'center' }}>
                            <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                            <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                            <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                            <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
                          </div>
                        ) : isCurrent ? (
                          <Play size={14} color="var(--color-accent)" />
                        ) : (
                          <span style={{
                            color: 'var(--color-text-muted)',
                            fontSize: 13,
                            fontWeight: 500,
                            fontVariantNumeric: 'tabular-nums',
                          }}>
                            {index + 1}
                          </span>
                        )}
                      </div>

                      {/* Track info */}
                      <div style={{ flex: '0 0 50%', minWidth: 0 }}>
                        <p style={{
                          color: isCurrent ? 'var(--color-accent)' : 'var(--color-text-primary)',
                          fontSize: 15,
                          fontWeight: 600,
                          lineHeight: '22px',
                          margin: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {formatTitle(featResult ? featResult.cleanTitle : track.title)}
                          {featResult && featResult.featNames.length > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)' }}>
                              {' '}(feat.{' '}
                              {featResult.featNames.map((name, i) => {
                                const isLast = i === featResult.featNames.length - 1;
                                const featId = artistIdMap[normalizeArtistName(name)];
                                return (
                                  <span key={name}>
                                    {featId ? (
                                      <span
                                        onClick={(e) => { e.stopPropagation(); navigate(`/artist/${featId}`); }}
                                        style={{ color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600, transition: 'opacity 0.15s ease' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.textDecoration = 'underline'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.textDecoration = 'none'; }}
                                      >
                                        {name}
                                      </span>
                                    ) : (
                                      <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>{name}</span>
                                    )}
                                    {!isLast && <span style={{ color: 'var(--color-text-muted)' }}>, </span>}
                                  </span>
                                );
                              })}
                              )
                            </span>
                          )}
                        </p>
                        <p style={{
                          color: isCurrent ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                          fontSize: 12,
                          lineHeight: '16px',
                          margin: '2px 0 0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {track.album_title || artistName}
                        </p>
                      </div>

                      {/* Duration + status */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        {track._isPaidNotOwned ? (
                          <Lock size={13} color="var(--color-text-muted)" style={{ opacity: 0.5 }} />
                        ) : isThisPlaying ? (
                          <Pause size={14} color="var(--color-accent)" />
                        ) : isCurrent ? (
                          <Play size={14} color="var(--color-accent)" />
                        ) : null}
                        {track.duration != null && track.duration > 0 && (
                          <span style={{
                            color: 'var(--color-text-muted)',
                            fontSize: 12,
                            fontWeight: 500,
                            fontVariantNumeric: 'tabular-nums',
                            minWidth: 36,
                            textAlign: 'right',
                          }}>
                            {formatDuration(track.duration)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ========== EMPTY STATE ========== */}
            {topTracks.length === 0 && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                borderRadius: 'var(--radius-sm)',
                padding: 14,
                background: 'var(--color-surface-elevated)',
              }}>
                <Lock size={16} color="var(--color-text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, lineHeight: '20px', margin: 0 }}>
                  Les titres de cet artiste sont disponibles à l'achat. Découvrez ses albums ci-dessous.
                </p>
              </div>
            )}

            {/* ========== DISCOGRAPHIE (albums + feat tracks individuels) ========== */}
            {discographyItems.length > 0 && (
              <div className="artist-discography">
                <div className="section-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-accent-gradient)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Disc size={16} color="#fff" />
                    </div>
                    <div>
                      <h2 className="section-title" style={{ margin: 0 }}>Discographie</h2>
                      <p style={{
                        color: 'var(--color-text-muted)',
                        fontSize: 13,
                        margin: '2px 0 0',
                        fontWeight: 500,
                      }}>
                        {albums.length} album{albums.length > 1 ? 's' : ''}
                        {collaborationTracks.length > 0 && ` · ${collaborationTracks.length} feat.`}
                        {priceAlbums.length > 0 && ` · ${priceAlbums.length} premium`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="artist-discography-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                    gap: 16,
                  }}
                >
                  {discographyItems.map((item) => {
                    if (item.type === 'album') {
                      return renderAlbumCard(item.data);
                    }
                    // type === 'feat'
                    const track = item.data;
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
                  })}
                </div>
              </div>
            )}

            {/* ========== ARTISTES SIMILAIRES ========== */}
            {id && (
              <div style={{ marginTop: 8 }}>
                <ArtistRecommendations
                  sectionTitle="Artistes similaires"
                  maxArtists={10}
                  discoveryCount={0}
                  sourceArtistId={id}
                  hideViewAll={true}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}
