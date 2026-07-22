import React from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, CheckCircle, Clock, Sparkles, Music } from 'lucide-react';
import { formatTitle } from '@/utils/formatTitle';
import { isPreorder } from '@/utils/preorder';
import { useAlbumColors } from '@/hooks/useAlbumColors';
import { useCachedImage } from '@/hooks/useCachedImage';
import { getOptimizedImageUrl } from '@/utils/imageUtils';
import { useNetworkQuality } from '@/hooks/useNetworkQuality';
import { getPurchaseAlbumUrl } from '@/config/urls';
import type { PublicAlbumSummary } from '@/types/backend';
import {
  getPrimaryTextColor,
  getSecondaryTextColor,
  getMutedTextColor,
} from '@/services/colorExtractor';

interface PremiumAlbumCardProps {
  album: PublicAlbumSummary;
  isOwned?: boolean;
  onPress?: () => void;
  /**
   * Si true, désactive le mode data-saver pour cette carte.
   */
  disableDataSaver?: boolean;
}

export const PremiumAlbumCard = React.memo(function PremiumAlbumCard({ album, isOwned = false, onPress, disableDataSaver = false }: PremiumAlbumCardProps) {
  const navigate = useNavigate();
  const networkQuality = useNetworkQuality();
  const isDataSaver = disableDataSaver ? false : networkQuality === 'slow';
  // ⚡ Data saver : pas d'extraction de couleurs ni de cache image
  const coverColors = useAlbumColors(isDataSaver ? null : album.cover_url);
  const cachedCover = useCachedImage(isDataSaver ? null : album.cover_url);
  const [isHovered, setIsHovered] = useState(false);

  const preordered = isPreorder(album.publication_date);

  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';
  const albumType = album.type === 'single' ? 'Single' : album.type === 'ep' ? 'EP' : 'Album';

  const priceDisplay = useMemo(() => {
    if (album.price_ariary <= 0) return null;
    return `${album.price_ariary.toLocaleString()} Ar`;
  }, [album.price_ariary]);

  const handleBuy = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(getPurchaseAlbumUrl(album.id), '_blank', 'noopener,noreferrer');
  };

  const handleCardClick = () => {
    if (onPress) onPress();
    else navigate(`/album/${album.id}`);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  // Adaptive text colors based on extracted cover colors
  const primaryText = getPrimaryTextColor(coverColors.colors, '#ffffff');
  const secondaryText = getSecondaryTextColor(coverColors.colors, 'rgba(255,255,255,0.65)');
  const mutedText = getMutedTextColor(coverColors.colors, 'rgba(255,255,255,0.35)');
  const isCoverDark = coverColors.colors?.isDark ?? true;

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      aria-label={`${albumType} ${formatTitle(album.title)} par ${artistName}${priceDisplay ? ` — ${priceDisplay}` : ''}`}
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
        minHeight: 240,
        padding: 0,
      }}
    >
      {/* Subtle gradient overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          background: 'linear-gradient(135deg, rgba(139,0,0,0.25) 0%, transparent 50%, rgba(60,10,30,0.15) 100%)',
        }}
      />

      {/* Dark gradient overlay at bottom for text readability */}
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

      {/* Pre-order / Premium badge */}
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
          background: preordered
            ? 'linear-gradient(135deg, rgba(220,20,60,0.25), rgba(139,0,0,0.2))'
            : 'linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,165,0,0.15))',
          backdropFilter: 'blur(8px)',
          border: preordered
            ? '1px solid rgba(220,20,60,0.3)'
            : '1px solid rgba(255,215,0,0.25)',
        }}
      >
        {preordered ? (
          <Clock size={12} color="var(--color-accent)" />
        ) : (
          <Sparkles size={12} color="#FFD700" />
        )}
        <span style={{
          color: preordered ? 'var(--color-accent)' : '#FFD700',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
        }}>
          {preordered ? 'Précommande' : 'Premium'}
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
          padding: 14,
        }}
      >
        {/* Cover art thumbnail */}
        <div
          style={{
            width: '100%',
            aspectRatio: '1',
            maxHeight: 150,
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            boxShadow: isHovered ? '0 4px 16px rgba(0,0,0,0.4)' : 'var(--shadow-md)',
            marginBottom: 10,
            alignSelf: 'center',
            maxWidth: '80%',
            transition: 'all var(--transition-fast) ease',
            transform: isHovered ? 'scale(1.04)' : 'scale(1)',
          }}
        >
          {isDataSaver || !album.cover_url ? (
            // ⚡ Data saver ou pas de cover : icône placeholdere
            <div style={{
              width: '100%', height: '100%',
              background: 'var(--color-surface-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Music size={32} color="var(--color-text-muted)" />
            </div>
          ) : (
            <img
              src={getOptimizedImageUrl(cachedCover || album.cover_url)}
              alt={album.title}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </div>

        {/* Album title — adapté à la couleur du cover */}
        <h3 style={{
          color: primaryText,
          fontSize: 14,
          fontWeight: 700,
          lineHeight: '18px',
          margin: '0 0 1px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {formatTitle(album.title)}
        </h3>

        {/* Artist + type — adapté à la couleur du cover */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <span style={{
            color: mutedText,
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
          }}>
            {albumType}
          </span>
          <span style={{ color: isCoverDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)', fontSize: 9 }}>·</span>
          <span style={{
            color: secondaryText,
            fontSize: 11,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {artistName}
          </span>
        </div>

        {/* Price and CTA */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 'auto',
        }}>
          {priceDisplay && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <span style={{
                color: '#FFD700',
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: '-0.2px',
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
              title={preordered ? 'Précommander' : 'Acheter'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: preordered ? '5px 12px' : undefined,
                width: preordered ? undefined : 32,
                height: 32,
                borderRadius: 'var(--radius-full)',
                background: preordered
                  ? 'var(--color-accent)'
                  : isHovered ? 'var(--color-accent)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${isHovered || preordered ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)'}`,
                cursor: 'pointer',
                color: primaryText,
                fontSize: 11,
                fontWeight: 700,
                transition: 'all var(--transition-fast) ease',
              }}
            >
              <ShoppingBag size={14} />
              {preordered && <span>Précommander</span>}
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
    </div>
  );
});
