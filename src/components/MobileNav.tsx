import { KeyRound, Library, Search, Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBottomInset } from '@/hooks/useBottomInset';

interface NavItem {
  path: string;
  label: string;
  icon: typeof Sparkles;
}

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  const bottomInset = useBottomInset();

  const navItems: NavItem[] = [
    { path: '/discover', label: 'Découvertes', icon: Sparkles },
    { path: '/search', label: 'Rechercher', icon: Search },
    { path: '/activate', label: 'Activer', icon: KeyRound },
    { path: '/local', label: 'Bibliothèque', icon: Library },
  ];

  const isActive = (path: string) => {
    if (path === '/tabs') return currentPath === '/tabs';
    return currentPath.startsWith(path);
  };

  return (
    <nav className="mobile-nav" style={{
      display: 'flex',
      justifyContent: 'center',
      padding: '8px 12px 12px',
      paddingBottom: bottomInset > 0 ? `${12 + bottomInset}px` : '12px',
      flexShrink: 0,
      position: 'relative',
      zIndex: 50,
    }}>
      <div className="mobile-nav-pill" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        gap: 2,
        padding: '4px 6px',
        borderRadius: 20,
        backgroundColor: 'rgba(24, 20, 19, 0.92)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        maxWidth: '100%',
        width: 'auto',
        minWidth: 0,
      }}>
        {navItems.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="mobile-nav-item"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 10px',
                borderRadius: 14,
                border: 'none',
                background: active 
                  ? 'linear-gradient(135deg, rgba(120,0,0,0.25), rgba(198,40,40,0.15))' 
                  : 'transparent',
                cursor: 'pointer',
                color: active ? '#fff' : 'rgba(255,255,255,0.5)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: active ? 'inset 0 0 12px rgba(120,0,0,0.15)' : 'none',
                minWidth: 0,
                flex: '0 1 auto',
                position: 'relative',
              }}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span style={{
                fontSize: 9,
                fontWeight: active ? 700 : 500,
                letterSpacing: '0.2px',
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}>
                {item.label}
              </span>
              {active && (
                <div style={{
                  position: 'absolute',
                  top: -2,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 16,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: 'var(--color-accent)',
                }} />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
