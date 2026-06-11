import React from 'react';

type SectionTitleProps = {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
};

export function SectionTitle({ title, subtitle, children, style }: SectionTitleProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0', ...style }}>
      <h2 style={{
        color: '#fff',
        fontSize: 22,
        fontFamily: "var(--font-hanken)",
        fontWeight: 700,
        letterSpacing: '-0.5px',
        margin: 0,
      }}>
        {children || title}
      </h2>
      {subtitle ? (
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: '20px', margin: 0 }}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
