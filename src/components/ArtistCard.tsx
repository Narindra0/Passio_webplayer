import { useCachedImage } from '@/hooks/useCachedImage';

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
};

export function ArtistCard({ artist, onPress }: ArtistCardProps) {
  const imageUrl = artist.profile_picture_url || artist.fallback_image_url;
  const cachedImage = useCachedImage(imageUrl);

  return (
    <button
      onClick={onPress}
      className="group"
      style={{
        width: 160,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '20px 16px 16px',
        borderRadius: 'var(--radius-md)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        transition: 'background-color var(--transition-fast) ease',
        flexShrink: 0,
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
        {imageUrl ? (
          <img
            src={cachedImage || imageUrl}
            alt={artist.name}
            loading="lazy"
            decoding="async"
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
}
