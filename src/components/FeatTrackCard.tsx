import { Play, Pause } from 'lucide-react';
import { useCachedImage } from '@/hooks/useCachedImage';
import { formatTitle } from '@/utils/formatTitle';
import type { TrackWithAlbum } from '@/components/TrackListItem';

interface FeatTrackCardProps {
  track: TrackWithAlbum;
  isPlaying?: boolean;
  isCurrent?: boolean;
  onPress: () => void;
  /** Nom de l'artiste principal de l'album source (celui qui invite) */
  sourceArtistName: string;
}

/**
 * Carte de track pour les feats dans la discographie d'un artiste.
 * Affiche la cover de l'album source, le titre du morceau,
 * le nom de l'artiste qui invite, et un badge "Feat.".
 */
export function FeatTrackCard({
  track,
  isPlaying = false,
  isCurrent = false,
  onPress,
  sourceArtistName,
}: FeatTrackCardProps) {
  const cachedCover = useCachedImage(track.cover_url);

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
        border: 'none',
      }}
    >
      {/* Cover avec overlays */}
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
          border: isCurrent ? '2px solid var(--color-accent)' : 'none',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        }}
      >
        {track.cover_url ? (
          <img
            src={cachedCover || track.cover_url}
            alt={track.title}
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

        {/* Play/Pause Button Overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-full)',
            background: isCurrent && isPlaying ? 'var(--color-accent)' : 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'all var(--transition-fast) ease',
            opacity: isCurrent ? 1 : 0,
            transform: isCurrent ? 'translateY(0)' : 'translateY(8px)',
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
          {isCurrent && isPlaying ? (
            <Pause size={22} color="#fff" />
          ) : (
            <Play size={22} color="#fff" style={{ marginLeft: 3 }} />
          )}
        </div>

        {/* Feat Badge — toujours visible sur une FeatTrackCard */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            background: 'rgba(99,102,241,0.9)',
            padding: '3px 8px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            backdropFilter: 'blur(8px)',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
          </svg>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>Feat.</span>
        </div>
      </div>

      {/* Track Info */}
      <div style={{ padding: '2px 4px', minHeight: 48 }}>
        <div
          style={{
            color: isCurrent ? 'var(--color-accent)' : 'var(--color-text-primary)',
            fontSize: 14,
            fontWeight: 600,
            lineHeight: '18px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 2,
          }}
        >
          {formatTitle(track.title)}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 0,
        }}>
          <span
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 12,
              lineHeight: '16px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sourceArtistName} · {track.album_title}
          </span>
        </div>
      </div>
    </button>
  );
}
