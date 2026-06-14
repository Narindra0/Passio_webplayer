import { Download, Share2, X } from 'lucide-react';
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
  const isMobile = useMediaQuery('(max-width: 768px)');
  const imageUrlRef = useRef<string | null>(null);

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
        } catch {
          // fallback — no cover, still draw an empty jewel case
        }
      }

      await document.fonts.ready;

      // ══════════════════════════════════════════════════════
      //  1. BACKGROUND — warm dark gradient
      // ══════════════════════════════════════════════════════
      const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      bgGrad.addColorStop(0, '#1a0e10');
      bgGrad.addColorStop(0.4, '#12080a');
      bgGrad.addColorStop(1, '#080506');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Subtle accent glow at top
      const topGlow = ctx.createRadialGradient(
        CANVAS_W / 2, -80, 0,
        CANVAS_W / 2, -80, 500,
      );
      topGlow.addColorStop(0, 'rgba(198, 40, 40, 0.12)');
      topGlow.addColorStop(1, 'rgba(198, 40, 40, 0)');
      ctx.fillStyle = topGlow;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // ══════════════════════════════════════════════════════
      //  2. JEWEL CASE + CD
      // ══════════════════════════════════════════════════════

      const caseW = 520;
      const caseH = 520;
      const caseX = (CANVAS_W - caseW) / 2;
      const caseY = 260;
      const cornerR = 18;

      // ── 2a. CD peeking from behind the case ──
      const cdRadius = 130;
      const cdCenterX = CANVAS_W / 2;
      const cdCenterY = caseY + caseH + 10;

      // CD shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(cdCenterX, cdCenterY, cdRadius + 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.filter = 'blur(12px)';
      ctx.fill();
      ctx.filter = 'none';
      ctx.restore();

      // CD base (dark disc)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cdCenterX, cdCenterY, cdRadius, 0, Math.PI * 2);
      const cdGrad = ctx.createRadialGradient(
        cdCenterX, cdCenterY, 0,
        cdCenterX, cdCenterY, cdRadius,
      );
      cdGrad.addColorStop(0, '#3a3a3a');
      cdGrad.addColorStop(0.6, '#1a1a1a');
      cdGrad.addColorStop(0.85, '#111');
      cdGrad.addColorStop(1, '#080808');
      ctx.fillStyle = cdGrad;
      ctx.fill();
      ctx.restore();

      // CD rainbow reflection ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(cdCenterX, cdCenterY, cdRadius - 12, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();

      // CD highlight
      ctx.save();
      ctx.beginPath();
      ctx.arc(cdCenterX, cdCenterY, cdRadius - 4, 0, Math.PI * 2);
      const cdHighlight = ctx.createRadialGradient(
        cdCenterX - 50, cdCenterY - 50, 0,
        cdCenterX, cdCenterY, cdRadius,
      );
      cdHighlight.addColorStop(0, 'rgba(255,255,255,0.08)');
      cdHighlight.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      cdHighlight.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cdHighlight;
      ctx.fill();
      ctx.restore();

      // CD center hole
      ctx.save();
      ctx.beginPath();
      ctx.arc(cdCenterX, cdCenterY, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#080808';
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 3;
      ctx.fill();
      ctx.restore();

      // ── 2b. Jewel case body ──

      // Case shadow on background
      ctx.save();
      roundedRect(ctx, caseX + 4, caseY + 6, caseW, caseH, cornerR);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.filter = 'blur(20px)';
      ctx.fill();
      ctx.filter = 'none';
      ctx.restore();

      // Outer case border (the plastic edge)
      ctx.save();
      roundedRect(ctx, caseX, caseY, caseW, caseH, cornerR);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Inner area where the cover art goes
      const inset = 18;
      const artX = caseX + inset;
      const artY = caseY + inset;
      const artW = caseW - inset * 2;
      const artH = caseH - inset * 2;

      ctx.save();
      roundedRect(ctx, artX, artY, artW, artH, cornerR - 4);
      ctx.clip();

      if (imageLoaded && coverImg.complete && coverImg.naturalWidth > 0) {
        ctx.drawImage(coverImg, artX, artY, artW, artH);
      } else {
        // Empty jewel case — show a subtle placeholder
        ctx.fillStyle = '#1a1a1a';
        ctx.fill();
        // Placeholder icon
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.font = '80px Manrope, Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', artX + artW / 2, artY + artH / 2);
      }
      ctx.restore();

      // Inner shadow on the art (depth)
      ctx.save();
      roundedRect(ctx, caseX, caseY, caseW, caseH, cornerR);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // Subtle plastic reflection overlay
      ctx.save();
      const shineGrad = ctx.createLinearGradient(caseX, caseY, caseX, caseY + caseH);
      shineGrad.addColorStop(0, 'rgba(255,255,255,0.04)');
      shineGrad.addColorStop(0.15, 'rgba(255,255,255,0.02)');
      shineGrad.addColorStop(0.3, 'rgba(255,255,255,0)');
      shineGrad.addColorStop(1, 'rgba(255,255,255,0)');
      roundedRect(ctx, caseX, caseY, caseW, caseH, cornerR);
      ctx.fillStyle = shineGrad;
      ctx.fill();
      ctx.restore();

      // ══════════════════════════════════════════════════════
      //  3. TYPOGRAPHY — Track info
      // ══════════════════════════════════════════════════════
      const textY = cdCenterY + cdRadius + 40;

      // Accent line
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(CANVAS_W / 2 - 36, textY - 8);
      ctx.lineTo(CANVAS_W / 2 + 36, textY - 8);
      ctx.strokeStyle = '#DC143C';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(220, 20, 60, 0.35)';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Track title
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 58px Manrope, Inter, system-ui, sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 4;
      const title = truncateText(ctx, trackTitle, CANVAS_W - 120, 58);
      ctx.fillText(title, CANVAS_W / 2, textY + 30);
      ctx.shadowBlur = 0;

      // Artist
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '34px Manrope, Inter, system-ui, sans-serif';
      const artist = truncateText(ctx, artistName, CANVAS_W - 120, 34);
      ctx.fillText(artist, CANVAS_W / 2, textY + 90);

      // Album title
      if (albumTitle) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '26px Manrope, Inter, system-ui, sans-serif';
        const album = truncateText(ctx, albumTitle, CANVAS_W - 160, 26);
        ctx.fillText(album, CANVAS_W / 2, textY + 140);
      }

      // ══════════════════════════════════════════════════════
      //  4. BRANDING
      // ══════════════════════════════════════════════════════

      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '18px Manrope, Inter, system-ui, sans-serif';
      ctx.fillText('Écouter sur', CANVAS_W / 2, CANVAS_H - 110);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 36px Manrope, Inter, system-ui, sans-serif';
      ctx.fillText("Pass'io", CANVAS_W / 2, CANVAS_H - 65);

      // Red dot
      ctx.save();
      ctx.beginPath();
      ctx.arc(CANVAS_W / 2 + 110, CANVAS_H - 72, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#DC143C';
      ctx.shadowColor = 'rgba(220, 20, 60, 0.5)';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();

      // ══════════════════════════════════════════════════════
      //  5. EXPORT
      // ══════════════════════════════════════════════════════
      const blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b), 'image/png', 0.95);
        } catch {
          resolve(null);
        }
      });

      if (blob) {
        setImageBlob(blob);
        if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        const url = URL.createObjectURL(blob);
        imageUrlRef.current = url;
        setImageUrl(url);
      } else {
        throw new Error('Impossible de générer l\'image (CORS)');
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
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
      setImageUrl(null);
      setImageBlob(null);
      setError(null);
      setShowSuccess(false);
      return;
    }
    generateImage();
    return () => {
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
    };
  }, [visible, generateImage]);

  // ── Share / Download ──
  const handleShare = async () => {
    if (!imageBlob) return;
    const shareUrl = albumId
      ? `${window.location.origin}/album/${albumId}`
      : window.location.href;

    if (navigator.share && navigator.canShare) {
      const file = new File(
        [imageBlob],
        `passio-${trackTitle.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}.png`,
        { type: 'image/png' },
      );
      const shareData: ShareData = {
        title: `${trackTitle} — ${artistName}`,
        text: `J'écoute « ${trackTitle} » par ${artistName} sur Pass'io 🎵`,
        url: shareUrl,
        files: [file],
      };
      if (navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
          setShowSuccess(true);
          setTimeout(() => setShowSuccess(false), 2500);
          return;
        } catch (err) {
          if ((err as DOMException).name === 'AbortError') return;
        }
      }
      try {
        await navigator.share({
          title: `${trackTitle} — ${artistName}`,
          text: `J'écoute « ${trackTitle} » par ${artistName} sur Pass'io 🎵`,
          url: shareUrl,
        });
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2500);
        return;
      } catch {
        // fallback to download
      }
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
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2500);
  };

  if (!visible) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 10002,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          maxWidth: isMobile ? '94%' : 500,
          width: '100%',
          padding: isMobile ? 16 : 24,
        }}
      >
        {/* Close */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background: 'rgba(255,255,255,0.08)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Preview */}
        <div
          style={{
            width: '100%',
            maxWidth: 400,
            aspectRatio: '9/16',
            borderRadius: 16,
            overflow: 'hidden',
            backgroundColor: 'var(--color-surface)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {isGenerating && (
            <div
              className="loader-spinner"
              style={{ width: 32, height: 32, borderWidth: 3, borderColor: 'rgba(255,255,255,0.12)', borderTopColor: '#fff' }}
            />
          )}
          {error && !isGenerating && (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, padding: 24, textAlign: 'center' }}>
              {error}
            </p>
          )}
          {imageUrl && !isGenerating && (
            <img
              src={imageUrl}
              alt="Partager"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 400 }}>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              onClick={handleShare}
              disabled={!imageUrl || isGenerating}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px 24px',
                borderRadius: 'var(--radius-full)',
                background: 'linear-gradient(135deg, #C62828, #DC143C)',
                color: '#fff',
                fontSize: 15,
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                opacity: !imageUrl || isGenerating ? 0.4 : 1,
                transition: 'all var(--transition-fast) ease',
                boxShadow: !imageUrl || isGenerating ? 'none' : '0 4px 16px rgba(220,20,60,0.35)',
              }}
              onMouseEnter={(e) => {
                if (imageUrl && !isGenerating) {
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = '0 6px 24px rgba(220,20,60,0.5)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = !imageUrl || isGenerating ? 'none' : '0 4px 16px rgba(220,20,60,0.35)';
              }}
            >
              <Share2 size={18} />
              Partager
            </button>
          )}
          <button
            onClick={handleDownload}
            disabled={!imageUrl || isGenerating}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px 24px',
              borderRadius: 'var(--radius-full)',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              opacity: !imageUrl || isGenerating ? 0.4 : 1,
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => {
              if (imageUrl && !isGenerating) e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Download size={18} />
            {typeof navigator !== 'undefined' && 'share' in navigator ? 'Enregistrer' : 'Télécharger'}
          </button>
        </div>

        {showSuccess && (
          <div
            style={{
              padding: '10px 24px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(29,185,84,0.12)',
              border: '1px solid rgba(29,185,84,0.2)',
              color: '#1DB954',
              fontSize: 14,
              fontWeight: 600,
              animation: 'slideUp 0.25s ease',
            }}
          >
            ✓ {typeof navigator !== 'undefined' && 'share' in navigator ? 'Partagé !' : 'Téléchargé !'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  _fontSize: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0) {
    const withEllipsis = truncated + '…';
    if (ctx.measureText(withEllipsis).width <= maxWidth) return withEllipsis;
    truncated = truncated.slice(0, -1);
  }
  return '…';
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
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
