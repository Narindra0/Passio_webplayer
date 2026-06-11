import { Download } from 'lucide-react';
import type { Album } from '@/types/album';

type AlbumCardProps = {
  album: Album;
  variant?: 'row' | 'tile';
  onPress?: () => void;
  isOffline?: boolean;
};

export function AlbumCard({ album, variant = 'row', onPress, isOffline = false }: AlbumCardProps) {
  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';

  if (variant === 'tile') {
    return (
      <button
        onClick={onPress}          style={{
          width: '48%',
          backgroundColor: 'rgba(255,255,255,0.055)',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.08)',
          padding: 8,
          cursor: 'pointer',
          textAlign: 'left',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
      >
        {album.cover_url ? (
          <img src={album.cover_url} alt={album.title} style={{ width: '100%', aspectRatio: '1', borderRadius: 12, objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', aspectRatio: '1', borderRadius: 12, backgroundColor: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '60%', height: '60%', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.04)' }} />
          </div>
        )}
        {isOffline && (
          <div style={{ position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', padding: 6, borderRadius: 12 }}>
            <Download size={16} color="var(--color-accent)" />
          </div>
        )}
        <div style={{ padding: '4px 0' }}>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, lineHeight: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {album.title}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: '17px', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artistName}
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onPress}
      style={{
        display: 'flex',
        gap: 16,
        padding: 12,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.055)',
        border: '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
        textAlign: 'left',
        position: 'relative',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.25)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
    >
      {album.cover_url ? (
        <img src={album.cover_url} alt={album.title} style={{ width: 60, height: 60, borderRadius: 16, objectFit: 'cover' }} />
      ) : (
        <div style={{ width: 60, height: 60, borderRadius: 16, backgroundColor: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '60%', height: '60%', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.04)' }} />
        </div>
      )}
      {isOffline && (
        <div style={{ position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', padding: 6, borderRadius: 12 }}>
          <Download size={16} color="var(--color-primary)" />
        </div>
      )}
      <div style={{ flex: 1, justifyContent: 'center', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, lineHeight: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {album.title}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: '17px', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {artistName}
        </div>
      </div>
    </button>
  );
}
