import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAudioPlayback } from './contexts/AudioContext';
import { useLibraryMode } from './contexts/LibraryModeContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { BottomPlayer } from './components/BottomPlayer';
import { OfflinePlayer } from './components/OfflinePlayer';
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
import { TopScreen } from './pages/Top';
import { FullPlayer } from './components/FullPlayer';
import { ConsentBanner } from './components/ConsentBanner';
import { ConsentSettings } from './components/ConsentSettings';

export function App() {
  const { isFullPlayerVisible } = useAudioPlayback();
  const { effectiveMode } = useLibraryMode();

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
              /* ⚡ Mode hors-ligne : lecteur minimaliste dédié */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <OfflinePlayer />
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
                      <Route path="/top" element={<TopScreen />} />
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
                    <FullPlayer />
                  </div>
                )}
              </div>
            )}

            {/* Navigation mobile et player + bannière RGPD — masqués en mode hors-ligne */}
            {effectiveMode !== 'offline' && (
              <>
                <div className="mobile-nav-wrapper">
                  <MobileNav />
                </div>
                <BottomPlayer />
                <ConsentBanner />
              </>
            )}
          </div>
        </ArtistLookupProvider>
      </LayoutProvider>
    </AppErrorBoundary>
  );
}
