import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Lock, User } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { loadArtistFromFreeCatalogCache } from '@/services/freeCatalogSearch';
import { useCachedImage } from '@/hooks/useCachedImage';
import type { PublicAlbumDetails, PublicAlbumSummary } from '@/types/backend';

export function ArtistDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playFromTrackList, currentTrack, isPlaying } = useAudioPlayback();

  const [artistName, setArtistName] = useState('Artiste');
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [albums, setAlbums] = useState<PublicAlbumSummary[]>([]);
  const [topTracks, setTopTracks] = useState<TrackWithAlbum[]>([]);
  const [loading, setLoading] = useState(true);
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

  const handleTrackPress = (track: TrackWithAlbum) => { void playFromTrackList(topTracks, albumCacheRef.current, track.id); };

  return (
    <Screen padded={false}>
      {/* Hero — Spotify-style gradient header with dynamic color */}
      <div style={{
        position: 'relative',
        minHeight: 'clamp(280px, 40vh, 400px)',
        background: profileColors.gradientStyle,
        transition: 'background 0.6s ease',
        display: 'flex',
        alignItems: 'flex-end',
        padding: '48px 32px 32px',
      }}>
        {/* Back button */}
        <button
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
          <ArrowLeft size={22} />
        </button>

        {/* The background image */}
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
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: 0.3,
              }}
            />
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: '70%',
              background: 'linear-gradient(transparent, #1A0505)',
            }} />
          </div>
        )}

        {/* Artist info */}
        <div style={{
          display: 'flex',
          gap: 28,
          alignItems: 'flex-end',
          position: 'relative',
          zIndex: 1,
        }}>
          {/* Circular artist image */}
          <div style={{
            width: 180,
            height: 180,
            minWidth: 180,
            borderRadius: 'var(--radius-full)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-xl)',
            backgroundColor: 'var(--color-surface-elevated)',
          }}>
            {profilePicture ? (
              <img src={cachedProfile || profilePicture} alt={artistName} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#1a1a1a',
              }}>
                <User size={60} color="var(--color-text-muted)" />
              </div>
            )}
          </div>

          <div style={{ paddingBottom: 8 }}>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
              Artiste
            </p>
            <h1 style={{
              color: 'var(--color-text-primary)',
              fontSize: 'clamp(32px, 5vw, 48px)',
              fontWeight: 800,
              letterSpacing: '-1px',
              lineHeight: 1.1,
              margin: '0 0 16px',
            }}>
              {artistName}
            </h1>

            {/* Play button */}
            {!loading && topTracks.length > 0 && (
              <button
                onClick={() => handleTrackPress(topTracks[0])}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-accent)',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = 'var(--color-accent-light)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'var(--color-accent)'; }}
              >
                <Play size={24} color="#fff" style={{ marginLeft: 2 }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 'var(--page-padding)', maxWidth: 800, margin: '0 auto', width: '100%' }}>
        {loading ? (
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* Top tracks */}
            {topTracks.length > 0 && (
              <div>
                <div className="section-header">
                  <h2 className="section-title">Titres populaires</h2>
                </div>
                <div>
                  {topTracks.map((track, index) => (
                    <div key={track.id} style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{
                        width: 24, color: 'var(--color-text-muted)',
                        fontSize: 14, fontWeight: 600, textAlign: 'center', flexShrink: 0,
                      }}>
                        {index + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <TrackListItem track={track} isPlaying={currentTrack?.id === track.id && isPlaying} onPress={() => handleTrackPress(track)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
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

            {/* Discography — horizontal scroll like Spotify */}
            {albums.length > 0 && (
              <div>
                <div className="section-header">
                  <h2 className="section-title">Discographie</h2>
                  <span className="section-link">{albums.length} album{albums.length > 1 ? 's' : ''}</span>
                </div>
                <div style={{
                  display: 'flex',
                  gap: 16,
                  overflowX: 'auto',
                  paddingBottom: 8,
                  scrollbarWidth: 'none',
                }}>
                  {albums.map((album) => (
                    <AlbumCard key={album.id} album={album} onPress={() => navigate(`/album/${album.id}`)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}
