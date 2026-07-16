import { useEffect, useState } from 'react';
import { Download, X, HardDrive, AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { getAlbumDownloadSize, evictLRUIfNeeded, formatBytes, type AlbumSizeEstimate } from '@/services/downloadManager';
import { getStorageStats, type StorageStats } from '@/services/storageQuota';
import type { PublicAlbumDetails } from '@/types/backend';
import { formatTitle } from '@/utils/formatTitle';

interface DownloadConfirmModalProps {
  album: PublicAlbumDetails;
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DownloadConfirmModal({
  album,
  visible,
  onConfirm,
  onCancel,
}: DownloadConfirmModalProps) {
  const [sizeEstimate, setSizeEstimate] = useState<AlbumSizeEstimate | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [calculating, setCalculating] = useState(true);
  const [liberating, setLiberating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackCount = album.tracks?.length ?? 0;
  const artistName = album.artist_name || album.artist?.name || 'Artiste inconnu';

  // ⚡ Calculer la taille et les stats à l'ouverture de la modale
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    async function compute() {
      setCalculating(true);
      setError(null);
      try {
        const [size, stats] = await Promise.all([
          getAlbumDownloadSize(album),
          getStorageStats(),
        ]);
        if (cancelled) return;
        setSizeEstimate(size);
        setStorageStats(stats);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Erreur de calcul de taille');
      } finally {
        if (!cancelled) setCalculating(false);
      }
    }

    void compute();
    return () => { cancelled = true; };
  }, [visible, album]);

  // Vérifier si l'espace est suffisant — calcul direct, pas de useCallback
  const insufficientSpace = sizeEstimate != null && storageStats != null && storageStats.availableBytes != null
    ? sizeEstimate.totalBytes > storageStats.availableBytes
    : false;

  async function handleLiberer() {
    setLiberating(true);
    setError(null);
    try {
      const result = await evictLRUIfNeeded();
      const stats = await getStorageStats();
      setStorageStats(stats);

      if (result.evicted.length === 0) {
        setError('Aucun album à libérer. Vous pouvez tenter le téléchargement quand même — il échouera si l\'espace est vraiment insuffisant.');
      } else if (sizeEstimate && stats.availableBytes !== null && sizeEstimate.totalBytes > stats.availableBytes) {
        setError('Espace encore insuffisant après libération. Essayez à nouveau ou téléchargez quand même.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la libération');
    } finally {
      setLiberating(false);
    }
  }

  if (!visible) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 10003,
          animation: 'fadeIn 0.15s ease',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10004,
          width: 'min(440px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 80px)',
          overflowY: 'auto',
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.2s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 0',
          }}
        >
          <h2
            style={{
              color: 'var(--color-text-primary)',
              fontSize: 18,
              fontWeight: 700,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Download size={18} />
            Télécharger l'album
          </h2>
          <button
            onClick={onCancel}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-surface-hover)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--color-text-muted)';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 24px 20px' }}>
          {/* Album info */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-dark)',
              marginBottom: 16,
            }}
          >
            {album.cover_url ? (
              <img
                src={album.cover_url}
                alt=""
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 'var(--radius-xs)',
                  objectFit: 'cover',
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--color-surface-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 20, color: 'var(--color-text-muted)' }}>♪</span>
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  color: 'var(--color-text-primary)',
                  fontSize: 14,
                  fontWeight: 600,
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatTitle(album.title)}
              </p>
              <p
                style={{
                  color: 'var(--color-text-muted)',
                  fontSize: 12,
                  fontWeight: 500,
                  margin: '2px 0 0',
                }}
              >
                {artistName}
              </p>
            </div>
          </div>

          {/* Size calculation */}
          {calculating ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '24px 0',
                color: 'var(--color-text-muted)',
                fontSize: 14,
              }}
            >
              <Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} />
              Calcul de la taille...
            </div>
          ) : error ? (
            <div
              style={{
                padding: 12,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(220,20,60,0.08)',
                border: '1px solid rgba(220,20,60,0.15)',
                color: 'var(--color-accent)',
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          ) : sizeEstimate && storageStats ? (
            <>
              {/* Size info */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(255,255,255,0.03)',
                  marginBottom: 12,
                }}
              >
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 500 }}>
                  {trackCount} piste{trackCount > 1 ? 's' : ''}
                </span>
                <span style={{ color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 700 }}>
                  {sizeEstimate.totalFormatted}
                </span>
              </div>

              {/* Source badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 16,
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                }}
              >
                <span>Estimation :</span>
                {(() => {
                  const sources = new Set(sizeEstimate.tracks.map(t => t.source));
                  if (sources.has('cache')) return <span>données en cache</span>;
                  if (sources.has('head') && !sources.has('estimate')) return <span>taille réelle (HEAD)</span>;
                  if (sources.has('head') && sources.has('estimate')) return <span>mixte (HEAD + estimation durée)</span>;
                  return <span>estimation par durée</span>;
                })()}
              </div>

              {/* Storage bar */}
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HardDrive size={14} color="var(--color-text-muted)" />
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 500 }}>
                      Espace disque
                    </span>
                  </div>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                    {storageStats.usedFormatted} / {storageStats.availableFormatted}
                  </span>
                </div>

                {/* Progress bar */}
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.06)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.round(storageStats.usageRatio * 100))}%`,
                      borderRadius: 3,
                      background: insufficientSpace
                        ? 'linear-gradient(90deg, var(--color-accent), #ff4444)'
                        : 'linear-gradient(90deg, var(--color-success), #1DB954)',
                      transition: 'width 0.4s ease',
                    }}
                  />
                  {/* Projected usage if downloaded */}
                  {sizeEstimate && storageStats.availableBytes !== null && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: `${Math.min(100, Math.round(((storageStats.usedBytes + sizeEstimate.totalBytes) / (storageStats.usedBytes + storageStats.availableBytes)) * 100))}%`,
                        height: '100%',
                        width: 3,
                        background: 'var(--color-text-primary)',
                        borderRadius: 2,
                        opacity: 0.5,
                      }}
                      title="Utilisation projetée après téléchargement"
                    />
                  )}
                </div>
              </div>

              {/* Warning if insufficient space */}
              {insufficientSpace && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(220,20,60,0.08)',
                    border: '1px solid rgba(220,20,60,0.15)',
                    marginBottom: 16,
                  }}
                >
                  <AlertTriangle size={16} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <p style={{ color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, margin: 0 }}>
                      Espace insuffisant
                    </p>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '4px 0 0', lineHeight: '18px' }}>
                      Il manque{' '}
                      <strong style={{ color: 'var(--color-text-primary)' }}>
                        {formatBytes(sizeEstimate.totalBytes - (storageStats.availableBytes ?? 0))}
                      </strong>{' '}
                      pour télécharger cet album.
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : null}

          {/* Action buttons */}

          {insufficientSpace ? (
            /* Espace insuffisant : double bouton Libérer + Télécharger quand même */
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                <button
                  onClick={handleLiberer}
                  disabled={liberating}
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '12px 20px',
                    borderRadius: 'var(--radius-full)',
                    background: liberating ? 'rgba(255,255,255,0.04)' : 'rgba(220,20,60,0.08)',
                    border: '1px solid rgba(220,20,60,0.2)',
                    cursor: liberating ? 'not-allowed' : 'pointer',
                    color: 'var(--color-accent)',
                    fontSize: 14,
                    fontWeight: 600,
                    transition: 'all var(--transition-fast) ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!liberating) e.currentTarget.style.background = 'rgba(220,20,60,0.14)';
                  }}
                  onMouseLeave={(e) => {
                    if (!liberating) e.currentTarget.style.background = 'rgba(220,20,60,0.08)';
                  }}
                >
                  {liberating ? (
                    <>
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          border: '2px solid rgba(220,20,60,0.2)',
                          borderTopColor: 'var(--color-accent)',
                          animation: 'spin 0.8s linear infinite',
                        }}
                      />
                      Libération en cours...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      Libérer de l'espace
                    </>
                  )}
                </button>
                <button
                  onClick={onCancel}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '12px 20px',
                    borderRadius: 'var(--radius-full)',
                    background: 'transparent',
                    border: '1px solid var(--color-border-subtle)',
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                    fontSize: 14,
                    fontWeight: 600,
                    transition: 'all var(--transition-fast) ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-surface-hover)';
                    e.currentTarget.style.color = 'var(--color-text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                  }}
                >
                  Annuler
                </button>
              </div>
              <button
                onClick={onConfirm}
                style={{
                  width: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 'var(--radius-full)',
                  background: 'transparent',
                  border: '1px dashed var(--color-border-subtle)',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  fontSize: 12,
                  fontWeight: 500,
                  transition: 'all var(--transition-fast) ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                  e.currentTarget.style.borderColor = 'var(--color-border-subtle)';
                }}
              >
                Télécharger quand même (peut échouer partiellement)
              </button>
            </>
          ) : (
            /* Espace suffisant : bouton Confirmer + Annuler */
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={onConfirm}
                disabled={calculating}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px 20px',
                  borderRadius: 'var(--radius-full)',
                  background: calculating ? 'rgba(29,185,84,0.04)' : 'rgba(29,185,84,0.1)',
                  border: '1px solid rgba(29,185,84,0.2)',
                  cursor: calculating ? 'not-allowed' : 'pointer',
                  color: calculating ? 'var(--color-text-muted)' : 'var(--color-success)',
                  fontSize: 14,
                  fontWeight: 700,
                  transition: 'all var(--transition-fast) ease',
                  opacity: calculating ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!calculating) {
                    e.currentTarget.style.background = 'rgba(29,185,84,0.16)';
                    e.currentTarget.style.transform = 'scale(1.02)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!calculating) {
                    e.currentTarget.style.background = 'rgba(29,185,84,0.1)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }
                }}
              >
                {calculating ? (
                  <>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.1)',
                        borderTopColor: 'var(--color-text-muted)',
                        animation: 'spin 0.8s linear infinite',
                      }}
                    />
                    Calcul...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Confirmer le téléchargement
                  </>
                )}
              </button>
              <button
                onClick={onCancel}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '12px 20px',
                  borderRadius: 'var(--radius-full)',
                  background: 'transparent',
                  border: '1px solid var(--color-border-subtle)',
                  cursor: 'pointer',
                  color: 'var(--color-text-secondary)',
                  fontSize: 14,
                  fontWeight: 600,
                  transition: 'all var(--transition-fast) ease',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-surface-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                Annuler
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
