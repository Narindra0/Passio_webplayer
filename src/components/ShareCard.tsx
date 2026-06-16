import html2canvas from 'html2canvas';
import { Copy, Download, Share2, X, Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface ShareCardProps {
  visible: boolean;
  onClose: () => void;
  trackTitle: string;
  artistName: string;
  albumTitle?: string;
  coverUri: string | null | undefined;
  albumId?: string;
}

// ──────────────────────────────────────────────
//  Color helpers
// ──────────────────────────────────────────────

function clamp(v: number): number { return Math.max(0, Math.min(255, Math.round(v))); }

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('');
}

function adjustBrightness(r: number, g: number, b: number, factor: number) {
  return { r: r * factor, g: g * factor, b: b * factor };
}

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function sampleDominantColor(img: HTMLImageElement): { r: number; g: number; b: number } | null {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.drawImage(img, 0, 0, 64, 64);
  const data = cx.getImageData(0, 0, 64, 64).data;
  let tr = 0, tg = 0, tb = 0;
  for (let i = 0; i < data.length; i += 4) {
    tr += data[i];
    tg += data[i + 1];
    tb += data[i + 2];
  }
  const n = data.length / 4;
  return { r: tr / n, g: tg / n, b: tb / n };
}

function derivePalette(dc: { r: number; g: number; b: number }) {
  const isDark = luminance(dc.r, dc.g, dc.b) < 0.5;
  const vibrant = {
    r: isDark ? dc.r : Math.min(255, dc.r * 1.4),
    g: isDark ? Math.min(255, dc.g * 0.8) : Math.min(255, dc.g * 0.5),
    b: isDark ? Math.min(255, dc.b * 0.9) : Math.min(255, dc.b * 0.4),
  };
  const muted = adjustBrightness(dc.r, dc.g, dc.b, 0.55);
  const dark = adjustBrightness(dc.r, dc.g, dc.b, 0.12);
  return {
    accent: toHex(vibrant.r, vibrant.g, vibrant.b),
    gradTop: toHex(Math.min(255, dc.r * 0.55), Math.min(255, dc.g * 0.2), Math.min(255, dc.b * 0.2)),
    gradMid: toHex(muted.r * 0.4, muted.g * 0.4, muted.b * 0.4),
    gradBot: toHex(dark.r, dark.g, dark.b),
  };
}

// ──────────────────────────────────────────────
//  Story Canvas — DOM template for html2canvas
// ──────────────────────────────────────────────

interface StoryCanvasProps {
  trackTitle: string;
  artistName: string;
  albumTitle?: string;
  coverUri: string | null | undefined;
  palette: { accent: string; gradTop: string; gradMid: string; gradBot: string };
}

function StoryCanvas({ trackTitle, artistName, albumTitle, coverUri, palette }: StoryCanvasProps) {
  const cover = coverUri || '';
  const { accent, gradTop, gradMid, gradBot } = palette;

  return (
    <div
      id="share-story-canvas"
      style={{
        position: 'relative',
        width: 540,
        height: 960,
        overflow: 'hidden',
        background: `linear-gradient(155deg, ${gradTop} 0%, ${gradMid} 50%, ${gradBot} 100%)`,
        fontFamily: "'Plus Jakarta Sans', 'Hanken Grotesk', 'Inter', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '40px 32px',
        boxSizing: 'border-box',
        borderRadius: 0,
      }}
    >
      {/* Blurred cover background */}
      {cover && (
        <img
          src={cover}
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.28,
            filter: 'blur(36px)',
            transform: 'scale(1.15)',
            pointerEvents: 'none',
          }}
          alt=""
        />
      )}

      {/* Dark overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        pointerEvents: 'none',
      }} />

      {/* HEADER */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28,
            borderRadius: '50%',
            background: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M9 18V5l12-2v13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="6" cy="18" r="3" fill="white"/>
              <circle cx="18" cy="16" r="3" fill="white"/>
            </svg>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.6)',
          }}>
            EN CE MOMENT SUR PASS'IO
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 28, height: 3, borderRadius: 2,
              background: i === 1 ? accent : 'rgba(255,255,255,0.25)',
            }} />
          ))}
        </div>
      </div>

      {/* MUSIC CARD */}
      <div style={{
        position: 'relative', zIndex: 10,
        flex: 1, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        marginTop: 24, marginBottom: 24,
      }}>
        <div style={{
          width: '100%',
          background: 'rgba(18, 18, 24, 0.78)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 24,
          padding: '28px 24px',
          boxSizing: 'border-box',
          boxShadow: '0 20px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}>
          <div style={{
            width: '100%', aspectRatio: '1/1',
            borderRadius: 16, overflow: 'hidden', marginBottom: 22,
            boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
            background: '#1a1a1a',
          }}>
            {cover ? (
              <img
                src={cover} crossOrigin="anonymous"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                alt={trackTitle}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64, color: 'rgba(255,255,255,0.15)' }}>
                ♪
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {trackTitle}
              </h3>
              <p style={{ margin: '6px 0 0', fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {artistName}
              </p>
              {albumTitle && (
                <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 400, color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {albumTitle}
                </p>
              )}
            </div>
            <svg width="22" height="20" viewBox="0 0 24 22" fill={accent} style={{ flexShrink: 0, marginTop: 2 }}>
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 40,
          padding: '12px 24px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: `0 2px 12px ${accent}66`,
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="white">
              <path d="M3 2l7 4-7 4V2z" fill="white"/>
            </svg>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#fff' }}>
            ÉCOUTER SUR PASS'IO
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Scannez ou faites glisser pour écouter
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
//  Social SVG Icons
// ──────────────────────────────────────────────

function InstagramIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/>
    </svg>
  );
}

function FacebookIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

function WhatsAppIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

function XIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

function MessengerIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 4.975 0 11.111c0 3.497 1.745 6.616 4.472 8.652V24l4.086-2.242c1.09.301 2.246.464 3.442.464 6.627 0 12-4.974 12-11.111C24 4.975 18.627 0 12 0zm1.193 14.963l-3.056-3.259-5.963 3.259L10.732 8.37l3.131 3.259L19.752 8.37l-6.559 6.593z"/>
    </svg>
  );
}

