import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Crown, Lock, Pause, Play, Clock } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { loadArtistFromFreeCatalogCache } from '@/services/freeCatalogSearch';
import { useCachedImage } from '@/hooks/useCachedImage';
import { isAlbumOwnedByDevice } from '@/services/albumOwnership';
import { hasFeatArtists, parseFeatArtists, normalizeArtistName } from '@/utils/featArtists';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';

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
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());

  useEffect(() => {
    if (!id) return;
    async function loadData() {
      try {
        setLoading(true);
        const allAlbums = await listAlbums();
        const artistAlbums = allAlbums.filter((a) => a.artist?.id === id || a.artist_name === id || a.id === id);
        setAlbums(artistAlbums);
        if (artistAlbums.length > 0) {
          const first = artistAlbums[0];
          setArtistName(first.artist?.name || first.artist_name || 'Artiste inconnu');
          setProfilePicture(first.artist?.profile_picture_url || first.artist_pdp || first.cover_url || null);
        }

        // Load ownership status for paid albums
        const ownership = new Map<string, boolean>();
        for (const album of artistAlbums) {
          if (!album.is_free) {
            const owned = await isAlbumOwnedByDevice(album.id);
            ownership.set(album.id, owned);
          }
        }
        setOwnedMap(ownership);

        const cache = new Map<string, PublicAlbumDetails>();
        const trackList: TrackWithAlbum[] = [];
        for (const album of artistAlbums) {
          try {
            const offline = await resolveOfflinePlayback(album.id);
            if (offline.metadata) {
              cache.set(album.id, offline.metadata);
              trackList.push(...offline.metadata.tracks.map((track) => ({
                id: track.id, album_id: album.id, title: track.title,
                artist_name: album.artist_name || album.artist?.name || 'Artiste inconnu',
                album_title: album.title, duration: track.duration, position: track.position,
                preview_url: track.preview_url, encrypted_audio_url: track.encrypted_audio_url,
                stream_url: track.stream_url, is_encrypted: track.is_encrypted,
                lyrics_url: track.lyrics_url, has_lyrics: track.has_lyrics, cover_url: album.cover_url,
              })));
              continue;
            }
            if (album.is_free) {
              const details = unwrapAlbumDetails(await getAlbum(album.id));
              cache.set(album.id, details);
              trackList.push(...details.tracks.map((track) => ({
                id: track.id, album_id: album.id, title: track.title,
                artist_name: album.artist_name || album.artist?.name || 'Artiste inconnu',
                album_title: album.title, duration: track.duration, position: track.position,
                preview_url: track.preview_url, encrypted_audio_url: track.encrypted_audio_url,
                stream_url: track.stream_url, is_encrypted: track.is_encrypted,
                lyrics_url: track.lyrics_url, has_lyrics: track.has_lyrics, cover_url: album.cover_url,
              })));
            }
          } catch { continue; }
        }
        albumCacheRef.current = cache;
        trackList.sort((a, b) => a.title.localeCompare(b.title));
        setTopTracks(trackList.slice(0, 5));
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
              color: 'var(--color-accent)',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              marginBottom: 8,
            }}>
              Artiste
            </p>
            <h1 style={{
              color: 'var(--color-text-primary)',
              fontSize: 'clamp(32px, 5vw, 56px)',
              fontWeight: 800,
              letterSpacing: '-1.5px',
              lineHeight: 1.05,
              margin: '0 0 8px',
            }}>
              {artistName}
            </h1>

            {/* Metadata */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 14, fontWeight: 500 }}>
                {priceAlbums.length > 0 && (
                  <span>{priceAlbums.length} album{priceAlbums.length > 1 ? 's' : ''} premium</span>
                )}
              </span>
              {topTracks.length > 0 && (
                <>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>·</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 14, fontWeight: 500 }}>
                    {topTracks.length} titre{topTracks.length > 1 ? 's' : ''}
                  </span>
                </>
              )}
              {totalDuration > 0 && (
                <>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>·</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
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
                    background: 'rgba(255,215,0,0.1)',
                    border: '1px solid rgba(255,215,0,0.15)',
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
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
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
                          {featResult ? featResult.cleanTitle : track.title}
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

            {/* ========== DISCOGRAPHY ========== */}
            {albums.length > 0 && (
              <div>
                <div className="section-header">
                  <h2 className="section-title">Discographie</h2>
                  <span className="section-link">
                    {priceAlbums.length > 0
                      ? `${albums.length} album${albums.length > 1 ? 's' : ''} · ${priceAlbums.length} premium`
                      : `${albums.length} album${albums.length > 1 ? 's' : ''}`
                    }
                  </span>
                </div>
                <div className="artist-discography-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                    gap: 16,
                  }}
                >
                  {albums.map((album) => {
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
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}
