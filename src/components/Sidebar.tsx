import { ChevronLeft, ChevronRight, Compass, FolderOpen, KeyRound, Library, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
      {/* Logo / Brand */}
      <div
        onClick={() => navigate('/discover')}
        style={{
          padding: collapsed ? '24px 0 16px' : '24px 24px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 12,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 12px rgba(220,20,60,0.3)',
          }}
        >
          <span style={{ color: '#fff', fontSize: 16, fontWeight: 900 }}>P</span>
        </div>
        {!collapsed && (
          <span
            style={{
              color: 'var(--color-text-primary)',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '-0.3px',
              whiteSpace: 'nowrap',
            }}
          >
            Pass'io
          </span>
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
              <Icon size={22} style={{ flexShrink: 0 }} />
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
              <Icon size={20} style={{ flexShrink: 0 }} />
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
