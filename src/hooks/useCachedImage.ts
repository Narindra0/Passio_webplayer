/**
 * useCachedImage.ts — Hook React pour charger les images via le cache IndexedDB
 *
 * Utilisation : const imageSrc = useCachedImage(album.cover_url);
 *              <img src={imageSrc || undefined} alt={...} />
 *
 * Le hook retourne l'URL distante pendant le premier chargement,
 * puis une URL blob locale dès que l'image est en cache.
 */

import { useEffect, useRef, useState } from 'react';
import { getCachedImageUrl } from '@/services/imageCache';

/**
 * Hook qui retourne une URL d'image optimisée via le cache IndexedDB.
 *
 * @param imageUrl - L'URL distante de l'image (ou null/undefined)
 * @returns L'URL à utiliser comme src (blob URL locale ou URL distante en fallback)
 */
export function useCachedImage(
  imageUrl: string | null | undefined,
): string | null | undefined {
  const [cachedUrl, setCachedUrl] = useState<string | null | undefined>(
    imageUrl || undefined,
  );
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!imageUrl) {
      setCachedUrl(undefined);
      return;
    }

    // Annuler la requête précédente si l'URL change rapidement
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Afficher l'URL distante immédiatement pendant le chargement
    setCachedUrl(imageUrl);

    let cancelled = false;

    async function load() {
      try {
        const result = await getCachedImageUrl(imageUrl!, abortController.signal);

        // Nettoyer l'ancienne URL objet si elle existe
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const prev = cachedUrl;
        if (prev && prev !== imageUrl && prev.startsWith('blob:')) {
          URL.revokeObjectURL(prev);
          objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== prev);
        }

        if (!cancelled && result && result !== imageUrl) {
          setCachedUrl(result);
          if (result.startsWith('blob:')) {
            objectUrlsRef.current.push(result);
          }
        }
      } catch {
        if (!cancelled) {
          setCachedUrl(imageUrl); // fallback
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Nettoyer les URLs objets au démontage du composant
  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
    };
  }, []);

  return cachedUrl;
}
