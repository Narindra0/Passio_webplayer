import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { Screen, PageHeader } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
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
      <PageHeader 
        title={isOfflineMode ? 'Ma Musique Hors-ligne' : 'Mes albums'}
        subtitle="Rechercher dans votre collection"
        style={{ paddingTop: 'var(--header-padding)' }}
      />
      
      <div className="search-bar" style={{ marginBottom: 24, maxWidth: 480 }}>
        <Search size={20} color="rgba(255,255,255,0.45)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un titre ou un artiste"
        />
      </div>
          {loading ? (
            <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <p className="text-error">{error}</p>
              <button onClick={() => void loadAlbums()} className="btn btn-secondary" style={{ marginTop: 12 }}>Réessayer</button>
            </div>
          ) : filteredAlbums.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between' }}>
              {filteredAlbums.map((album) => (
                <AlbumCard key={album.id} album={album} variant="tile" isOffline={album.isOffline} onPress={() => navigate(`/album/${album.id}`)} />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <p className="text-muted">{query.trim() ? 'Aucun album ne correspond à cette recherche.' : 'Aucun album activé pour le moment.'}</p>
            </div>
          )}
    </Screen>
  );
}