// ──────────────────────────────────────────────
//  Main Component
// ──────────────────────────────────────────────

export function ShareCard({
  visible,
  onClose,
  trackTitle,
  artistName,
  albumTitle,
  coverUri,
  albumId,
}: ShareCardProps) {
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const [palette, setPalette] = useState({
    accent: '#DC143C',
    gradTop: '#4c0519',
    gradMid: '#1a0a0f',
    gradBot: '#090514',
  });
  const isMobile = useMediaQuery('(max-width: 768px)');
  const imageUrlRef = useRef<string | null>(null);

  // ── Platform availability ──
  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const shareUrl = albumId
    ? `${window.location.origin}/album/${albumId}`
    : typeof window !== 'undefined' ? window.location.href : '';

  // ── Extract palette from cover ──
  const extractPalette = useCallback(async () => {
    if (!coverUri) return;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej();
        img.src = coverUri;
      });
      const dc = sampleDominantColor(img);
      if (dc) {
        setPalette(derivePalette(dc));
      }
    } catch { /* keep default */ }
  }, [coverUri]);

  // ── Generate image ──
  const generateImage = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 400));
      const node = document.getElementById('share-story-canvas');
      if (!node) throw new Error('Canvas DOM node not found');
      const canvas = await (html2canvas as Function)(node, {
        useCORS: true,
        allowTaint: false,
        scale: 2,
        backgroundColor: null,
        logging: false,
        imageTimeout: 10000,
        foreignObjectRendering: false,
        onclone: (clonedDoc: Document) => {
          const cloned = clonedDoc.getElementById('share-story-canvas');
          if (cloned) {
            cloned.style.setProperty('visibility', 'visible');
            cloned.style.setProperty('opacity', '1');
          }
        },
      });
      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob((b: Blob | null) => resolve(b), 'image/png', 0.92)
      );
      if (!blob) throw new Error("Impossible de générer l'image");
      setImageBlob(blob);
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      const url = URL.createObjectURL(blob);
      imageUrlRef.current = url;
      setImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de génération');
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // ── Lifecycle ──
  useEffect(() => {
    if (!visible) {
      if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null; }
      setImageUrl(null); setImageBlob(null); setError(null); setToast({ message: '', visible: false });
      return;
    }
    extractPalette().then(() => generateImage());
    return () => {
      if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null; }
    };
  }, [visible, extractPalette, generateImage]);

  // ── Toast helper ──
  const showToast = (msg: string) => {
    setToast({ message: msg, visible: true });
    setTimeout(() => setToast({ message: '', visible: false }), 2500);
  };

  // ── Generate share text ──
  const getShareText = () =>
    `J'écoute « ${trackTitle} » par ${artistName} sur Pass'io 🎵`;

  const shareTitle = `${trackTitle} — ${artistName}`;

  // ── Share via native API (ouvre la feuille de partage du téléphone) ──
  const handleShare = async () => {
    if (!imageBlob) return;
    const fileName = `passio-${trackTitle.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    const file = new File([imageBlob], fileName, { type: 'image/png' });
    try {
      // Tentative avec l'image (pour stories, posts, messages)
      await navigator.share({ title: shareTitle, text: getShareText(), url: shareUrl, files: [file] });
      showToast('Partagé avec succès !');
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        // Fallback: partage sans fichier (texte seul)
        try {
          await navigator.share({ title: shareTitle, text: getShareText(), url: shareUrl });
          showToast('Partagé !');
        } catch { /* ignore */ }
      }
    }
  };

  // ── Download ──
  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `passio-${trackTitle.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Image téléchargée !');
  };

  // ── Copy to clipboard ──
  const handleCopyImage = async () => {
    if (!imageBlob) return;
    try {
      if (navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })]);
        showToast('Image copiée !');
        return;
      }
      handleDownload();
    } catch {
      handleDownload();
    }
  };

  // ── Platform buttons config ──
  interface PlatformButton {
    label: string;
    icon: React.ReactNode;
    color: string;
  }

  const platforms: PlatformButton[] = [
    {
      label: 'Instagram',
      icon: <InstagramIcon size={22} />,
      color: '#E4405F',
    },
    {
      label: 'Facebook',
      icon: <FacebookIcon size={22} />,
      color: '#1877F2',
    },
    {
      label: 'WhatsApp',
      icon: <WhatsAppIcon size={22} />,
      color: '#25D366',
    },
    {
      label: 'Messenger',
      icon: <MessengerIcon size={22} />,
      color: '#006AFF',
    },
    {
      label: 'X (Twitter)',
      icon: <XIcon size={18} />,
      color: '#000',
    },
  ];

  // ── Render ──
  if (!visible) return null;

  return (
    <>
      {/* Off-screen template for html2canvas */}
      <div
        style={{
          position: 'fixed', top: 0, left: '-9999px',
          zIndex: -1, pointerEvents: 'none',
        }}
      >
        <StoryCanvas
          trackTitle={trackTitle}
          artistName={artistName}
          albumTitle={albumTitle}
          coverUri={coverUri}
          palette={palette}
        />
      </div>

      {/* Modal */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.88)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          zIndex: 10002,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.2s ease',
          overflowY: 'auto',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: isMobile ? 16 : 24,
            maxWidth: isMobile ? '100%' : 480,
            width: '100%',
            padding: isMobile ? '20px 16px 32px' : '28px 32px 36px',
            maxHeight: '100dvh',
            overflowY: 'auto',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            width: '100%',
          }}>
            <div>
              <p style={{ margin: 0, fontSize: isMobile ? 20 : 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>
                Partager
              </p>
              <p style={{ margin: '4px 0 0', fontSize: isMobile ? 13 : 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.3 }}>
                {trackTitle}
                <span style={{ color: 'rgba(255,255,255,0.25)' }}> · </span>
                {artistName}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 36, height: 36, borderRadius: '50%',
                border: 'none', background: 'rgba(255,255,255,0.08)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', transition: 'all 0.2s ease', flexShrink: 0, marginTop: 2,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Preview area */}
          <div style={{
            width: '100%',
            maxWidth: isMobile ? 280 : 320,
            aspectRatio: '9/16',
            borderRadius: isMobile ? 16 : 20,
            overflow: 'hidden',
            background: '#111',
            boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
            flexShrink: 0,
          }}>
            {isGenerating && (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <div className="loader-spinner" style={{
                  width: 32, height: 32, borderWidth: 3,
                  borderColor: 'rgba(255,255,255,0.12)', borderTopColor: palette.accent,
                  margin: '0 auto 12px',
                }} />
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>
                  Génération de l'image…
                </p>
                <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, margin: '6px 0 0' }}>
                  Préparez votre story
                </p>
              </div>
            )}
            {error && !isGenerating && (
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, padding: 24, textAlign: 'center' }}>
                {error}
              </p>
            )}
            {imageUrl && !isGenerating && (
              <img
                src={imageUrl}
                alt="Aperçu partage"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            )}
          </div>

          {/* Label */}
          {!isGenerating && !error && (
            <p style={{
              margin: 0, fontSize: isMobile ? 11 : 12,
              color: 'rgba(255,255,255,0.35)',
              textAlign: 'center',
              lineHeight: 1.4,
              maxWidth: 320,
            }}>
              Partagez cette story sur vos réseaux préférés
            </p>
          )}

          {/* Platform buttons — ouvrent la feuille de partage native du téléphone */}
          {canNativeShare && !isGenerating && !error && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 6,
              width: '100%',
              maxWidth: 400,
            }}>
              {platforms.map((p) => (
                <button
                  key={p.label}
                  onClick={() => void handleShare()}
                  disabled={!imageBlob}
                  style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 4,
                    padding: isMobile ? '12px 4px' : '14px 6px',
                    borderRadius: 14,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    cursor: imageBlob ? 'pointer' : 'default',
                    color: p.color,
                    opacity: imageBlob ? 1 : 0.3,
                    transition: 'all 0.2s ease',
                    minWidth: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (imageBlob) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.10)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  {p.icon}
                  <span style={{
                    fontSize: isMobile ? 10 : 11,
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.75)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '100%',
                  }}>
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Action buttons row */}
          <div style={{
            display: 'flex', gap: 10,
            width: '100%', maxWidth: 400,
          }}>
            {/* Copy */}
            <button
              onClick={() => void handleCopyImage()}
              disabled={!imageUrl || isGenerating}
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: isMobile ? '13px 10px' : '14px 16px',
                borderRadius: 40,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.14)',
                color: '#fff', fontSize: isMobile ? 13 : 14, fontWeight: 700,
                cursor: imageUrl && !isGenerating ? 'pointer' : 'default',
                opacity: imageUrl && !isGenerating ? 1 : 0.4,
                transition: 'all 0.18s ease',
              }}
              onMouseEnter={(e) => { if (imageUrl && !isGenerating) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Copy size={15} />
              Copier
            </button>

            {/* Native share or Download */}
            {canNativeShare ? (
              <button
                onClick={() => void handleShare()}
                disabled={!imageUrl || isGenerating}
                style={{
                  flex: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: isMobile ? '13px 10px' : '14px 16px',
                  borderRadius: 40,
                  background: `linear-gradient(135deg, ${palette.accent}, #C62828)`,
                  color: '#fff', fontSize: isMobile ? 13 : 14, fontWeight: 700, border: 'none',
                  cursor: imageUrl && !isGenerating ? 'pointer' : 'default',
                  opacity: imageUrl && !isGenerating ? 1 : 0.4,
                  transition: 'all 0.2s ease',
                  boxShadow: imageUrl && !isGenerating ? `0 4px 20px ${palette.accent}55` : 'none',
                }}
                onMouseEnter={(e) => { if (imageUrl && !isGenerating) e.currentTarget.style.transform = 'scale(1.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <Share2 size={16} />
                {isMobile ? 'Partager' : 'Tout partager'}
              </button>
            ) : (
              <button
                onClick={handleDownload}
                disabled={!imageUrl || isGenerating}
                style={{
                  flex: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: isMobile ? '13px 10px' : '14px 16px',
                  borderRadius: 40,
                  background: `linear-gradient(135deg, ${palette.accent}, #C62828)`,
                  color: '#fff', fontSize: isMobile ? 13 : 14, fontWeight: 700, border: 'none',
                  cursor: imageUrl && !isGenerating ? 'pointer' : 'default',
                  opacity: imageUrl && !isGenerating ? 1 : 0.4,
                  transition: 'all 0.2s ease',
                  boxShadow: imageUrl && !isGenerating ? `0 4px 20px ${palette.accent}55` : 'none',
                }}
                onMouseEnter={(e) => { if (imageUrl && !isGenerating) e.currentTarget.style.transform = 'scale(1.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <Download size={16} />
                Télécharger
              </button>
            )}

            {/* Download (third button) */}
            {canNativeShare && (
              <button
                onClick={handleDownload}
                disabled={!imageUrl || isGenerating}
                style={{
                  flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: isMobile ? '13px 10px' : '14px 16px',
                  borderRadius: 40,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: '#fff', fontSize: isMobile ? 13 : 14, fontWeight: 700,
                  cursor: imageUrl && !isGenerating ? 'pointer' : 'default',
                  opacity: imageUrl && !isGenerating ? 1 : 0.4,
                  transition: 'all 0.18s ease',
                }}
                onMouseEnter={(e) => { if (imageUrl && !isGenerating) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Download size={15} />
                PNG
              </button>
            )}
          </div>

          {/* Hint text */}
          {canNativeShare && !isGenerating && !error && (
            <p style={{
              margin: 0, fontSize: 11,
              color: 'rgba(255,255,255,0.25)',
              textAlign: 'center',
              lineHeight: 1.5,
              maxWidth: 360,
            }}>
              Appuyez sur une plateforme pour ouvrir la feuille de partage
              <br />
              de votre appareil — choisissez Story, Publication ou Message.
            </p>
          )}

          {/* Toast */}
          {toast.visible && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 40,
              background: 'rgba(29,185,84,0.12)',
              border: '1px solid rgba(29,185,84,0.25)',
              color: '#1DB954', fontSize: 14, fontWeight: 600,
              animation: 'slideUp 0.25s ease',
            }}>
              <Check size={16} />
              {toast.message}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Re-export helpers
export { sampleDominantColor as default };
export function roundedRect() {}
export function drawMusicNote() {}
export function drawHeart() {}
export function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1) {
    const ell = t + '…';
    if (ctx.measureText(ell).width <= maxWidth) return ell;
    t = t.slice(0, -1);
  }
  return '…';
}
