import { Play, Pause, CloudCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCachedImage } from '@/hooks/useCachedImage';
import { isTrackInDB } from '../services/indexedDB';

export interface TrackWithAlbum {
  id: string;
  title: string;
  artist_name: string;
  album_id: string;
  album_title: string;
  duration?: number | null;
  position?: number | null;
  preview_url?: string | null;
  encrypted_audio_url?: string | null;
  stream_url?: string | null;
  is_encrypted?: boolean;
  lyrics_url?: string | null;
  has_lyrics?: boolean;
  cover_url?: string | null;
}

type TrackListItemProps = {
  track: TrackWithAlbum;
  onPress: () => void;
  isPlaying?: boolean;
};

export function TrackListItem({ track, onPress, isPlaying = false }: TrackListItemProps) {
  const [isOfflineAvailable, setIsOfflineAvailable] = useState(false);
  const cachedCover = useCachedImage(track.cover_url);

  useEffect(() => {
    isTrackInDB(track.id).then(setIsOfflineAvailable);
  }, [track.id]);

  return (
    <button
      onClick={onPress}
      className="track-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'background-color var(--transition-fast) ease',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        background: isPlaying ? 'var(--color-accent-soft)' : 'transparent',
        color: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!isPlaying) e.currentTarget.style.background = 'var(--color-surface-hover)';
        else e.currentTarget.style.background = 'var(--color-accent-soft)';
      }}
      onMouseLeave={(e) => {
        if (!isPlaying) e.currentTarget.style.background = 'transparent';
        else e.currentTarget.style.background = 'var(--color-accent-soft)';
      }}
    >
      {/* Cover */}
      {track.cover_url ? (
        <img
          src={cachedCover || track.cover_url}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-sm)',
            objectFit: 'cover',
            backgroundColor: 'var(--color-surface-elevated)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface-elevated)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 16 }}>♪</span>
        </div>
      )}

      {/* Info */}
      <div className="track-item-info" style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: isPlaying ? 'var(--color-text-primary)' : 'var(--color-text-primary)',
            fontSize: 14,
            fontWeight: 600,
            lineHeight: '20px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {track.title}
        </div>
        <div
          style={{
            color: isPlaying ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
            fontSize: 13,
            lineHeight: '18px',
            marginTop: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {track.artist_name}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {isOfflineAvailable && (
          <CloudCheck size={16} color="var(--color-success)" />
        )}

        <div style={{ width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isPlaying ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
              <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
              <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
              <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
              <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
            </div>
          ) : (
            <Play size={18} color="var(--color-text-muted)" />
          )}
        </div>
      </div>
    </button>
  );
}
