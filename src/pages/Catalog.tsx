import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { AlbumCard } from '@/components/AlbumCard';
import { Screen } from '@/components/Screen';
import { StorageQuotaBar } from '@/components/StorageQuotaBar';
import { useDebounce } from '@/hooks/useDebounce';
import { fuzzyMatch } from '@/utils/fuzzySearch';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { listAlbums } from '@/services/api';
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
  const debouncedQuery = useDebounce(query, 250);
  const [displayCount, setDisplayCount] = useState(15);
  const BATCH_SIZE = 15;
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Cache localStorage pour éviter de re-télécharger le catalogue ──
  const CACHE_KEY = 'passio_catalog_v1';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  function readCache(): AlbumWithOffline[] | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { cachedAt: string; albums: AlbumWithOffline[] };
      if (!Array.isArray(parsed.albums)) return null;
      const age = Date.now() - new Date(parsed.cachedAt).getTime();
      if (age > CACHE_TTL) return null;
      return parsed.albums;
    } catch { return null; }
  }

  function writeCache(albums: AlbumWithOffline[]): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        cachedAt: new Date().toISOString(),
        albums,
      }));
    } catch { /* QuotaExceededError — ignore */ }
  }

  // Reset infinite scroll when search changes
  useEffect(() => { setDisplayCount(15); }, [debouncedQuery]);

  const loadAlbums = useCallback(async () => {
    setError(null);
    try {
      // Lancer la récupération du vault UNE SEULE FOIS, réutilisée partout
      const vaultPromise = listVaultAlbums().catch(() => [] as PublicAlbumSummary[]);

      if (isOfflineMode) {
        // Hors-ligne : uniquement les albums dans le vault, pas de cache
        const vaultAlbums = await vaultPromise;
        setAlbums(vaultAlbums.map(a => ({ ...a, isOffline: true })));
        setLoading(false);
        return;
      }

      // 1. Afficher le cache IMMÉDIATEMENT + attendre le vault en parallèle
      const cached = readCache();
      const vaultAlbums = await vaultPromise;
      const vaultIds = new Set(vaultAlbums.map(a => a.id));

      if (cached) {
        // Fusionner avec le statut offline frais
        const merged = cached.map(a => ({ ...a, isOffline: vaultIds.has(a.id) }));
        setAlbums(merged);
        setLoading(false);
      }

      // 2. Toujours rafraîchir depuis le réseau en arrière-plan
      //    (stale-while-revalidate : l'utilisateur voit le cache INSTANTANÉMENT)
      try {
        const freshAlbums = await listAlbums();
        const processed = freshAlbums.map(album => ({
          ...album,
          isOffline: vaultIds.has(album.id),
        }));
        setAlbums(processed);
        writeCache(processed);
      } catch (networkErr) {
        if (!cached) {
          setError(networkErr instanceof Error ? networkErr.message : 'Erreur réseau');
        }
      }
    } catch (loadError) {
      // Échec de listVaultAlbums (rare) + pas de cache non plus
      const cached = readCache();
      if (cached) {
        setAlbums(cached);
      } else {
        setError(loadError instanceof Error ? loadError.message : 'Erreur inconnue');
      }
    } finally { setLoading(false); }
  }, [isOfflineMode]);

  useEffect(() => { void loadAlbums(); }, [loadAlbums]);

  const filteredAlbums = useMemo(() => {
    const search = debouncedQuery.trim();
    if (!search) return albums;
    return albums.filter((album) =>
      fuzzyMatch(search, album.title || '') ||
      fuzzyMatch(search, album.artist_name || '') ||
      fuzzyMatch(search, album.artist?.name || ''),
    );
  }, [albums, debouncedQuery]);

  // Infinite scroll IntersectionObserver (placed after filteredAlbums declaration)
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setDisplayCount((prev) =>
            Math.min(prev + BATCH_SIZE, filteredAlbums.length),
          );
        }
      },
      { rootMargin: '400px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredAlbums.length]);

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

      {/* Storage quota */}
      <StorageQuotaBar onRefresh={() => void loadAlbums()} />

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
          {filteredAlbums.slice(0, displayCount).map((album, index) => (
            <div
              key={album.id}
              style={{
                animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
                animationDelay: `${(index % 5) * 0.06}s`,
              }}
            >
              <AlbumCard
                album={album}
                variant="tile"
                isOffline={album.isOffline}
                onPress={() => navigate(`/album/${album.id}`)}
                disableDataSaver
              />
            </div>
          ))}
          {/* Infinite scroll sentinel + loader */}
          {displayCount < filteredAlbums.length && (
            <div
              ref={sentinelRef}
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '24px 0',
                gap: 12,
              }}
            >
              <div style={{
                width: 20,
                height: 20,
                border: '2px solid var(--color-border-subtle)',
                borderTopColor: 'var(--color-accent)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 500 }}>
                Chargement…
              </span>
            </div>
          )}
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
