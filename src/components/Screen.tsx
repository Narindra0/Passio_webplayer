import React from 'react';

interface ScreenProps {
  children: React.ReactNode;
  gradient?: boolean;
  /** If true, adds standard page padding (default: true) */
  padded?: boolean;
  /** Maximum content width (default: 1440px) */
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
      {/* Gradient Background */}
      {gradient && (
        <div 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '60vh',
            background: 'radial-gradient(ellipse at 50% 0%, rgba(120, 0, 0, 0.06) 0%, rgba(198, 40, 40, 0.02) 40%, transparent 70%)',
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

/**
 * PageHeader — composant standard pour l'en-tête des pages
 */
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  accent?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function PageHeader({ title, subtitle, accent = false, children, style }: PageHeaderProps) {
  return (
    <div 
      className="page-header"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingBottom: 20,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {accent && (
            <div 
              style={{
                width: 4,
                height: 28,
                borderRadius: 2,
                backgroundColor: 'var(--color-accent)',
                flexShrink: 0,
              }} 
            />
          )}
          <h1 
            className="page-title"
            style={{
              color: accent ? 'var(--color-accent)' : '#fff',
              fontSize: 'clamp(24px, 4vw, 36px)',
              fontFamily: 'var(--font-hanken)',
              fontWeight: 700,
              letterSpacing: '-0.5px',
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {title}
          </h1>
        </div>
        {children && (
          <div className="page-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {children}
          </div>
        )}
      </div>
      {subtitle && (
        <p 
          className="page-subtitle"
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 'clamp(13px, 1.5vw, 15px)',
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
