import { ChevronLeft, ChevronRight, Compass, FolderOpen, KeyRound, Library, Search, Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLibraryMode } from '../contexts/LibraryModeContext';
import { useLayout } from '../contexts/LayoutContext';

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
  const { isSidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed } = useLayout();
  const currentPath = location.pathname;

  const mainNav: NavItem[] = effectiveMode === 'online' ? [
    { path: '/discover', label: 'Découvertes', icon: Sparkles },
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
        backgroundColor: 'var(--color-bg-dark)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        transition: 'width var(--transition-normal) ease',
        position: 'relative',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {/* Logo / Brand — Logo officiel */}
      <div
        onClick={() => navigate('/discover')}
        style={{
          padding: collapsed ? '20px 0 16px' : '20px 20px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'padding var(--transition-normal) ease',
        }}
      >
        {collapsed ? (
          <img
            src="https://i.ibb.co/LDJ2Vcrr/Logo-2.png"
            alt="Pass'io"
            style={{
              width: 32,
              height: 32,
              objectFit: 'contain',
              filter: 'brightness(0) invert(1)',
              flexShrink: 0,
            }}
          />
        ) : (
          <img
            src="https://i.ibb.co/xtfzgz67/Logo.png"
            alt="Pass'io"
            style={{
              height: 32,
              width: 'auto',
              maxWidth: 180,
              objectFit: 'contain',
              filter: 'brightness(0) invert(1)',
            }}
          />
        )}
      </div>

      {/* Main Navigation */}
      <nav style={{
        padding: collapsed ? '8px 0' : '8px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        {mainNav.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`sidebar-nav-btn${active ? ' active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 14,
                padding: collapsed ? '12px 0' : '10px 16px',
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--color-surface-elevated)' : 'transparent',
                cursor: 'pointer',
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                transition: 'all var(--transition-fast) ease',
                width: '100%',
                textAlign: 'left',
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                border: 'none',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }
              }}
            >
              <span className="nav-icon-wrapper">
                <Icon size={22} />
              </span>
              {!collapsed && item.label}
            </button>
          );
        })}
      </nav>

      {/* Divider */}
      {!collapsed && (
        <div style={{
          height: 1,
          backgroundColor: 'var(--color-border-subtle)',
          margin: '8px 24px',
          flexShrink: 0,
        }} />
      )}

      {/* Secondary Navigation */}
      <nav style={{
        padding: collapsed ? '4px 0' : '4px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        {secondaryNav.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`sidebar-nav-btn${active ? ' active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 14,
                padding: collapsed ? '12px 0' : '10px 16px',
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--color-surface-elevated)' : 'transparent',
                cursor: 'pointer',
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                transition: 'all var(--transition-fast) ease',
                width: '100%',
                textAlign: 'left',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                border: 'none',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                }
              }}
            >
              <span className="nav-icon-wrapper">
                <Icon size={20} />
              </span>
              {!collapsed && item.label}
            </button>
          );
        })}
      </nav>

      {/* Collapse button */}
      <div style={{ flex: 1 }} />
      <div style={{
        padding: collapsed ? '12px 0' : '8px 8px',
        flexShrink: 0,
        display: 'flex',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-full)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-muted)',
            transition: 'all var(--transition-fast) ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--color-text-primary)';
            e.currentTarget.style.background = 'var(--color-surface-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-text-muted)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
