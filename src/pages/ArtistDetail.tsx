import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Lock, User } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { TrackListItem, type TrackWithAlbum } from '@/components/TrackListItem';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { Screen } from '@/components/Screen';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { loadArtistFromFreeCatalogCache } from '@/services/freeCatalogSearch';
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

  const handleTrackPress = (track: TrackWithAlbum) => { void playFromTrackList(topTracks, albumCacheRef.current, track.id); };

  return (
    <Screen padded={false}>
      {/* Hero Header */}
      <div style={{ position: 'relative', minHeight: 'clamp(250px, 40vh, 400px)', overflow: 'hidden', background: 'linear-gradient(180deg, #780000, #3A0000, var(--color-bg-dark))' }}>
        {profilePicture ? (
          <img src={profilePicture} alt={artistName} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5, position: 'absolute', top: 0, left: 0 }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: 0, left: 0, backgroundColor: '#1a1a1a' }}>
            <User size={80} color="rgba(255,255,255,0.2)" />
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', background: 'linear-gradient(transparent, rgba(0,0,0,0.6), var(--color-bg-dark))' }} />
        
        <button 
          onClick={() => navigate(-1)} 
          style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <ArrowLeft size={24} color="#fff" />
        </button>

        <div style={{ position: 'absolute', bottom: 24, left: 'var(--page-padding, 24px)', right: 'var(--page-padding, 24px)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
          <h1 style={{ color: '#fff', fontSize: 'clamp(32px, 5vw, 48px)', fontFamily: 'var(--font-hanken)', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-1px', textShadow: '0 4px 10px rgba(0,0,0,0.75)', margin: 0, flex: 1 }}>
            {artistName}
          </h1>
          {!loading && topTracks.length > 0 && (
            <button 
              onClick={() => handleTrackPress(topTracks[0])} 
              style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: '#780000', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 6px 20px rgba(120,0,0,0.5)', flexShrink: 0 }}
            >
              <Play size={24} color="#fff" style={{ marginLeft: 3 }} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 'var(--page-padding)', maxWidth: 800, margin: '0 auto', width: '100%' }}>
        {loading ? (
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {topTracks.length > 0 && (
              <div>
                <h2 style={{ color: '#fff', fontSize: 22, fontFamily: 'var(--font-hanken)', fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 16px' }}>Titres populaires</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {topTracks.map((track, index) => (
                    <div key={track.id} style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ width: 24, color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: 600, textAlign: 'center', flexShrink: 0 }}>{index + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <TrackListItem track={track} isPlaying={currentTrack?.id === track.id && isPlaying} onPress={() => handleTrackPress(track)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {topTracks.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(120,0,0,0.1)', border: '1px solid rgba(120,0,0,0.25)', borderRadius: 12, padding: 14 }}>
                <Lock size={18} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: '20px', margin: 0 }}>
                  Les titres de cet artiste sont disponibles à l'achat. Découvrez ses albums ci-dessous.
                </p>
              </div>
            )}

            {albums.length > 0 && (
              <div>
                <h2 style={{ color: '#fff', fontSize: 22, fontFamily: 'var(--font-hanken)', fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 16px' }}>Discographie</h2>
                <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}>
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
