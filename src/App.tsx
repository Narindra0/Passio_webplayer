import React, { Suspense, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAudioPlayback } from './contexts/AudioContext';
import { useLibraryMode } from './contexts/LibraryModeContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { BottomPlayer } from './components/BottomPlayer';
import { OfflinePlayer } from './components/OfflinePlayer';
import { ArtistLookupProvider } from './contexts/ArtistLookupContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { ConsentBanner } from './components/ConsentBanner';
import { ConsentSettings } from './components/ConsentSettings';
import { recordPageView, recordDeviceInfo } from '@/services/streamTracker';
import { useConsent } from '@/hooks/useConsent';

import { lazyWithRetry } from '@/utils/lazyWithRetry';

// ⚡ Lazy loading des pages — chargées uniquement quand l'utilisateur navigue dessus
// lazyWithRetry recharge la page automatiquement si un chunk est introuvable (stale hash).
const LoadingScreen = lazyWithRetry(() => import('./pages/Loading').then(m => ({ default: m.LoadingScreen })));
const CatalogScreen = lazyWithRetry(() => import('./pages/Catalog').then(m => ({ default: m.CatalogScreen })));
const ActivateScreen = lazyWithRetry(() => import('./pages/Activate').then(m => ({ default: m.ActivateScreen })));
const LocalScreen = lazyWithRetry(() => import('./pages/Local').then(m => ({ default: m.LocalScreen })));
const AlbumDetailScreen = lazyWithRetry(() => import('./pages/AlbumDetail').then(m => ({ default: m.AlbumDetailScreen })));
const ArtistDetailScreen = lazyWithRetry(() => import('./pages/ArtistDetail').then(m => ({ default: m.ArtistDetailScreen })));
const ArtistDiscographyScreen = lazyWithRetry(() => import('./pages/ArtistDiscography').then(m => ({ default: m.ArtistDiscographyScreen })));
const SearchScreen = lazyWithRetry(() => import('./pages/Search').then(m => ({ default: m.SearchScreen })));
const TracksScreen = lazyWithRetry(() => import('./pages/Tracks').then(m => ({ default: m.TracksScreen })));
const ArtistsScreen = lazyWithRetry(() => import('./pages/Artists').then(m => ({ default: m.ArtistsScreen })));
const DiscoverScreen = lazyWithRetry(() => import('./pages/Discover').then(m => ({ default: m.DiscoverScreen })));
const TopScreen = lazyWithRetry(() => import('./pages/Top').then(m => ({ default: m.TopScreen })));
const FullPlayer = lazyWithRetry(() => import('./components/FullPlayer').then(m => ({ default: m.FullPlayer })));

// ⚡ Fallback de chargement pour les pages lazy (spinner minimal)
function PageFallback() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 300,
      width: '100%',
    }}>
      <div className="loader-spinner" />
    </div>
  );
}

