import { Play, Pause } from 'lucide-react';
import { useCachedImage } from '@/hooks/useCachedImage';
import { getOptimizedImageUrl } from '@/utils/imageUtils';
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
          transition: 'box-shadow var(--transition-normal) ease',
          boxShadow: isCurrent ? 'inset 0 0 0 2px var(--color-accent), var(--shadow-md)' : 'var(--shadow-md)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = isCurrent
            ? 'inset 0 0 0 2px var(--color-accent), 0 4px 20px rgba(220,20,60,0.25)'
            : '0 4px 20px rgba(220,20,60,0.25)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = isCurrent
            ? 'inset 0 0 0 2px var(--color-accent), var(--shadow-md)'
            : 'var(--shadow-md)';
        }}
      >
        {track.cover_url ? (
          <img
            src={getOptimizedImageUrl(cachedCover || track.cover_url)}
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
            bottom: 6,
            right: 6,
            width: 40,
            height: 40,
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
            <Pause size={18} color="#fff" />
          ) : (
            <Play size={18} color="#fff" style={{ marginLeft: 2 }} />
          )}
        </div>

        {/* Feat Badge — couleur harmonisée avec le thème */}
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            background: 'var(--color-accent-soft)',
            padding: '2px 6px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            border: '1px solid var(--color-accent)',
          }}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" color="var(--color-accent)">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
          </svg>
          <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--color-accent)', textTransform: 'uppercase' }}>Feat.</span>
        </div>
      </div>

      {/* Track Info — compact */}
      <div style={{ padding: '2px 4px', minHeight: 40 }}>
        <div
          style={{
            color: isCurrent ? 'var(--color-accent)' : 'var(--color-text-primary)',
            fontSize: 13,
            fontWeight: 600,
            lineHeight: '16px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 2,
          }}
        >
          {formatTitle(track.title)}
        </div>
        <span
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 11,
            lineHeight: '14px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
          }}
        >
          {sourceArtistName}
        </span>
      </div>
    </button>
  );
}
