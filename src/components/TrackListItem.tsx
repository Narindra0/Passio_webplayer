import { Play, Pause, CloudCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    isTrackInDB(track.id).then(setIsOfflineAvailable);
  }, [track.id]);

  return (
    <button
      onClick={onPress}
      className="track-item"
      style={isPlaying ? { backgroundColor: 'rgba(120, 0, 0, 0.15)' } : undefined}
    >
      <div className="track-item-left">
        {track.cover_url ? (
          <img
            src={track.cover_url}
            alt=""
            style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', backgroundColor: 'rgba(255,255,255,0.05)' }}
          />
        ) : (
          <div style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 20 }}>♪</span>
          </div>
        )}
        <div className="track-item-info">
          <div className="track-item-title" style={isPlaying ? { color: 'var(--color-accent)' } : undefined}>
            {track.title}
          </div>
          <div className="track-item-artist">{track.artist_name}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isOfflineAvailable && (
          <span title="Disponible hors-ligne" style={{ display: 'flex' }}>
            <CloudCheck size={18} color="var(--color-accent)" />
          </span>
        )}
        <div style={{ width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isPlaying ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 20 }}>
              <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
              <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
              <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
              <div className="equalizer-bar" style={{ width: 3, backgroundColor: 'var(--color-accent)', borderRadius: 2 }} />
            </div>
          ) : (
            <Play size={20} color="rgba(255,255,255,0.45)" />
          )}
        </div>
      </div>
    </button>
  );
}
