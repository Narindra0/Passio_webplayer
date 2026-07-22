import { Play, Sparkles, Music } from 'lucide-react';
import type { DailyMix } from '@/services/dailyMix';
import { getOptimizedImageUrl } from '@/utils/imageUtils';

interface DailyMixCardProps {
  mix: DailyMix;
  onPlay: () => void;
  /** Variante d'affichage : card simple (mobile) ou section complète (desktop) */
  variant?: 'card' | 'section';
}

/**
 * Carte « Daily Mix » — affiche une grille 2×2 de covers d'albums,
 * le label du jour, le nombre de titres, et un bouton Play.
 *
 * Le fond utilise un dégradé dynamique inspiré du thème rouge/noir de l'app.
 * Les 4 premières covers du mix sont affichées en mosaïque.
 */
export function DailyMixCard({ mix, onPlay, variant = 'card' }: DailyMixCardProps) {
  const coverUrls = mix.tracks
    .map(t => t.coverUrl ? getOptimizedImageUrl(t.coverUrl) : null)
    .filter((url): url is string => !!url)
    .slice(0, 4);

  // Pendant l'affichage on remplit les slots vides avec des placeholders
  const gridSlots = 4;

  return (
    <div
      className="daily-mix-card group"
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #1a0a0e 0%, #2d0f15 30%, #1a080a 70%, #0d0d0d 100%)',
        border: '1px solid rgba(220, 20, 60, 0.12)',
        cursor: 'pointer',
        transition: 'all var(--transition-normal) ease',
        boxShadow: variant === 'section'
          ? '0 4px 24px rgba(220,20,60,0.08), 0 1px 4px rgba(0,0,0,0.2)'
          : '0 2px 12px rgba(0,0,0,0.2)',
      }}
      onClick={onPlay}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(220, 20, 60, 0.25)';
        e.currentTarget.style.boxShadow = '0 4px 24px rgba(220,20,60,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(220, 20, 60, 0.12)';
        e.currentTarget.style.boxShadow = variant === 'section'
          ? '0 4px 24px rgba(220,20,60,0.08), 0 1px 4px rgba(0,0,0,0.2)'
          : '0 2px 12px rgba(0,0,0,0.2)';
      }}
    >
      {/* Decorative gradients */}
      <div style={{
        position: 'absolute',
        top: -60,
        right: -40,
        width: 200,
        height: 200,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(220,20,60,0.08), transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: -30,
        left: -20,
        width: 120,
        height: 120,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139,0,0,0.06), transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex',
        flexDirection: variant === 'section' ? 'row' : 'column',
        gap: variant === 'section' ? 24 : 14,
        padding: variant === 'section' ? '20px 24px' : '16px',
        position: 'relative',
        zIndex: 1,
        alignItems: variant === 'section' ? 'center' : 'stretch',
      }}>
        {/* ── Cover Grid 2×2 ── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 2,
          width: variant === 'section' ? 140 : 100,
          height: variant === 'section' ? 140 : 100,
          flexShrink: 0,
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          {Array.from({ length: gridSlots }).map((_, i) => (
            <div
              key={i}
              style={{
                width: '100%',
                height: '100%',
                background: coverUrls[i]
                  ? `url(${coverUrls[i]}) center/cover no-repeat`
                  : 'rgba(255,255,255,0.03)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: 'rgba(255,255,255,0.1)',
              }}
            >
              {!coverUrls[i] && <Music size={14} />}
            </div>
          ))}
        </div>

        {/* ── Info ── */}
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          {/* Badge Daily Mix */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'linear-gradient(135deg, rgba(220,20,60,0.15), rgba(220,20,60,0.05))',
            border: '1px solid rgba(220,20,60,0.15)',
            width: 'fit-content',
          }}>
            <Sparkles size={12} color="var(--color-accent)" />
            <span style={{
              color: 'var(--color-accent)',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}>
              Daily Mix
            </span>
          </div>

          {/* Day label */}
          <h3 style={{
            color: 'var(--color-text-primary)',
            fontSize: variant === 'section' ? 20 : 16,
            fontWeight: 700,
            margin: 0,
            lineHeight: 1.2,
            letterSpacing: '-0.3px',
          }}>
            {mix.dayLabel.split(' ').slice(0, 2).join(' ')}
          </h3>

          {/* Track count + description */}
          <p style={{
            color: 'var(--color-text-secondary)',
            fontSize: variant === 'section' ? 13 : 12,
            fontWeight: 500,
            margin: 0,
            lineHeight: 1.4,
          }}>
            {mix.trackCount} morceau{mix.trackCount > 1 ? 'x' : ''} · Recommandé pour vous
          </p>

          {/* Artists chips */}
          <div style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            marginTop: 4,
          }}>
            {(() => {
              const uniqueArtists = [...new Set(mix.tracks.map(t => t.artistName))].slice(0, 3);
              return uniqueArtists.map((name, i) => (
                <span
                  key={name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    color: 'var(--color-text-secondary)',
                    fontSize: 10,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                  {i < uniqueArtists.length - 1 ? '' : ''}
                </span>
              ));
            })()}
            {[...new Set(mix.tracks.map(t => t.artistName))].length > 3 && (
              <span style={{
                color: 'var(--color-text-muted)',
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 4px',
              }}>
                +{[...new Set(mix.tracks.map(t => t.artistName))].length - 3}
              </span>
            )}
          </div>
        </div>

        {/* ── Play Button Overlay ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: variant === 'section' ? 'flex-end' : 'flex-start',
          flexShrink: 0,
        }}>
          <div
            style={{
              width: variant === 'section' ? 52 : 44,
              height: variant === 'section' ? 52 : 44,
              borderRadius: 'var(--radius-full)',
              background: 'linear-gradient(135deg, var(--color-accent), #8b0000)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 12px rgba(220,20,60,0.3)',
              transition: 'all var(--transition-fast) ease',
              transform: 'scale(1)',
            }}
            className="group-hover:scale-105"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(220,20,60,0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 2px 12px rgba(220,20,60,0.3)';
            }}
          >
            <Play size={variant === 'section' ? 22 : 18} color="#fff" style={{ marginLeft: 2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
