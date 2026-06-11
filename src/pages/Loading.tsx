import React, { useEffect, useState, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { logger } from '@/utils/logger';

export function LoadingScreen() {
  const { loadLibrary, isLibraryLoaded } = useAudioPlayback();
  const [canContinue, setCanContinue] = useState(isLibraryLoaded);
  const [opacity, setOpacity] = useState(0);
  const [scale, setScale] = useState(0.9);

  useEffect(() => {
    const t1 = setTimeout(() => setOpacity(1), 50);
    const t2 = setTimeout(() => setScale(1), 50);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (isLibraryLoaded) { setCanContinue(true); return; }
    let mounted = true;
    void loadLibrary()
      .catch((err) => logger.error('LoadingScreen', 'Échec chargement bibliothèque', err))
      .finally(() => { if (mounted) setCanContinue(true); });
    return () => { mounted = false; };
  }, [isLibraryLoaded, loadLibrary]);

  if (canContinue) return <Navigate to="/tabs" replace />;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100%',
      background: 'linear-gradient(180deg, #0a0a0c, #000, #000)',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 22,
        opacity,
        transform: `scale(${scale})`,
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            position: 'absolute', inset: -10, borderRadius: 32,
            backgroundColor: 'rgba(120,0,0,0.15)',
          }} />
          <img
            src="/assets/images/passio-icon-round.png"
            alt="Pass'io"
            style={{ width: 88, height: 88, borderRadius: 22 }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </div>
        <h1 style={{
          color: '#fff', fontSize: 22, fontWeight: 800,
          letterSpacing: 4, margin: 0,
          fontFamily: "var(--font-inter)",
        }}>
          PASS'IO
        </h1>
        <div className="loader-spinner" style={{ opacity: 0.85 }} />
      </div>
    </div>
  );
}