export function App() {
  const location = useLocation();
  const { isFullPlayerVisible } = useAudioPlayback();
  const { effectiveMode, transitionMessage } = useLibraryMode();
  const { allowed: consentAllowed } = useConsent();
  const lastPathRef = useRef<string>('');
  const deviceInfoSentRef = useRef(false);

  // 🎯 V2 Page views : une seule fois par navigation (pathname uniquement, pas de query params)
  useEffect(() => {
    if (effectiveMode === 'offline') return;
    if (location.pathname === lastPathRef.current) return;
    lastPathRef.current = location.pathname;
    recordPageView(location.pathname);
  }, [location.pathname, effectiveMode]);

  // 🎯 V2 Device info : une seule fois par session, au premier consentement accordé
  useEffect(() => {
    if (consentAllowed && !deviceInfoSentRef.current) {
      deviceInfoSentRef.current = true;
      recordDeviceInfo();
    } else if (!consentAllowed) {
      deviceInfoSentRef.current = false;
    }
  }, [consentAllowed]);

  // Protection anti-exfiltration : bloque le clic droit, le drag & drop
  // et le copier-coller sur l'ensemble de l'application.
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
    };

    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
    };

    const handleCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

  return (
    <AppErrorBoundary>
      <LayoutProvider>
        <ArtistLookupProvider>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100vh',
              ...(CSS.supports('height', '100dvh') ? { height: '100dvh' } : {}),
              backgroundColor: 'var(--color-bg-dark)',
              overflow: 'hidden',
            }}
          >
            {effectiveMode === 'offline' ? (
              /* ⚡ Mode hors-ligne : lecteur minimaliste + routes limitées */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Routes>
                  <Route path="/album/:id" element={<AlbumDetailScreen />} />
                  <Route path="*" element={<OfflinePlayer />} />
                </Routes>
              </div>
            ) : (
              <div className="bento-layout-row">
                <div className="sidebar-desktop bento-sidebar">
                  <Sidebar />
                </div>

                <main className="bento-main">
                  <div
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      overflowX: 'hidden',
                    }}
                  >
                    <Routes>
                      <Route path="/" element={<Suspense fallback={<PageFallback />}><LoadingScreen /></Suspense>} />
                      <Route path="/discover" element={<Suspense fallback={<PageFallback />}><DiscoverScreen /></Suspense>} />
                      <Route path="/catalog" element={<Suspense fallback={<PageFallback />}><CatalogScreen /></Suspense>} />
                      <Route path="/activate" element={<Suspense fallback={<PageFallback />}><ActivateScreen /></Suspense>} />
                      <Route path="/local" element={<Suspense fallback={<PageFallback />}><LocalScreen /></Suspense>} />
                      <Route path="/album/:id" element={<Suspense fallback={<PageFallback />}><AlbumDetailScreen /></Suspense>} />
                      <Route path="/artist/:id" element={<Suspense fallback={<PageFallback />}><ArtistDetailScreen /></Suspense>} />
                      <Route path="/artist/:id/discography" element={<Suspense fallback={<PageFallback />}><ArtistDiscographyScreen /></Suspense>} />
                      <Route path="/artists" element={<Suspense fallback={<PageFallback />}><ArtistsScreen /></Suspense>} />
                      <Route path="/search" element={<Suspense fallback={<PageFallback />}><SearchScreen /></Suspense>} />
                      <Route path="/tracks" element={<Suspense fallback={<PageFallback />}><TracksScreen /></Suspense>} />
                      <Route path="/top" element={<Suspense fallback={<PageFallback />}><TopScreen /></Suspense>} />
                      <Route path="/offline" element={<Suspense fallback={<PageFallback />}><OfflinePlayer /></Suspense>} />
                      <Route path="/privacy" element={
                        <div className="screen">
                          <div className="screen-inner" style={{ padding: 'var(--page-padding)', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 48 }}>
                            <div style={{ width: '100%', maxWidth: 520, marginBottom: 32 }}>
                              <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 8, letterSpacing: '-0.5px' }}>Confidentialité</h1>
                              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                Gérez vos préférences de collecte de données d'écoute.
                              </p>
                            </div>
                            <ConsentSettings />
                          </div>
                        </div>
                      } />
                      <Route path="*" element={<Navigate to="/discover" replace />} />
                    </Routes>
                  </div>
                </main>

                {isFullPlayerVisible && (
                  <div className="bento-player-wrapper">
                    <Suspense fallback={null}>
                      <FullPlayer />
                    </Suspense>
                  </div>
                )}
              </div>
            )}

            {/* Navigation mobile et player + bannière RGPD — masqués en mode hors-ligne
                et sur la page Hors-ligne /offline (l'OfflinePlayer a son propre player intégré) */}
            {effectiveMode !== 'offline' && !location.pathname.startsWith('/offline') && (
              <>
                <div className="mobile-nav-wrapper">
                  <MobileNav />
                </div>
                <BottomPlayer />
                <ConsentBanner />
              </>
            )}

            {/* ⚡ Toast de transition réseau (toujours visible, quel que soit le mode) */}
            {transitionMessage && (
              <div
                style={{
                  position: 'fixed',
                  bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 10002,
                  padding: '10px 22px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border-subtle)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  animation: 'fadeIn 0.25s ease',
                }}
              >
                {transitionMessage}
              </div>
            )}
          </div>
        </ArtistLookupProvider>
      </LayoutProvider>
    </AppErrorBoundary>
  );
}
