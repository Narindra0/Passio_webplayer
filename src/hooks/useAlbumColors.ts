import { useEffect, useState } from 'react';
import {
  extractColorsFromImageUrl,
  buildGradientFromColors,
  buildPlayerGradient,
  type ExtractedColors,
} from '@/services/colorExtractor';

interface UseAlbumColorsResult {
  colors: ExtractedColors | null;
  loading: boolean;
  gradientStyle: string;
  playerGradient: string;
}

const pendingRequests = new Map<string, Promise<ExtractedColors | null>>();

/**
 * Extract and cache dominant colors from an album/artist image URL.
 * Multiple components requesting the same URL share the same pending request.
 */
export function useAlbumColors(imageUrl: string | null | undefined): UseAlbumColorsResult {
  const [colors, setColors] = useState<ExtractedColors | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!imageUrl) {
      setColors(null);
      setLoading(false);
      return;
    }

    const url: string = imageUrl;
    let cancelled = false;
    setLoading(true);

    async function fetch() {
      try {
        // Deduplicate concurrent requests for the same URL
        if (!pendingRequests.has(url)) {
          pendingRequests.set(url, extractColorsFromImageUrl(url));
        }

        const result = await pendingRequests.get(url)!;

        // Clean up pending request after completion
        pendingRequests.delete(url);

        if (!cancelled) {
          setColors(result);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setColors(null);
          setLoading(false);
        }
      }
    }

    void fetch();

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return {
    colors,
    loading,
    gradientStyle: buildGradientFromColors(colors),
    playerGradient: buildPlayerGradient(colors),
  };
}
