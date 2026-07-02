import { useEffect, useState } from 'react';
import { Clock, Sparkles } from 'lucide-react';
import { getRemainingTime, formatPublicationDate } from '@/utils/preorder';

interface PreorderCountdownProps {
  publicationDate: string;
}

export function PreorderCountdown({ publicationDate }: PreorderCountdownProps) {
  const [time, setTime] = useState(() => getRemainingTime(publicationDate));

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(getRemainingTime(publicationDate));
    }, 1000);
    return () => clearInterval(interval);
  }, [publicationDate]);

  const isImminent = time.days <= 3;
  const isLongTerm = time.days > 30;

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--radius-md)',
        background: isImminent
          ? 'linear-gradient(135deg, rgba(220,20,60,0.15), rgba(180,0,0,0.08))'
          : 'linear-gradient(135deg, rgba(255,215,0,0.08), rgba(255,165,0,0.04))',
        border: `1px solid ${isImminent ? 'rgba(220,20,60,0.2)' : 'rgba(255,215,0,0.15)'}`,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Decorative sparkles */}
      <div
        style={{
          position: 'absolute',
          top: -10,
          right: -10,
          fontSize: 48,
          color: isImminent ? 'rgba(220,20,60,0.06)' : 'rgba(255,215,0,0.06)',
          pointerEvents: 'none',
          fontFamily: 'serif',
          lineHeight: 1,
        }}
      >
        ✦
      </div>

      {/* Icon */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--radius-full)',
          background: isImminent
            ? 'rgba(220,20,60,0.15)'
            : 'rgba(255,215,0,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isImminent ? (
          <Clock size={18} color="var(--color-accent)" />
        ) : (
          <Sparkles size={18} color="#FFD700" />
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            color: isImminent ? 'var(--color-accent)' : '#FFD700',
            fontSize: 13,
            fontWeight: 700,
            margin: 0,
            lineHeight: '18px',
          }}
        >
          {isLongTerm
            ? `Disponible le ${formatPublicationDate(publicationDate)}`
            : isImminent
              ? `Sortie dans ${time.days > 0 ? `${time.days}j ` : ''}${String(time.hours).padStart(2, '0')}h ${String(time.minutes).padStart(2, '0')}min ${String(time.seconds).padStart(2, '0')}s`
              : `${formatPublicationDate(publicationDate)}`}
        </p>
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 12,
            margin: '2px 0 0',
            lineHeight: '16px',
          }}
        >
          {isLongTerm
            ? 'Précommandez dès maintenant'
            : 'Précommandez pour être alerté à la sortie'}
        </p>
      </div>
    </div>
  );
}
