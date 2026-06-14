/**
 * ArtistLookupContext.tsx — Contexte global pour la recherche d'artistes par nom.
 * 
 * Construit un dictionnaire nom → ID d'artiste à partir :
 * 1. Du cache du catalogue gratuit (IndexedDB, rapide)
 * 2. Des albums possédés chargés depuis l'API
 * 
 * Utile pour rendre les artistes "feat." cliquables.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { readFreeCatalogCache } from '@/services/freeCatalogCache';
import { listAlbums, listOwnedAlbums } from '@/services/api';
import type { PublicAlbumSummary } from '@/types/backend';

interface ArtistLookupValue {
  /** Retourne l'ID d'un artiste à partir de son nom, ou null si inconnu */
  getArtistId: (name: string) => string | null;
  /** true si les données sont chargées (permet de savoir si la recherche est fiable) */
  isLoaded: boolean;
}

const ArtistLookupContext = createContext<ArtistLookupValue>({
  getArtistId: () => null,
  isLoaded: false,
});

/**
 * Construit un Map nom → ID à partir des albums.
 *
 * Stratégie de recherche (par ordre de priorité) :
 * 1. album.artist.name + album.artist.id  (objet artiste imbriqué)
 * 2. album.artist_name + album.artist_id   (champs plats — plus fiables)
 * 3. album.artists[]                        (tableau d'artistes, souvent utilisé pour les feat)
 */
function buildNameToIdMap(albums: PublicAlbumSummary[]): Map<string, string> {
  const map = new Map<string, string>();

  const tryAdd = (name: string, id: string) => {
    if (!name || !id) return;
    const key = name.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, id);
    }
  };

  for (const album of albums) {
    // 1. Combiner les sources : nom = artist_name (plat) OU artist.name (imbriqué)
    //    id  = artist_id (REQUIRED) OU artist.id (imbriqué)
    //    artist_name est OPTIONNEL et artist.id est OPTIONNEL, donc on fusionne
    const name = album.artist_name || album.artist?.name;
    const id = album.artist_id || album.artist?.id;
    if (name && id) {
      tryAdd(name, id);
    }

    // 2. Tableau artists[] (feat artists déjà côté serveur)
    if (album.artists) {
      for (const a of album.artists) {
        if (a.id && a.name) {
          tryAdd(a.name, a.id);
        }
      }
    }
  }
  return map;
}

export function ArtistLookupProvider({ children }: { children: ReactNode }) {
  const [nameToIdMap, setNameToIdMap] = useState<Map<string, string>>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    let cancelled = false;

    async function load() {
      const combinedMap = new Map<string, string>();

      // 1. Charger le cache du catalogue gratuit (IndexedDB — rapide)
      try {
        const cache = await readFreeCatalogCache();
        if (cache?.albums) {
          const freeMap = buildNameToIdMap(cache.albums);
          for (const [name, id] of freeMap) {
            combinedMap.set(name, id);
          }
          console.log('[ArtistLookup] Cache gratuit:', freeMap.size, 'artistes trouvés');
        } else {
          console.log('[ArtistLookup] Cache gratuit vide');
        }
      } catch (err) {
        console.error('[ArtistLookup] Erreur cache gratuit:', err);
      }

      // 2. Charger les albums possédés (API)
      try {
        const owned = await listOwnedAlbums();
        const ownedMap = buildNameToIdMap(owned);
        for (const [name, id] of ownedMap) {
          combinedMap.set(name, id);
        }
        console.log('[ArtistLookup] Albums possédés:', ownedMap.size, 'artistes');
      } catch (err) {
        console.warn('[ArtistLookup] API listOwnedAlbums a échoué:', err);
      }

      // 3. Charger TOUS les albums (API) — couvre les artistes feat premium / inconnus
      try {
        const allAlbums = await listAlbums();
        const allMap = buildNameToIdMap(allAlbums);
        for (const [name, id] of allMap) {
          combinedMap.set(name, id);
        }
        console.log('[ArtistLookup] Tous les albums:', allMap.size, 'artistes');
      } catch (err) {
        console.warn('[ArtistLookup] API listAlbums a échoué:', err);
      }

      if (!cancelled) {
        console.log('[ArtistLookup] Map finale:', combinedMap.size, 'artistes — ex: Balz →', combinedMap.get('balz'));
        setNameToIdMap(combinedMap);
        setIsLoaded(true);
      }
    }

    void load();

    return () => { cancelled = true; };
  }, []);

  const getArtistId = useCallback(
    (name: string): string | null => {
      if (!name) return null;
      return nameToIdMap.get(name.trim().toLowerCase()) ?? null;
    },
    [nameToIdMap],
  );

  const value = useMemo(() => ({ getArtistId, isLoaded }), [getArtistId, isLoaded]);

  return (
    <ArtistLookupContext.Provider value={value}>
      {children}
    </ArtistLookupContext.Provider>
  );
}

export function useArtistNameLookup(): ArtistLookupValue {
  return useContext(ArtistLookupContext);
}
