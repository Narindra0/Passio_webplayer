import React from 'react';

type PrimaryButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: React.CSSProperties;
};

export function PrimaryButton({ label, onPress, disabled = false, variant = 'primary', style }: PrimaryButtonProps) {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 24px',
    borderRadius: 999,
    fontFamily: "var(--font-inter)",
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    transition: 'all 150ms ease',
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
    minHeight: 52,
    minWidth: 160,
    ...style,
  };

  const variants: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: 'var(--color-primary-light)',
      color: '#fff',
      boxShadow: '0 4px 8px rgba(120, 0, 0, 0.25)',
      opacity: disabled ? 0.4 : 1,
    },
    secondary: {
      backgroundColor: 'transparent',
      border: '1px solid rgba(120, 0, 0, 0.15)',
      color: 'rgba(255,255,255,0.75)',
      opacity: disabled ? 0.4 : 1,
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'rgba(255,255,255,0.75)',
      opacity: disabled ? 0.4 : 1,
    },
  };

  return (
    <button
      onClick={disabled ? undefined : onPress}
      disabled={disabled}
      style={{ ...baseStyle, ...variants[variant] }}
      onMouseEnter={(e) => {
        if (!disabled) {
          if (variant === 'primary') e.currentTarget.style.backgroundColor = '#9B1B1B';
          if (variant === 'secondary') e.currentTarget.style.backgroundColor = 'rgba(120,0,0,0.2)';
        }
      }}
      onMouseLeave={(e) => {
        if (variant === 'primary') e.currentTarget.style.backgroundColor = 'var(--color-primary-light)';
        if (variant === 'secondary') e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {label}
    </button>
  );
}
