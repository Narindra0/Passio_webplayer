import { useNavigate } from 'react-router-dom';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useNetworkQuality } from '@/hooks/useNetworkQuality';
import { getOptimizedImageUrl } from '@/utils/imageUtils';
import { formatTitle } from '@/utils/formatTitle';
import type { PublicAlbumSummary } from '@/types/backend';

interface AlbumRowProps {
  /** Section title (e.g. "Tendances") */
  title: string;
  /** Icon element to display in the circle beside the title */
  icon: React.ReactNode;
  /** Array of albums to display */
  albums: PublicAlbumSummary[];
  /** Accent color for borders and hover effects (CSS color). Default: 'var(--color-accent)' */
  accentColor?: string;
  /** Background gradient for the icon circle. Default: 'var(--color-accent-gradient)' */
  iconBg?: string;
  /** Badge text color. Default: accentColor */
  badgeColor?: string;
  /** Fixed width for each card in pixels. Default: 136 */
  cardWidth?: number;
  /** Maximum number of items to show. Default: 8 */
  maxItems?: number;
  /** Optional badge renderer — return null to hide. Receives album and index. */
  renderBadge?: (album: PublicAlbumSummary, index: number) => React.ReactNode | null;
  /** Optional overlay renderer for the cover area (e.g. Premium badge). Receives album and index. */
  renderCardOverlay?: (album: PublicAlbumSummary, index: number) => React.ReactNode | null;
  /** Optional footer link (e.g. "Tout voir" → /catalog). */
  footerLink?: { label: string; to: string };
  /** Called when the footer link is clicked. Default: navigates to footerLink.to */
  onFooterPress?: () => void;
  /** Called when an album card is clicked. Default: navigates to /album/:id */
  onAlbumPress?: (albumId: string) => void;
  /** Additional class name for the wrapper */
  className?: string;
  /** Additional styles for the wrapper */
  style?: React.CSSProperties;
  /**
   * Si true, désactive le mode data-saver pour cette rangée.
   * Utile dans les sections où on veut toujours afficher les covers.
   */
  disableDataSaver?: boolean;
}

// ── Sous-composant pour chaque carte album (permet useCachedImage au top-level) ──

type AlbumCardInnerProps = {
  album: PublicAlbumSummary;
  cardWidth: number;
  accentColor: string;
  onPress: () => void;
  renderCardOverlay?: (album: PublicAlbumSummary, index: number) => React.ReactNode | null;
  renderBadge?: (album: PublicAlbumSummary, index: number) => React.ReactNode | null;
  index: number;
  artistName: string;
  disableDataSaver?: boolean;
};

function AlbumCardInner({
  album,
  cardWidth,
  accentColor,
  onPress,
  renderCardOverlay,
  renderBadge,
  index,
  artistName,
  disableDataSaver = false,
}: AlbumCardInnerProps) {
  const networkQuality = useNetworkQuality();
  const isDataSaver = disableDataSaver ? false : networkQuality === 'slow';
  const cachedCover = useCachedImage(isDataSaver ? null : album.cover_url);

  return (
    <button
      onClick={onPress}
      style={{
        flex: `0 0 ${cardWidth}px`,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        cursor: 'pointer',
        border: `1px solid ${accentColor}22`,
        background: `${accentColor}08`,
        textAlign: 'left',
        scrollSnapAlign: 'start',
        transition: 'all var(--transition-fast) ease',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${accentColor}55`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = `${accentColor}22`;
      }}
    >
      {/* Cover */}
      <div style={{
        width: '100%',
        height: cardWidth,
        background: 'var(--color-surface)',
        position: 'relative',
      }}>
        {isDataSaver ? (
          // ⚡ Data saver : icône placeholdere
          <div style={{
            width: '100%', height: '100%',
            display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-muted)', fontSize: 24,
          }}>
            ♪
          </div>
        ) : (
          <img
            src={getOptimizedImageUrl(cachedCover || album.cover_url)}
            alt={album.title}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = 'none';
              const fallback = target.parentElement?.querySelector('[data-fallback]');
              if (fallback) (fallback as HTMLElement).style.display = 'flex';
            }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        <div
          data-fallback="true"
          style={{
            position: 'absolute', inset: 0,
            display: 'none',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-muted)', fontSize: 24,
          }}
        >
          ♪
        </div>

        {/* Optional overlay (Premium badge, artist context, etc.) */}
        {renderCardOverlay && renderCardOverlay(album, index)}
      </div>

      {/* Info */}
      <div style={{ padding: '10px 10px 8px' }}>
        <span style={{
          color: 'var(--color-text-primary)',
          fontSize: 12,
          fontWeight: 700,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          lineHeight: '1.3',
        }}>
          {formatTitle(album.title)}
        </span>
        <span style={{
          color: 'var(--color-text-muted)',
          fontSize: 11,
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginTop: 4,
        }}>
          {artistName}
        </span>

        {/* Optional badge */}
        {renderBadge && renderBadge(album, index) !== null && (
          <div style={{ marginTop: 6 }}>
            {renderBadge(album, index)}
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * A reusable horizontal scrollable row of album cards.
 *
 * Features:
 * - Scroll snap with hidden scrollbar
 * - Accent-themed icon circle + title header
 * - Optional per-item badge (e.g. "Découverte", "Via X")
 * - Cover image with fallback + cached + optimized
 * - Hover effects on cards
 * - Auto-navigates to album detail on press (customizable)
 */
export function AlbumRow({
  title,
  icon,
  albums,
  accentColor = 'var(--color-accent)',
  iconBg = 'var(--color-accent-gradient)',
  badgeColor,
  cardWidth = 136,
  maxItems = 8,
  renderBadge,
  renderCardOverlay,
  footerLink,
  onFooterPress,
  onAlbumPress,
  className = '',
  style,
  disableDataSaver = false,
}: AlbumRowProps) {
  const navigate = useNavigate();

  const handlePress = (albumId: string) => {
    if (onAlbumPress) {
      onAlbumPress(albumId);
    } else {
      navigate(`/album/${albumId}`);
    }
  };

  return (
    <div className={className} style={{ marginBottom: 12, ...style }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-full)',
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <h3 style={{
          color: 'var(--color-text-primary)',
          fontSize: 16,
          fontWeight: 800,
          margin: 0,
        }}>
          {title}
        </h3>

        {/* Footer link (e.g. "Tout voir") */}
        {footerLink && (
          <button
            onClick={() => {
              if (onFooterPress) onFooterPress();
              else navigate(footerLink.to);
            }}
            style={{
              marginLeft: 'auto',
              color: 'var(--color-text-muted)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid rgba(255,255,255,0.04)',
              background: 'transparent',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.color = 'var(--color-text-secondary)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--color-text-muted)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)';
            }}
          >
            <span>{footerLink.label}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Scrollable row ── */}
      <div style={{
        display: 'flex',
        gap: 10,
        overflowX: 'auto',
        overflowY: 'hidden',
        paddingBottom: 8,
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
      }}
        className="hide-scrollbar"
      >
        {albums.slice(0, maxItems).map((album, index) => {
          const artistName = album.artist_name || album.artist?.name || 'Artiste';
          return (
            <AlbumCardInner
              key={album.id}
              album={album}
              cardWidth={cardWidth}
              accentColor={accentColor}
              onPress={() => handlePress(album.id)}
              renderCardOverlay={renderCardOverlay}
              renderBadge={renderBadge}
              index={index}
              artistName={artistName}
              disableDataSaver={disableDataSaver}
            />
          );
        })}
      </div>
    </div>
  );
}
