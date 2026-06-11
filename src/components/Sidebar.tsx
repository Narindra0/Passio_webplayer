import { useLocation, useNavigate } from 'react-router-dom';
import { Compass, Search, Library, KeyRound, FolderOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useLibraryMode } from '../contexts/LibraryModeContext';

interface NavItem {
  path: string;
  label: string;
  icon: typeof Compass;
}

const secondaryNav: NavItem[] = [
  { path: '/activate', label: 'Activation', icon: KeyRound },
  { path: '/local', label: 'Fichiers locaux', icon: FolderOpen },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { effectiveMode } = useLibraryMode();
  const currentPath = location.pathname;
  const [collapsed, setCollapsed] = useState(false);

  const mainNav: NavItem[] = effectiveMode === 'online' ? [
    { path: '/tabs', label: 'Accueil', icon: Compass },
    { path: '/search', label: 'Rechercher', icon: Search },
    { path: '/catalog', label: 'Bibliothèque', icon: Library },
  ] : [
    { path: '/catalog', label: 'Ma Musique Hors-ligne', icon: Library },
  ];

  const isActive = (path: string) => {
    if (path === '/tabs') return currentPath === '/tabs';
    return currentPath.startsWith(path);
  };

  const sidebarWidth = collapsed ? 72 : 240;

  return (
    <aside
      style={{
        width: sidebarWidth,
        height: '100%',
        backgroundColor: '#000',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        transition: 'width 0.2s ease',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Logo / Brand */}
      <div
        style={{
          padding: collapsed ? '20px 0' : '24px 20px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 10,
          cursor: 'pointer',
          flexShrink: 0,
        }}
        onClick={() => navigate('/tabs')}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #780000, #520000)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(120,0,0,0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <span style={{ color: '#000', fontSize: 16, fontWeight: 800 }}>P</span>
        </div>
        {!collapsed && (
          <span
            style={{
              color: '#fff',
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: '-0.5px',
              fontFamily: 'var(--font-hanken)',
              whiteSpace: 'nowrap',
              background: 'linear-gradient(90deg, #fff 60%, rgba(255,255,255,0.7))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Pass'io
          </span>
        )}
      </div>

      {/* Collapse button */}
      <button
        onClick={() => setCollapsed(!collapsed)}          style={{
            position: 'absolute',
            top: 24,
            right: collapsed ? '50%' : 8,
            transform: collapsed ? 'translateX(50%)' : 'none',
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid rgba(255,255,255,0.08)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)',
            zIndex: 2,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            opacity: 0.7,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = collapsed ? 'translateX(50%) scale(1.1)' : 'scale(1.1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.transform = collapsed ? 'translateX(50%) scale(1)' : 'scale(1)'; }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', margin: collapsed ? '0 16px' : '0 20px', flexShrink: 0 }} />

      {/* Main Navigation */}
      <nav style={{ padding: collapsed ? '12px 0' : '12px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {mainNav.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 14,
                padding: collapsed ? '14px 0' : '10px 14px',
                borderRadius: 8,
                border: 'none',
                background: active 
                  ? 'linear-gradient(90deg, rgba(120, 0, 0, 0.15) 0%, rgba(120, 0, 0, 0.05) 100%)' 
                  : 'transparent',
                cursor: 'pointer',
                color: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.65)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                width: '100%',
                textAlign: 'left',
                fontFamily: 'var(--font-inter)',
                fontSize: 14,
                fontWeight: active ? 700 : 500,
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = '#fff';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.65)';
                }
              }}
            >
              <Icon size={22} />
              {!collapsed && <span>{item.label}</span>}
              {active && !collapsed && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 3,
                    height: 20,
                    borderRadius: 2,
                    backgroundColor: 'var(--color-accent)',
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', margin: collapsed ? '4px 16px' : '4px 20px', flexShrink: 0 }} />

      {/* Secondary Navigation */}
      <nav style={{ padding: collapsed ? '4px 0' : '4px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {secondaryNav.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 14,
                padding: collapsed ? '14px 0' : '10px 14px',
                borderRadius: 8,
                border: 'none',
                background: active 
                  ? 'linear-gradient(90deg, rgba(120, 0, 0, 0.15) 0%, rgba(120, 0, 0, 0.05) 100%)' 
                  : 'transparent',
                cursor: 'pointer',
                color: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.55)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                width: '100%',
                textAlign: 'left',
                fontFamily: 'var(--font-inter)',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = '#fff';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                }
              }}
            >
              <Icon size={20} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Bottom section - version info */}
      {!collapsed && (
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            Pass'io v1.0
          </span>
        </div>
      )}
    </aside>
  );
}
