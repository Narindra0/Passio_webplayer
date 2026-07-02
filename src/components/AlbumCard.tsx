import type { Album } from '@/types/album';
import { useCachedImage } from '@/hooks/useCachedImage';
import { Download, Play } from 'lucide-react';
import { formatTitle } from '@/utils/formatTitle';

type AlbumCardProps = {
  album: Album;
  variant?: 'row' | 'tile';
  onPress?: () => void;
  isOffline?: boolean;
  premiumLabel?: string;
};

export function AlbumCard({ album, variant = 'row', onPress, isOffline = false, premiumLabel }: AlbumCardProps) {
  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';
  const cachedCover = useCachedImage(album.cover_url);

  if (variant === 'tile') {
    return (
      <button
        className="group"
        onClick={onPress}
        style={{
          width: '100%',
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
          {album.cover_url ? (
            <img
              src={cachedCover || album.cover_url}
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
          ) : (
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
          )}

          {/* Play Button Overlay — Spotify-style */}
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              width: 48,
              height: 48,
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
            <Play size={22} color="#fff" style={{ marginLeft: 3 }} />
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
        </div>

        {/* Album Info */}
        <div style={{ padding: '2px 4px', minHeight: 48 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{
              color: 'var(--color-text-secondary)',
              fontSize: 13,
              lineHeight: '16px',
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
                gap: 3,
                padding: '1px 6px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(255,215,0,0.1)',
                border: '1px solid rgba(255,215,0,0.15)',
                color: '#cca300',
                fontSize: 9,
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
      {album.cover_url ? (
        <img
          src={cachedCover || album.cover_url}
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
      ) : (
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
}
