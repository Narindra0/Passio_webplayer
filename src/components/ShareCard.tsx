import { Copy, Download, Share2, X } from 'lucide-react';
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

const CANVAS_W = 1080;
const CANVAS_H = 1920;

// ──────────────────────────────────────────────
//  Color helpers
// ──────────────────────────────────────────────

function sampleDominantColor(img: HTMLImageElement): { r: number; g: number; b: number } | null {
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

function clamp(v: number): number { return Math.max(0, Math.min(255, Math.round(v))); }

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('');
}

function toRgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${a})`;
}

function adjustBrightness(r: number, g: number, b: number, factor: number): { r: number; g: number; b: number } {
  return { r: r * factor, g: g * factor, b: b * factor };
}

/** Perceived luminance 0-1 */
function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ──────────────────────────────────────────────
//  Drawing helpers
// ──────────────────────────────────────────────

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1) {
    const ell = t + '…';
    if (ctx.measureText(ell).width <= maxWidth) return ell;
    t = t.slice(0, -1);
  }
  return '…';
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const bw = w / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy + h * 0.25);
  ctx.bezierCurveTo(cx - bw - bw * 0.4, cy - h * 0.3, cx - bw, cy - h * 0.6, cx, cy - h * 0.15);
  ctx.bezierCurveTo(cx + bw, cy - h * 0.6, cx + bw + bw * 0.4, cy - h * 0.3, cx, cy + h * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draw a polished music-note icon */
function drawMusicNote(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = size / 14;
  ctx.save();
  // Note head (slanted ellipse)
  ctx.beginPath();
  ctx.ellipse(cx + 1.5 * s, cy + 4 * s, 4.5 * s, 3.2 * s, -0.35, 0, Math.PI * 2);
  ctx.fill();
  // Stem
  ctx.fillRect(cx + 5.5 * s, cy - 7 * s, 1.8 * s, 12 * s);
  // Flag (curved)
  ctx.beginPath();
  ctx.moveTo(cx + 7.3 * s, cy - 7 * s);
  ctx.quadraticCurveTo(cx + 12 * s, cy - 3 * s, cx + 7.3 * s, cy + 1 * s);
  ctx.quadraticCurveTo(cx + 9 * s, cy - 1 * s, cx + 7.3 * s, cy - 4 * s);
  ctx.fill();
  ctx.restore();
}

// ──────────────────────────────────────────────
//  Component
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
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const imageUrlRef = useRef<string | null>(null);
  // ── Canvas generation ──

  const generateImage = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      // ── Load album cover ──
      const coverImg = new Image();
      coverImg.crossOrigin = 'anonymous';
      let imageLoaded = false;
      if (coverUri) {
        try {
          await new Promise<void>((resolve, reject) => {
            coverImg.onload = () => { imageLoaded = true; resolve(); };
            coverImg.onerror = () => reject(new Error('Image load failed'));
            coverImg.src = coverUri;
          });
        } catch { /* fallback — no cover */ }
      }

      // ── Sample dominant color from cover ──
      let dc = { r: 180, g: 20, b: 40 }; // fallback red
      if (imageLoaded && coverImg.complete && coverImg.naturalWidth > 0) {
        const s = sampleDominantColor(coverImg);
        if (s) dc = s;
      }

      // Derive palette
      const isDark = luminance(dc.r, dc.g, dc.b) < 0.5;
      const vibrant = adjustBrightness(
        isDark ? dc.r : Math.min(255, dc.r * 1.4),
        isDark ? Math.min(255, dc.g * 0.8) : Math.min(255, dc.g * 0.5),
        isDark ? Math.min(255, dc.b * 0.9) : Math.min(255, dc.b * 0.4),
        1,
      );
      const muted = adjustBrightness(dc.r, dc.g, dc.b, 0.55);
      const darkMuted = adjustBrightness(dc.r, dc.g, dc.b, 0.12);
      const accent = vibrant;
      const accentStr = toHex(accent.r, accent.g, accent.b);

      await document.fonts.ready;

      const PAD = 80;
      const cardW = CANVAS_W - PAD * 2;
      const coverSize = 620;
      const cardInnerPad = 36;
      const coverX = (CANVAS_W - coverSize) / 2;

      // ══════════════════════════════════════════
      //  1. BLURRED COVER BACKGROUND
      // ══════════════════════════════════════════
      if (imageLoaded && coverImg.complete && coverImg.naturalWidth > 0) {
        ctx.save();
        ctx.filter = 'blur(70px)';
        ctx.globalAlpha = 0.4;
        ctx.drawImage(coverImg, -200, -200, CANVAS_W + 400, CANVAS_H + 400);
        ctx.restore();
      }

      // ══════════════════════════════════════════
      //  2. GRADIENT OVERLAY — clean & minimal
      // ══════════════════════════════════════════
      const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      bgGrad.addColorStop(0, toRgba(darkMuted.r, darkMuted.g, darkMuted.b, 0.85));
      bgGrad.addColorStop(0.5, toRgba(muted.r, muted.g, muted.b, 0.75));
      bgGrad.addColorStop(1, toRgba(darkMuted.r, darkMuted.g, darkMuted.b, 0.95));
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Accent glow diffused
      const glow = ctx.createRadialGradient(CANVAS_W / 2, 0, 0, CANVAS_W / 2, 0, 900);
      glow.addColorStop(0, toRgba(accent.r, accent.g, accent.b, 0.12));
      glow.addColorStop(0.5, toRgba(accent.r, accent.g, accent.b, 0.04));
      glow.addColorStop(1, toRgba(accent.r, accent.g, accent.b, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // ══════════════════════════════════════════
      //  3. HEADER
      // ══════════════════════════════════════════
      const headerY = 70;

      // Music note icon
      ctx.save();
      ctx.fillStyle = accentStr;
      drawMusicNote(ctx, PAD, headerY + 6, 26);
      ctx.restore();

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 14px Manrope, Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText("EN CE MOMENT SUR PASS'IO", PAD + 38, headerY + 10);

      // Story progress bars
      const barY = headerY + 4;
      const barH = 3;
      const barStartX = CANVAS_W - PAD - 100;
      for (let i = 0; i < 3; i++) {
        const bx = barStartX + i * 32;
        roundedRect(ctx, bx, barY, 28, barH, 2);
        ctx.fillStyle = i === 1 ? accentStr : 'rgba(255,255,255,0.2)';
        ctx.fill();
      }

      // ══════════════════════════════════════════
      //  4. MUSIC CARD (glassmorphism premium)
      // ══════════════════════════════════════════
      const hasAlbum = Boolean(albumTitle);
      const extraContentH = hasAlbum ? 165 : 115;
      const cardH = coverSize + cardInnerPad * 2 + extraContentH;
      const cardTop = 210;
      const cardContentStart = cardTop + cardInnerPad;
      const coverTop = cardContentStart;

      // Card shadow
      ctx.save();
      roundedRect(ctx, PAD + 6, cardTop + 10, cardW, cardH, 28);
      ctx.fillStyle = toRgba(0, 0, 0, 0.5);
      ctx.filter = 'blur(35px)';
      ctx.fill();
      ctx.restore();

      // Card background — semi-transparent glass
      ctx.save();
      roundedRect(ctx, PAD, cardTop, cardW, cardH, 24);
      const glassGrad = ctx.createLinearGradient(PAD, cardTop, PAD, cardTop + cardH);
      glassGrad.addColorStop(0, 'rgba(18, 18, 26, 0.6)');
      glassGrad.addColorStop(1, 'rgba(10, 10, 16, 0.7)');
      ctx.fillStyle = glassGrad;
      ctx.fill();
      // Border: white-ish, subtle
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // White glass shine at top
      ctx.save();
      roundedRect(ctx, PAD + 2, cardTop + 2, cardW - 4, 100, 22);
      const shineGrad = ctx.createLinearGradient(0, cardTop, 0, cardTop + 100);
      shineGrad.addColorStop(0, 'rgba(255,255,255,0.04)');
      shineGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = shineGrad;
      ctx.fill();
      ctx.restore();

      // ── 4a. Album cover ──
      ctx.save();
      roundedRect(ctx, coverX, coverTop, coverSize, coverSize, 16);
      ctx.clip();
      if (imageLoaded && coverImg.complete && coverImg.naturalWidth > 0) {
        ctx.drawImage(coverImg, coverX, coverTop, coverSize, coverSize);
      } else {
        ctx.fillStyle = '#1a1a1a';
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.font = '100px Manrope, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', coverX + coverSize / 2, coverTop + coverSize / 2);
      }
      ctx.restore();

      // Cover subtle border
      ctx.save();
      roundedRect(ctx, coverX, coverTop, coverSize, coverSize, 16);
      ctx.strokeStyle = toRgba(0, 0, 0, 0.25);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // ── 4b. Track title + heart ──
      const titleY = coverTop + coverSize + 38;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      const titleMaxWidth = cardW - cardInnerPad * 2 - 56;
      const titleFontSize = 44;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${titleFontSize}px Manrope, Inter, sans-serif`;
      ctx.fillText(truncateText(ctx, trackTitle, titleMaxWidth), PAD + cardInnerPad, titleY);

      // Heart
      const heartX = PAD + cardW - cardInnerPad - 26;
      ctx.save();
      ctx.fillStyle = accentStr;
      drawHeart(ctx, heartX, titleY - 2, 22, 20);
      ctx.restore();

      // ── 4c. Artist name ──
      const artistY = titleY + 48;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '26px Manrope, Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncateText(ctx, artistName || 'Artiste', cardW - cardInnerPad * 2), PAD + cardInnerPad, artistY);

      // ── 4d. Album title ──
      if (hasAlbum) {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = '20px Manrope, Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(truncateText(ctx, albumTitle!, cardW - cardInnerPad * 2), PAD + cardInnerPad, artistY + 42);
      }
      // ══════════════════════════════════════════
      //  5. ÉCOUTER SUR PASS'IO — BADGE
      // ══════════════════════════════════════════
      const badgeY = cardTop + cardH + 34;
      const badgeW = 400;
      const badgeH = 60;
      const badgeX = (CANVAS_W - badgeW) / 2;

      // Badge bg
      ctx.save();
      roundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 30);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Play circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(badgeX + 48, badgeY + badgeH / 2, 16, 0, Math.PI * 2);
      ctx.fillStyle = toRgba(accent.r, accent.g, accent.b, 0.85);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(badgeX + 43, badgeY + badgeH / 2 - 6);
      ctx.lineTo(badgeX + 43, badgeY + badgeH / 2 + 6);
      ctx.lineTo(badgeX + 54, badgeY + badgeH / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Badge text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 17px Manrope, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText("ÉCOUTER SUR PASS'IO", CANVAS_W / 2 + 16, badgeY + badgeH / 2);

      // ══════════════════════════════════════════
      //  6. HINT & BRANDING
      // ══════════════════════════════════════════
      const hintY = badgeY + badgeH + 32;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '14px Manrope, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Scannez ou faites glisser pour écouter', CANVAS_W / 2, hintY);

      const brandY = CANVAS_H - 100;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.font = '17px Manrope, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText("Pass'io", CANVAS_W / 2, brandY);

      // Red dot
      ctx.save();
      ctx.beginPath();
      ctx.arc(CANVAS_W / 2 + 62, brandY - 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = accentStr;
      ctx.shadowColor = toRgba(accent.r, accent.g, accent.b, 0.5);
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();

      // ══════════════════════════════════════════
      //  8. EXPORT
      // ══════════════════════════════════════════
      const blob = await new Promise<Blob | null>((resolve) => {
        try { canvas.toBlob((b) => resolve(b), 'image/png', 0.95); } catch { resolve(null); }
      });

      if (blob) {
        setImageBlob(blob);
        if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        const url = URL.createObjectURL(blob);
        imageUrlRef.current = url;
        setImageUrl(url);
      } else {
        throw new Error("Impossible de générer l'image (CORS)");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de génération');
    } finally {
      setIsGenerating(false);
    }
  }, [coverUri, trackTitle, artistName, albumTitle]);

  // ── Lifecycle ──
  useEffect(() => {
    if (!visible) {
      if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null; }
      setImageUrl(null); setImageBlob(null); setError(null); setShowSuccess(false);
      return;
    }
    generateImage();
    return () => {
      if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null; }
    };
  }, [visible, generateImage]);

  // ── Share / Download / Copy ──

  const showSuccessToast = (msg: string) => {
    setSuccessMessage(msg);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2500);
  };

  const handleShare = async () => {
    if (!imageBlob) return;
    const shareUrl = albumId
      ? `${window.location.origin}/album/${albumId}`
      : window.location.href;

    const fileName = `passio-${trackTitle.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}.png`;

    if (navigator.share && navigator.canShare) {
      const file = new File([imageBlob], fileName, { type: 'image/png' });
      const shareData: ShareData = {
        title: `${trackTitle} — ${artistName}`,
        text: `J'écoute « ${trackTitle} » par ${artistName} sur Pass'io 🎵`,
        url: shareUrl,
        files: [file],
      };
      if (navigator.canShare(shareData)) {
        try { await navigator.share(shareData); showSuccessToast('Partagé !'); return; }
        catch (err) { if ((err as DOMException).name === 'AbortError') return; }
      }
      try {
        await navigator.share({ title: `${trackTitle} — ${artistName}`, text: `J'écoute « ${trackTitle} » par ${artistName} sur Pass'io 🎵`, url: shareUrl });
        showSuccessToast('Partagé !'); return;
      } catch { /* fallback */ }
    }
    handleDownload();
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `passio-${trackTitle.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showSuccessToast('Téléchargé !');
  };

  const handleCopyImage = async () => {
    if (!imageBlob) return;
    try {
      // Prefer async clipboard API
      if (navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })]);
        showSuccessToast('Image copiée !');
        return;
      }
      // Fallback: download
      handleDownload();
    } catch {
      // Fallback: download
      handleDownload();
    }
  };

  if (!visible) return null;

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 10002,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 20, maxWidth: isMobile ? '94%' : 500, width: '100%',
          padding: isMobile ? 16 : 24,
        }}
      >
        {/* Close */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 'var(--radius-full)',
            border: 'none', background: 'rgba(255,255,255,0.08)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', transition: 'all 0.2s ease',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Preview */}
        <div style={{
          width: '100%', maxWidth: 400, aspectRatio: '9/16',
          borderRadius: 16, overflow: 'hidden',
          backgroundColor: 'var(--color-surface)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {isGenerating && (
            <div className="loader-spinner" style={{ width: 32, height: 32, borderWidth: 3, borderColor: 'rgba(255,255,255,0.12)', borderTopColor: '#fff' }} />
          )}
          {error && !isGenerating && (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, padding: 24, textAlign: 'center' }}>{error}</p>
          )}
          {imageUrl && !isGenerating && (
            <img src={imageUrl} alt="Partager" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 400, flexWrap: 'wrap' }}>
          {/* Copy image (always available) */}
          <button
            onClick={handleCopyImage}
            disabled={!imageUrl || isGenerating}
            style={{
              flex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 16px', borderRadius: 'var(--radius-full)',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', opacity: !imageUrl || isGenerating ? 0.4 : 1,
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => { if (imageUrl && !isGenerating) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Copy size={16} />
            Copier
          </button>

          {/* Share (native) */}
          {canShare && (
            <button onClick={handleShare} disabled={!imageUrl || isGenerating} style={{
              flex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 16px', borderRadius: 'var(--radius-full)',
              background: 'linear-gradient(135deg, #C62828, #DC143C)',
              color: '#fff', fontSize: 14, fontWeight: 700, border: 'none',
              cursor: 'pointer', opacity: !imageUrl || isGenerating ? 0.4 : 1,
              transition: 'all var(--transition-fast) ease',
              boxShadow: !imageUrl || isGenerating ? 'none' : '0 4px 16px rgba(220,20,60,0.35)',
            }}
              onMouseEnter={(e) => { if (imageUrl && !isGenerating) { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(220,20,60,0.5)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = !imageUrl || isGenerating ? 'none' : '0 4px 16px rgba(220,20,60,0.35)'; }}
            >
              <Share2 size={16} />
              Partager
            </button>
          )}

          {/* Download */}
          <button onClick={handleDownload} disabled={!imageUrl || isGenerating} style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '14px 16px', borderRadius: 'var(--radius-full)',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', opacity: !imageUrl || isGenerating ? 0.4 : 1,
            transition: 'all var(--transition-fast) ease',
          }}
            onMouseEnter={(e) => { if (imageUrl && !isGenerating) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Download size={16} />
            {canShare ? 'Enregistrer' : 'Télécharger'}
          </button>
        </div>

        {showSuccess && (
          <div style={{
            padding: '10px 24px', borderRadius: 'var(--radius-full)',
            background: 'rgba(29,185,84,0.12)', border: '1px solid rgba(29,185,84,0.2)',
            color: '#1DB954', fontSize: 14, fontWeight: 600,
            animation: 'slideUp 0.25s ease',
          }}>
            ✓ {successMessage}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Export also for canvas URL generation ───
export { sampleDominantColor, drawMusicNote, drawHeart, roundedRect, truncateText };
