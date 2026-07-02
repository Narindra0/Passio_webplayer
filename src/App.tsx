import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAudioPlayback } from './contexts/AudioContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { BottomPlayer } from './components/BottomPlayer';
import { ArtistLookupProvider } from './contexts/ArtistLookupContext';
import { LayoutProvider } from './contexts/LayoutContext';

// Lazy-loaded pages
const LoadingScreen = React.lazy(() => import('./pages/Loading').then(m => ({ default: m.LoadingScreen })));
const Explorer = React.lazy(() => import('./pages/Explorer').then(m => ({ default: m.ExplorerScreen })));
const Catalog = React.lazy(() => import('./pages/Catalog').then(m => ({ default: m.CatalogScreen })));
const Activate = React.lazy(() => import('./pages/Activate').then(m => ({ default: m.ActivateScreen })));
const Local = React.lazy(() => import('./pages/Local').then(m => ({ default: m.LocalScreen })));
const AlbumDetail = React.lazy(() => import('./pages/AlbumDetail').then(m => ({ default: m.AlbumDetailScreen })));
const ArtistDetail = React.lazy(() => import('./pages/ArtistDetail').then(m => ({ default: m.ArtistDetailScreen })));
const Search = React.lazy(() => import('./pages/Search').then(m => ({ default: m.SearchScreen })));
const Tracks = React.lazy(() => import('./pages/Tracks').then(m => ({ default: m.TracksScreen })));
const Artists = React.lazy(() => import('./pages/Artists').then(m => ({ default: m.ArtistsScreen })));
const Discover = React.lazy(() => import('./pages/Discover').then(m => ({ default: m.DiscoverScreen })));

// Lazy-load FullPlayer (gros composant, seulement affiché quand on écoute de la musique)
const FullPlayer = React.lazy(() => import('./components/FullPlayer').then(m => ({ default: m.FullPlayer })));

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="loader-spinner" />
    </div>
  );
}

export function App() {
  const { isFullPlayerVisible } = useAudioPlayback();

  // 🔒 Protection anti-exfiltration : bloque le clic droit, le drag & drop
  //    et le copier-coller sur l'ensemble de l'application pour décourager
  //    l'extraction de contenu (titres, artistes, URLs de flux).
  //    Ne bloque pas la saisie dans les champs de texte (input/textarea).
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Autoriser le clic droit sur les champs de formulaire (pratique)
      const target = e.target as HTMLElement;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
    };

    const handleDragStart = (e: DragEvent) => {
      // Autoriser le drag sur les champs de formulaire (sélection de texte)
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
          // dvh = Dynamic Viewport Height: accounts for retractable browser UI on mobile
          // Falls back to 100vh on older browsers
          ...(CSS.supports('height', '100dvh') ? { height: '100dvh' } : {}),
          backgroundColor: 'var(--color-bg-dark)',
          overflow: 'hidden',
        }}
      >
        {/* Main Area: Sidebar + Content + Right Panel */}
        <div className="bento-layout-row">
          {/* Left Sidebar (hidden on mobile) */}
          <div className="sidebar-desktop bento-sidebar">
            <Sidebar />
          </div>

          {/* Main Content Area */}
          <main className="bento-main">
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                overflowX: 'hidden',
              }}
            >
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<LoadingScreen />} />
                  <Route path="/discover" element={<Discover />} />
                  <Route path="/catalog" element={<Catalog />} />
                  <Route path="/activate" element={<Activate />} />
                  <Route path="/local" element={<Local />} />
                  <Route path="/album/:id" element={<AlbumDetail />} />
                  <Route path="/artist/:id" element={<ArtistDetail />} />
                  <Route path="/artists" element={<Artists />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/tracks" element={<Tracks />} />
                  <Route path="*" element={<Navigate to="/discover" replace />} />
                </Routes>
              </Suspense>
            </div>
          </main>

          {/* Right Now Playing Panel (FullPlayer) */}
          {isFullPlayerVisible && (
            <div className="bento-player-wrapper">
              <Suspense fallback={null}>
                <FullPlayer />
              </Suspense>
            </div>
          )}
        </div>

        {/* Mobile Navigation Pill (shown only on mobile) */}
        <div className="mobile-nav-wrapper">
          <MobileNav />
        </div>

        {/* Bottom Player Bar */}
        <BottomPlayer />
      </div>
      </ArtistLookupProvider>
      </LayoutProvider>
    </AppErrorBoundary>
  );
}
