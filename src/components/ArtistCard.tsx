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

  return (
    <button
      onClick={onPress}
      style={{
        width: 110,
        height: 140,
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: 'var(--color-surface-elevated)',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        position: 'relative',
        flexShrink: 0,
        transition: 'all 0.15s ease',
        boxShadow: '0 6px 10px rgba(0,0,0,0.3)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'scale(0.98)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1)'; }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={artist.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%', backgroundColor: '#2A2B32',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#fff', fontSize: 40, fontWeight: 800 }}>
            {artist.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: 10,
      }}>
        <span style={{
          color: '#fff', fontSize: 13, fontWeight: 600, textAlign: 'center',
          lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
        }}>
          {artist.name}
        </span>
      </div>
    </button>
  );
}
