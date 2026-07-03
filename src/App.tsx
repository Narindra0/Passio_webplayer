import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAudioPlayback } from './contexts/AudioContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { BottomPlayer } from './components/BottomPlayer';
import { ArtistLookupProvider } from './contexts/ArtistLookupContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { LoadingScreen } from './pages/Loading';
import { CatalogScreen } from './pages/Catalog';
import { ActivateScreen } from './pages/Activate';
import { LocalScreen } from './pages/Local';
import { AlbumDetailScreen } from './pages/AlbumDetail';
import { ArtistDetailScreen } from './pages/ArtistDetail';
import { SearchScreen } from './pages/Search';
import { TracksScreen } from './pages/Tracks';
import { ArtistsScreen } from './pages/Artists';
import { DiscoverScreen } from './pages/Discover';
import { FullPlayer } from './components/FullPlayer';

export function App() {
  const { isFullPlayerVisible } = useAudioPlayback();

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
                    <Route path="/" element={<LoadingScreen />} />
                    <Route path="/discover" element={<DiscoverScreen />} />
                    <Route path="/catalog" element={<CatalogScreen />} />
                    <Route path="/activate" element={<ActivateScreen />} />
                    <Route path="/local" element={<LocalScreen />} />
                    <Route path="/album/:id" element={<AlbumDetailScreen />} />
                    <Route path="/artist/:id" element={<ArtistDetailScreen />} />
                    <Route path="/artists" element={<ArtistsScreen />} />
                    <Route path="/search" element={<SearchScreen />} />
                    <Route path="/tracks" element={<TracksScreen />} />
                    <Route path="*" element={<Navigate to="/discover" replace />} />
                  </Routes>
                </div>
              </main>

              {isFullPlayerVisible && (
                <div className="bento-player-wrapper">
                  <FullPlayer />
                </div>
              )}
            </div>

            <div className="mobile-nav-wrapper">
              <MobileNav />
            </div>

            <BottomPlayer />
          </div>
        </ArtistLookupProvider>
      </LayoutProvider>
    </AppErrorBoundary>
  );
}
