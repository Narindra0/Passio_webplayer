import React from 'react';

interface ScreenProps {
  children: React.ReactNode;
  gradient?: boolean;
  padded?: boolean;
  maxWidth?: string;
  style?: React.CSSProperties;
  className?: string;
}

export function Screen({
  children,
  gradient = false,
  padded = true,
  maxWidth = '1440px',
  style,
  className
}: ScreenProps) {
  return (
    <div
      className={`screen ${gradient ? 'screen--gradient' : ''} ${className || ''}`}
      style={{
        width: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Gradient Background — vibrant red accent */}
      {gradient && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '420px',
            background: 'linear-gradient(180deg, rgba(139,0,0,0.15) 0%, rgba(220,20,60,0.05) 40%, transparent 100%)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}

      <div
        className="screen-inner"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 1,
          padding: padded ? 'var(--page-padding)' : undefined,
          maxWidth: padded ? maxWidth : undefined,
          width: '100%',
          margin: padded ? '0 auto' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function PageHeader({ title, subtitle, children, style }: PageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingBottom: 20,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1
          style={{
            color: 'var(--color-text-primary)',
            fontSize: 'clamp(28px, 3.5vw, 32px)',
            fontWeight: 700,
            letterSpacing: '-0.5px',
            margin: 0,
            lineHeight: 1.15,
          }}
        >
          {title}
        </h1>
        {children && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {children}
          </div>
        )}
      </div>
      {subtitle && (
        <p
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 15,
            lineHeight: '20px',
            margin: 0,
            maxWidth: 600,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
