import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, CheckCircle, Sparkles, Music } from 'lucide-react';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useCachedImage } from '@/hooks/useCachedImage';
import { getPurchaseAlbumUrl } from '@/config/urls';
import type { PublicAlbumSummary } from '@/types/backend';

interface PremiumAlbumCardProps {
  album: PublicAlbumSummary;
  isOwned?: boolean;
  onPress?: () => void;
}

export function PremiumAlbumCard({ album, isOwned = false, onPress }: PremiumAlbumCardProps) {
  const navigate = useNavigate();
  const coverColors = useAlbumColors(album.cover_url);
  const cachedCover = useCachedImage(album.cover_url);
  const [isHovered, setIsHovered] = useState(false);

  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';
  const albumType = album.type === 'single' ? 'Single' : album.type === 'ep' ? 'EP' : 'Album';

  const priceDisplay = useMemo(() => {
    if (album.price_ariary <= 0) return null;
    const value = album.price_ariary;
    if (value >= 1000) {
      return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} ${value >= 10000 ? 'K' : 'k'} Ar`;
    }
    return `${value.toLocaleString()} Ar`;
  }, [album.price_ariary]);

  const handleBuy = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(getPurchaseAlbumUrl(album.id), '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      onClick={onPress || (() => navigate(`/album/${album.id}`))}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="premium-card group"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        cursor: 'pointer',
        textAlign: 'left',
        border: '1px solid var(--color-border-subtle)',
        background: coverColors.gradientStyle || 'var(--color-surface-elevated)',
        transition: 'all var(--transition-normal) ease',
        transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: isHovered ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
        minHeight: 280,
      }}
    >
      {/* Subtle gradient overlay — replaces old blurred image (saves bandwidth) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          background: 'linear-gradient(135deg, rgba(139,0,0,0.25) 0%, transparent 50%, rgba(60,10,30,0.15) 100%)',
        }}
      />

      {/* Gradient overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '70%',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
          zIndex: 1,
        }}
      />

      {/* Decorative pattern overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          opacity: 0.04,
          backgroundImage: `radial-gradient(circle at 25% 25%, rgba(255,215,0,0.3) 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        }}
      />

      {/* Premium badge */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 12px',
          borderRadius: 'var(--radius-full)',
          background: 'linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,165,0,0.15))',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,215,0,0.25)',
        }}
      >
        <Sparkles size={12} color="#FFD700" />
        <span style={{ color: '#FFD700', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          Premium
        </span>
      </div>

      {/* Content */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: 20,
        }}
      >
        {/* Cover art thumbnail */}
        <div
          style={{
            width: '100%',
            aspectRatio: '1',
            maxHeight: 160,
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-lg)',
            marginBottom: 16,
            alignSelf: 'center',
            maxWidth: '70%',
            transition: 'transform var(--transition-normal) ease',
            transform: isHovered ? 'scale(1.03)' : 'scale(1)',
          }}
        >
          {album.cover_url ? (
            <img
              src={cachedCover || album.cover_url}
              alt={album.title}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: 'var(--color-surface-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Music size={32} color="var(--color-text-muted)" />
            </div>
          )}
        </div>

        {/* Type and album info */}
        <div style={{ marginBottom: 8 }}>
          <span style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            {albumType}
          </span>
        </div>

        <h3 style={{
          color: '#fff',
          fontSize: 16,
          fontWeight: 700,
          lineHeight: '20px',
          margin: '0 0 2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {album.title}
        </h3>

        <p style={{
          color: 'rgba(255,255,255,0.6)',
          fontSize: 13,
          fontWeight: 500,
          margin: '0 0 14px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {artistName}
        </p>

        {/* Price and CTA */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
          {priceDisplay && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <span style={{
                color: '#FFD700',
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: '-0.3px',
                lineHeight: 1,
              }}>
                {priceDisplay}
              </span>
            </div>
          )}

          {isOwned ? (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 12px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(29, 185, 84, 0.15)',
              border: '1px solid rgba(29, 185, 84, 0.25)',
            }}>
              <CheckCircle size={14} color="#1DB954" />
              <span style={{ color: '#1DB954', fontSize: 11, fontWeight: 700 }}>
                Possédé
              </span>
            </div>
          ) : priceDisplay ? (
            <button
              onClick={handleBuy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 14px',
                borderRadius: 'var(--radius-full)',
                background: isHovered ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)',
                border: `1px solid ${isHovered ? 'var(--color-accent)' : 'rgba(255,255,255,0.15)'}`,
                cursor: 'pointer',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                transition: 'all var(--transition-fast) ease',
                backdropFilter: 'blur(4px)',
              }}
            >
              <ShoppingBag size={13} />
              Acheter
            </button>
          ) : (
            <span style={{
              color: '#1DB954',
              fontSize: 13,
              fontWeight: 700,
            }}>
              Gratuit
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
