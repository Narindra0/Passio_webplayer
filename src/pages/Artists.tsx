import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft } from 'lucide-react';
import { ArtistCard } from '@/components/ArtistCard';
import { ArtistRecommendations } from '@/components/ArtistRecommendations';
import { Screen } from '@/components/Screen';
import { listAlbums } from '@/services/api';
import { isAlbumReadyOffline } from '@/services/downloadManager';
import { readFreeCatalogCache } from '@/services/freeCatalogCache';
import { buildArtistsFromAlbums } from '@/services/freeCatalogSearch';
import { getArtistPlayCount } from '@/services/listeningHistory';
import type { PublicAlbumSummary } from '@/types/backend';

export function ArtistsScreen() {
  const navigate = useNavigate();

  const [artists, setArtists] = useState<{ id: string; name: string; profile_picture_url?: string | null; fallback_image_url?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const albums = await listAlbums();
      const allArtists = buildArtistsFromAlbums(albums);
      allArtists.sort((a, b) => a.name.localeCompare(b.name));
      setArtists(allArtists);
    } catch {
      // Try offline cache as fallback
      try {
        const cached = await readFreeCatalogCache();
        if (cached) {
          const offlineAlbums: PublicAlbumSummary[] = [];
          for (const album of cached.albums) {
            if (await isAlbumReadyOffline(album.id)) offlineAlbums.push(album);
          }
          const allArtists = buildArtistsFromAlbums(offlineAlbums);
          allArtists.sort((a, b) => a.name.localeCompare(b.name));
          setArtists(allArtists);
        } else {
          setError('Impossible de charger la liste des artistes.');
        }
      } catch {
        setError('Impossible de charger la liste des artistes.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <Screen gradient padded>
      {/* Header with back button and title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 8 }}>
        <button
          onClick={() => navigate(-1)}
          className="btn-ghost"
          style={{ padding: 8, borderRadius: 'var(--radius-full)', flexShrink: 0 }}
        >
          <ChevronLeft size={22} />
        </button>
        <div style={{ width: 4, height: 28, borderRadius: 2, background: 'var(--color-accent-gradient)', flexShrink: 0 }} />
        <h1 style={{
          color: 'var(--color-text-primary)',
          fontSize: 'clamp(28px, 3.5vw, 32px)',
          fontWeight: 700,
          letterSpacing: '-0.5px',
          margin: 0,
          lineHeight: 1.15,
        }}>
          Artistes
        </h1>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => navigate('/search')}
          className="btn-ghost"
          style={{ padding: 8, borderRadius: 'var(--radius-full)' }}
        >
          <Search size={20} />
        </button>
      </div>

      {/* Subtitle */}
      <p style={{
        color: 'var(--color-text-secondary)',
        fontSize: 15,
        margin: '8px 0 24px',
        lineHeight: 1.5,
      }}>
        {artists.length > 0
          ? `${artists.length} artiste${artists.length > 1 ? 's' : ''}`
          : 'Parcourez tous les artistes disponibles'}
      </p>

      {/* Loading State */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 12px' }}>
              <div className="skeleton" style={{ width: 100, height: 100, borderRadius: 'var(--radius-full)' }} />
              <div className="skeleton" style={{ width: '75%', height: 14, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: '60px 20px',
          textAlign: 'center',
        }}>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 15, margin: 0 }}>{error}</p>
          <button onClick={() => void loadData()} className="btn-secondary">
            Réessayer
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && artists.length === 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '60px 20px',
          textAlign: 'center',
        }}>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 15, margin: 0 }}>
            Aucun artiste disponible pour le moment.
          </p>
        </div>
      )}

      {/* Artist Recommendations (basé sur l'historique d'écoute) */}
      {!loading && !error && (
        <div style={{ marginBottom: 40 }}>
          <ArtistRecommendations
            maxArtists={8}
            discoveryCount={2}
            hideViewAll={true}
          />
        </div>
      )}

      {/* Artists Grid */}
      {!loading && !error && artists.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 6,
            animation: 'fadeIn 0.4s ease',
          }}
        >
          {artists.map((artist) => {
            const playCount = getArtistPlayCount(artist.id);
            return (
              <div key={artist.id} style={{ position: 'relative' }}>
                <ArtistCard
                  artist={artist}
                  onPress={() => navigate(`/artist/${artist.id}`)}
                />
                {playCount > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    background: playCount >= 5
                      ? 'linear-gradient(135deg, #FF6B6B, #DC143C)'
                      : 'rgba(255,255,255,0.06)',
                    border: playCount >= 5
                      ? '1px solid rgba(255,107,107,0.3)'
                      : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 'var(--radius-full)',
                    padding: '2px 7px',
                    fontSize: 10,
                    fontWeight: 800,
                    color: playCount >= 5 ? '#fff' : 'var(--color-text-muted)',
                    lineHeight: '16px',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    zIndex: 2,
                    opacity: 0.85,
                  }}>
                    <span style={{ fontSize: 8 }}>▶</span>
                    {playCount}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
