import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { Screen } from '@/components/Screen';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { listOwnedAlbums } from '@/services/api';
import { listVaultAlbums } from '@/services/downloadManager';
import type { PublicAlbumSummary } from '@/types/backend';

type AlbumWithOffline = PublicAlbumSummary & { isOffline: boolean };

export function CatalogScreen() {
  const navigate = useNavigate();
  const { effectiveMode } = useLibraryMode();
  const isOfflineMode = effectiveMode === 'offline';
  const [albums, setAlbums] = useState<AlbumWithOffline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const loadAlbums = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let ownedAlbums: PublicAlbumSummary[] = [];
      if (!isOfflineMode) {
        try {
          ownedAlbums = await listOwnedAlbums();
        } catch (e) {
          // If network error, ignore and just show offline
        }
      }

      const vaultAlbums = await listVaultAlbums();
      const offlineIds = new Set(vaultAlbums.map(a => a.id));

      if (isOfflineMode) {
        const processedAlbums = vaultAlbums.map(a => ({ ...a, isOffline: true }));
        setAlbums(processedAlbums);
      } else {
        const processedAlbums = ownedAlbums.map(album => ({ ...album, isOffline: offlineIds.has(album.id) }));
        const allAlbums = [...processedAlbums];
        vaultAlbums.forEach(va => {
           if (!allAlbums.some(a => a.id === va.id)) {
               allAlbums.push({ ...va, isOffline: true });
           }
        });
        setAlbums(allAlbums);
      }
    } catch (loadError) {
      setAlbums([]);
      setError(loadError instanceof Error ? loadError.message : 'Erreur réseau inconnue');
    } finally { setLoading(false); }
  }, [isOfflineMode]);

  useEffect(() => { void loadAlbums(); }, [loadAlbums]);

  const filteredAlbums = useMemo(() => {
    const search = query.trim().toLowerCase();
    return albums.filter((album) => {
      const title = String(album.title || '').toLowerCase();
      const artist = String(album.artist_name || album.artist?.name || '').toLowerCase();
      return !search || title.includes(search) || artist.includes(search);
    });
  }, [albums, query]);

  return (
    <Screen padded>
      {/* Header with red accent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8 }}>
        <div style={{ width: 4, height: 28, borderRadius: 2, background: 'var(--color-accent-gradient)', flexShrink: 0 }} />
        <div>
          <h1 style={{ color: 'var(--color-text-primary)', fontSize: 'clamp(28px, 3.5vw, 32px)', fontWeight: 700, letterSpacing: '-0.5px', margin: 0, lineHeight: 1.15 }}>
            {isOfflineMode ? 'Bibliothèque' : 'Bibliothèque'}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 15, margin: '2px 0 0', maxWidth: 600 }}>
            {isOfflineMode ? 'Votre musique téléchargée' : 'Vos albums et vos téléchargements'}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="search-bar" style={{ marginBottom: 24 }}>
        <Search size={18} color="var(--color-text-muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer par titre ou artiste"
        />
      </div>

      {loading ? (
        <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p className="text-error">{error}</p>
          <button onClick={() => void loadAlbums()} className="btn-secondary" style={{ marginTop: 12 }}>
            Réessayer
          </button>
        </div>
      ) : filteredAlbums.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
            gap: 16,
          }}
        >
          {filteredAlbums.map((album) => (
            <AlbumCard
              key={album.id}
              album={album}
              variant="tile"
              isOffline={album.isOffline}
              onPress={() => navigate(`/album/${album.id}`)}
            />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ color: 'var(--color-text-muted)' }}>
            {query.trim() ? 'Aucun album ne correspond à cette recherche.' : 'Aucun album activé pour le moment.'}
          </p>
        </div>
      )}
    </Screen>
  );
}
