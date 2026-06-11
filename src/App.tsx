import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAudioPlayback } from './contexts/AudioContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { BottomPlayer } from './components/BottomPlayer';
import { FullPlayer } from './components/FullPlayer';

// Lazy-loaded pages
const LoadingScreen = React.lazy(() => import('./pages/Loading').then(m => ({ default: m.LoadingScreen })));
const Explorer = React.lazy(() => import('./pages/Explorer').then(m => ({ default: m.ExplorerScreen })));
const Catalog = React.lazy(() => import('./pages/Catalog').then(m => ({ default: m.CatalogScreen })));
const Activate = React.lazy(() => import('./pages/Activate').then(m => ({ default: m.ActivateScreen })));
const Local = React.lazy(() => import('./pages/Local').then(m => ({ default: m.LocalScreen })));
const AlbumDetail = React.lazy(() => import('./pages/AlbumDetail').then(m => ({ default: m.AlbumDetailScreen })));
const ArtistDetail = React.lazy(() => import('./pages/ArtistDetail').then(m => ({ default: m.ArtistDetailScreen })));
const Search = React.lazy(() => import('./pages/Search').then(m => ({ default: m.SearchScreen })));

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="loader-spinner" />
    </div>
  );
}

export function App() {
  const { isFullPlayerVisible } = useAudioPlayback();

  return (
    <AppErrorBoundary>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          backgroundColor: 'var(--color-bg-dark)',
          overflow: 'hidden',
        }}
      >
        {/* Main Area: Sidebar + Content + Right Panel */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Sidebar (hidden on mobile) */}
          <div className="sidebar-desktop">
            <Sidebar />
          </div>

          {/* Main Content Area */}
          <main
            style={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
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
                  <Route path="/tabs" element={<Explorer />} />
                  <Route path="/catalog" element={<Catalog />} />
                  <Route path="/activate" element={<Activate />} />
                  <Route path="/local" element={<Local />} />
                  <Route path="/album/:id" element={<AlbumDetail />} />
                  <Route path="/artist/:id" element={<ArtistDetail />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="*" element={<Navigate to="/tabs" replace />} />
                </Routes>
              </Suspense>
            </div>
          </main>

          {/* Right Now Playing Panel (FullPlayer) */}
          {isFullPlayerVisible && <FullPlayer />}
        </div>

        {/* Mobile Navigation Pill (shown only on mobile) */}
        <div className="mobile-nav-wrapper">
          <MobileNav />
        </div>

        {/* Bottom Player Bar */}
        <BottomPlayer />
      </div>
    </AppErrorBoundary>
  );
}
