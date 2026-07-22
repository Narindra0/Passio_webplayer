import React, { useState } from 'react';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useNetworkQuality } from '@/hooks/useNetworkQuality';
import { getOptimizedImageUrl, isValidProfilePicture } from '@/utils/imageUtils';

export interface Artist {
  id: string;
  name: string;
  profile_picture_url?: string | null;
  slug?: string;
  fallback_image_url?: string | null;
}

type ArtistCardProps = {
  artist: Artist;
  onPress: () => void;
  /**
   * Si true, désactive le mode data-saver pour cette carte.
   */
  disableDataSaver?: boolean;
};

export const ArtistCard = React.memo(function ArtistCard({ artist, onPress, disableDataSaver = false }: ArtistCardProps) {
  const networkQuality = useNetworkQuality();
  const isDataSaver = disableDataSaver ? false : networkQuality === 'slow';

  // ⚡ Gestion des erreurs d'image : si la photo de profil ne charge pas
  //    (URL cassée / image inexistante), on bascule sur la cover de fallback.
  const [isFallback, setIsFallback] = useState(false);
  const [imgError, setImgError] = useState(false);
  const primaryUrl = isDataSaver ? null : (isValidProfilePicture(artist.profile_picture_url) ? artist.profile_picture_url : artist.fallback_image_url);
  // Si l'image primaire a échoué, tenter le fallback direct (cover_url)
  const effectiveUrl = isFallback ? artist.fallback_image_url : primaryUrl;
  const cachedImage = useCachedImage(effectiveUrl);

  // Montrer l'image seulement si on a une URL ET qu'elle n'a pas définitivement échoué
  const showImage = !!effectiveUrl && !imgError;

  const handleImageError = () => {
    if (!isFallback && artist.fallback_image_url && artist.fallback_image_url !== artist.profile_picture_url) {
      // 1er échec : essayer la cover de fallback
      setIsFallback(true);
    } else {
      // 2e échec (ou pas de fallback) : afficher l'initiale
      setImgError(true);
    }
  };

  return (
    <button
      onClick={onPress}
      className="group"
      style={{
        width: '100%',
        maxWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '16px 12px 14px',
        borderRadius: 'var(--radius-md)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        transition: 'background-color var(--transition-fast) ease, transform 0.2s ease',
        flexShrink: 0,
        margin: '0 auto',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Circular Artist Image */}
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          backgroundColor: 'var(--color-surface-elevated)',
          boxShadow: 'var(--shadow-md)',
          position: 'relative',
        }}
      >
        {showImage ? (
          <img
            src={getOptimizedImageUrl(cachedImage || effectiveUrl)}
            alt={artist.name}
            loading="lazy"
            decoding="async"
            onError={handleImageError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: 'transform var(--transition-normal) ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            background: 'var(--color-surface-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 40, fontWeight: 800 }}>
              {artist.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Artist Name */}
      <div style={{ width: '100%', textAlign: 'center' }}>
        <span style={{
          color: 'var(--color-text-primary)',
          fontSize: 14,
          fontWeight: 600,
          lineHeight: '18px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {artist.name}
        </span>
      </div>
    </button>
  );
});
