import React from 'react';
import type { Album } from '@/types/album';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useNetworkQuality } from '@/hooks/useNetworkQuality';
import { Download, Play } from 'lucide-react';
import { formatTitle } from '@/utils/formatTitle';
import { getOptimizedImageUrl, handleImageError } from '@/utils/imageUtils';

type AlbumCardProps = {
  album: Album;
  variant?: 'row' | 'tile';
  onPress?: () => void;
  isOffline?: boolean;
  premiumLabel?: string;
  releaseTypeLabel?: string;
  /**
   * Si true, désactive le mode data-saver pour cette carte.
   * Utile dans les sections discographie où on veut toujours afficher les covers.
   */
  disableDataSaver?: boolean;
};

export const AlbumCard = React.memo(function AlbumCard({ album, variant = 'row', onPress, isOffline = false, premiumLabel, releaseTypeLabel, disableDataSaver = false }: AlbumCardProps) {
  const networkQuality = useNetworkQuality();
  const isDataSaver = disableDataSaver ? false : networkQuality === 'slow';
  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';
  const cachedCover = useCachedImage(isDataSaver ? null : album.cover_url);

  if (variant === 'tile') {
    return (
      <button
        className="group"
        onClick={onPress}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'transparent',
          borderRadius: 'var(--radius-md)',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transition: 'none',
          border: 'none',
        }}
      >
        {/* Album Cover with Play Button Overlay */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            backgroundColor: 'var(--color-surface-elevated)',
            boxShadow: 'var(--shadow-md)',
            transition: 'box-shadow var(--transition-normal) ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(220,20,60,0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
        >
          {isDataSaver || !album.cover_url ? (
            // ⚡ Data saver ou pas de cover : icône placeholdere
            <div
              style={{
                width: '100%',
                height: '100%',
                background: 'var(--color-surface-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 40, color: 'var(--color-text-muted)' }}>♪</span>
            </div>
          ) : (
            <img
              src={getOptimizedImageUrl(cachedCover || album.cover_url)}
              onError={handleImageError}
              alt={album.title}
              loading="lazy"
              decoding="async"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transition: 'transform var(--transition-normal) ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            />
          )}

          {/* Play Button Overlay */}
          <div
            style={{
              position: 'absolute',
              bottom: 6,
              right: 6,
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              transition: 'all var(--transition-fast) ease',
              opacity: 0,
              transform: 'translateY(8px)',
            }}
            className="group-hover:opacity-100 group-hover:translate-y-0"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-accent-light)';
              e.currentTarget.style.transform = 'scale(1.04)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--color-accent)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Play size={18} color="#fff" style={{ marginLeft: 2 }} />
          </div>

          {/* Offline Indicator */}
          {isOffline && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'rgba(0,0,0,0.7)',
                padding: '4px 8px',
                borderRadius: 'var(--radius-full)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                backdropFilter: 'blur(8px)',
              }}
            >
              <Download size={12} color="var(--color-success)" />
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-success)' }}>
                Hors-ligne
              </span>
            </div>
          )}
        </div>          {/* Album Info — compact */}
        <div style={{ padding: '2px 4px', minHeight: 40 }}>
          <div
            style={{
              color: 'var(--color-text-primary)',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: '16px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginBottom: 2,
            }}
          >
            {formatTitle(album.title)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            {releaseTypeLabel && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '1px 5px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(220,20,60,0.08)',
                border: '1px solid rgba(220,20,60,0.15)',
                color: 'var(--color-accent)',
                fontSize: 8,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                flexShrink: 0,
                letterSpacing: '0.3px',
              }}>
                {releaseTypeLabel}
              </span>
            )}
            <span style={{
              color: 'var(--color-text-secondary)',
              fontSize: 11,
              lineHeight: '14px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            >
              {artistName}
            </span>
            {premiumLabel && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                padding: '1px 5px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(255,215,0,0.1)',
                border: '1px solid rgba(255,215,0,0.15)',
                color: '#cca300',
                fontSize: 8,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                {premiumLabel}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  }

  // Row variant — used in artist detail or list
  return (
    <button
      onClick={onPress}
      style={{
        display: 'flex',
        gap: 14,
        padding: 8,
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color var(--transition-fast) ease',
        alignItems: 'center',
        minWidth: 180,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {isDataSaver || !album.cover_url ? (
        // ⚡ Data saver ou pas de cover : icône placeholdere
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 20, color: 'var(--color-text-muted)' }}>♪</span>
        </div>
      ) : (
        <img
          src={getOptimizedImageUrl(cachedCover || album.cover_url)}
          onError={handleImageError}
          alt={album.title}
          loading="lazy"
          decoding="async"
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-sm)',
            objectFit: 'cover',
            flexShrink: 0,
          }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: 'var(--color-text-primary)',
            fontSize: 14,
            fontWeight: 600,
            lineHeight: '18px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 2,
          }}
        >
          {formatTitle(album.title)}
        </div>
        <div
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            lineHeight: '16px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artistName}
        </div>
      </div>
    </button>
  );
});
