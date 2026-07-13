import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Trash2,
  X,
  Check,
  CloudOff,
} from 'lucide-react';
import {
  isAlbumReadyOffline,
  downloadAlbumWithStreaming,
  deleteAlbumOffline,
  cancelDownload,
  subscribeToDownloadProgress,
  getDownloadProgress,
  type DownloadStatus,
} from '@/services/downloadManager';
import type { PublicAlbumDetails } from '@/types/backend';
import { logger } from '@/utils/logger';

export type DownloadButtonVariant = 'icon' | 'full' | 'minimal';

export interface DownloadButtonProps {
  /** Album à télécharger/supprimer */
  album: PublicAlbumDetails;
  /** Clé de déchiffrement (nécessaire pour les albums payants) */
  decryptionKey?: string | null;
  /** Variante d'affichage */
  variant?: DownloadButtonVariant;
  /** Callback appelé après un téléchargement réussi */
  onComplete?: () => void;
  /** Callback appelé après une suppression */
  onDelete?: () => void;
  /** Classes CSS additionnelles */
  className?: string;
}

/**
 * DownloadButton — Bouton de téléchargement réutilisable.
 *
 * Gère automatiquement :
 * - L'état idle / downloading / completed / error
 * - La progression avec barre de progression
 * - L'annulation du téléchargement en cours
 * - La suppression de l'album déjà téléchargé
 * - La souscription aux événements de progression
 *
 * @example
 * // Sur une page AlbumDetail
 * <DownloadButton
 *   album={album}
 *   decryptionKey={decryptionKey}
 *   variant="full"
 *   onComplete={() => setIsOfflineReady(true)}
 * />
 */
export function DownloadButton({
  album,
  decryptionKey = null,
  variant = 'full',
  onComplete,
  onDelete,
  className,
}: DownloadButtonProps) {
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showCompletedToast, setShowCompletedToast] = useState(false);

  const albumId = album.id;
  const tracks = album.tracks ?? [];

  // ⚡ Vérifier l'état au montage
  useEffect(() => {
    const existing = getDownloadProgress(albumId);
    if (existing?.status === 'downloading') {
      setDownloadStatus('downloading');
      setDownloadProgress(existing.progress);
      return;
    }
    void isAlbumReadyOffline(albumId).then((ready) => {
      if (ready) {
        setDownloadStatus('completed');
        setDownloadProgress(100);
      }
    });
  }, [albumId]);

  // ⚡ Souscrire aux événements de progression
  useEffect(() => {
    if (downloadStatus !== 'downloading') return;
    const unsub = subscribeToDownloadProgress(albumId, (p) => {
      setDownloadProgress(p.progress);
      if (p.status === 'completed') {
        setDownloadStatus('completed');
        setDownloadProgress(100);
        setShowCompletedToast(true);
        setTimeout(() => setShowCompletedToast(false), 4000);
        onComplete?.();
      } else if (p.status === 'error') {
        setDownloadStatus('error');
        setTimeout(() => setDownloadStatus('idle'), 3000);
      } else if (p.status === 'cancelled' || p.status === 'idle') {
        setDownloadStatus('idle');
        setDownloadProgress(0);
      }
    });
    return () => unsub();
  }, [albumId, downloadStatus, onComplete]);

  const handleAction = useCallback(async () => {
    // Si déjà téléchargé → supprimer
    if (downloadStatus === 'completed') {
      await deleteAlbumOffline(albumId);
      setDownloadStatus('idle');
      setDownloadProgress(0);
      onDelete?.();
      return;
    }

    // Si déjà en cours → annuler
    if (downloadStatus === 'downloading') {
      cancelDownload(albumId);
      setDownloadStatus('idle');
      setDownloadProgress(0);
      return;
    }

    // Lancer le téléchargement
    if (tracks.length === 0) {
      logger.warn('[DownloadButton] Aucune piste à télécharger');
      return;
    }

    setDownloadStatus('downloading');
    setDownloadProgress(0);

    downloadAlbumWithStreaming(album, decryptionKey).then((status) => {
      if (status === 'cancelled') {
        setDownloadStatus('idle');
        setDownloadProgress(0);
      } else if (status === 'error') {
        setDownloadStatus('error');
        setTimeout(() => setDownloadStatus('idle'), 3000);
      }
      // 'completed' est géré par la souscription ci-dessus
    });
  }, [album, albumId, decryptionKey, downloadStatus, tracks.length, onDelete]);

  // ── Variante : icône seule ──
  if (variant === 'icon') {
    return (
      <button
        onClick={handleAction}
        title={
          downloadStatus === 'completed'
            ? 'Supprimer le téléchargement'
            : downloadStatus === 'downloading'
              ? 'Annuler le téléchargement'
              : 'Télécharger pour écoute hors-ligne'
        }
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 'var(--radius-full)',
          border: 'none',
          cursor: 'pointer',
          color:
            downloadStatus === 'completed'
              ? 'var(--color-success)'
              : downloadStatus === 'downloading'
                ? 'var(--color-accent)'
                : 'var(--color-text-muted)',
          background:
            downloadStatus === 'completed'
              ? 'rgba(29, 185, 84, 0.1)'
              : downloadStatus === 'downloading'
                ? 'rgba(220, 20, 60, 0.1)'
                : 'transparent',
          transition: 'all var(--transition-fast) ease',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (downloadStatus === 'idle') {
            e.currentTarget.style.background = 'var(--color-surface-hover)';
            e.currentTarget.style.color = 'var(--color-text-primary)';
          }
        }}
        onMouseLeave={(e) => {
          if (downloadStatus === 'idle') {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-muted)';
          }
        }}
      >
        {downloadStatus === 'completed' ? (
          <Check size={16} />
        ) : downloadStatus === 'downloading' ? (
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              border: '2px solid rgba(220,20,60,0.2)',
              borderTopColor: 'var(--color-accent)',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        ) : (
          <Download size={16} />
        )}
      </button>
    );
  }

  // ── Variante : minimale (petit bouton avec texte court) ──
  if (variant === 'minimal') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {downloadStatus === 'downloading' && (
          <div style={{ flex: 1, minWidth: 80 }}>
            <div
              style={{
                height: 3,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.08)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(downloadProgress)}%`,
                  borderRadius: 2,
                  background: 'linear-gradient(90deg, var(--color-accent), #FF6B6B)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}
        <button
          onClick={handleAction}
          title={
            downloadStatus === 'completed'
              ? 'Supprimer le téléchargement'
              : 'Télécharger'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid',
            borderColor:
              downloadStatus === 'completed'
                ? 'rgba(29, 185, 84, 0.2)'
                : downloadStatus === 'downloading'
                  ? 'rgba(220,20,60,0.2)'
                  : 'var(--color-border-subtle)',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            color:
              downloadStatus === 'completed'
                ? 'var(--color-success)'
                : downloadStatus === 'downloading'
                  ? 'var(--color-accent)'
                  : 'var(--color-text-secondary)',
            background:
              downloadStatus === 'completed'
                ? 'rgba(29, 185, 84, 0.08)'
                : downloadStatus === 'downloading'
                  ? 'rgba(220,20,60,0.08)'
                  : 'transparent',
            transition: 'all var(--transition-fast) ease',
          }}
          onMouseEnter={(e) => {
            if (downloadStatus === 'idle') {
              e.currentTarget.style.background = 'var(--color-surface-hover)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (downloadStatus === 'idle') {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--color-text-secondary)';
            }
          }}
        >
          {downloadStatus === 'completed' ? (
            <>
              <Check size={12} />
              <span>Téléchargé</span>
            </>
          ) : downloadStatus === 'downloading' ? (
            <>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  border: '1.5px solid rgba(220,20,60,0.2)',
                  borderTopColor: 'var(--color-accent)',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span>{Math.round(downloadProgress)}%</span>
            </>
          ) : (
            <>
              <Download size={12} />
              <span>DL</span>
            </>
          )}
        </button>
      </div>
    );
  }

  // ── Variante : full (bouton complet avec barre de progression) ──
  return (
    <div className={className}>
      {/* Bouton principal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {downloadStatus === 'completed' ? (
          <button
            onClick={handleAction}
            title="Supprimer le téléchargement hors-ligne"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 24px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(220,20,60,0.06)',
              border: '1px solid rgba(220,20,60,0.12)',
              cursor: 'pointer',
              color: 'var(--color-accent)',
              fontSize: 14,
              fontWeight: 600,
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(220,20,60,0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(220,20,60,0.06)';
            }}
          >
            <Trash2 size={15} />
            Supprimer
          </button>
        ) : downloadStatus === 'downloading' ? (
          <div style={{ minWidth: 200 }}>
            {/* Barre de progression */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.08)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round(downloadProgress)}%`,
                    borderRadius: 2,
                    background:
                      'linear-gradient(90deg, var(--color-accent), #FF6B6B)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <span
                style={{
                  color: 'var(--color-text-muted)',
                  fontSize: 12,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 42,
                  textAlign: 'right',
                }}
              >
                {Math.round(downloadProgress)}%
              </span>
              <button
                onClick={() => {
                  cancelDownload(albumId);
                  setDownloadStatus('idle');
                  setDownloadProgress(0);
                }}
                title="Annuler"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(255,255,255,0.04)',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = 'var(--color-text-muted)';
                }}
              >
                <X size={14} />
              </button>
            </div>
            <p
              style={{
                color: 'var(--color-text-muted)',
                fontSize: 12,
                margin: '6px 0 0',
              }}
            >
              Téléchargement…
            </p>
          </div>
        ) : (
          <button
            onClick={handleAction}
            title="Télécharger l'album pour écoute hors-ligne"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 24px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(29, 185, 84, 0.06)',
              border: '1px solid rgba(29, 185, 84, 0.15)',
              cursor: 'pointer',
              color: 'var(--color-success)',
              fontSize: 14,
              fontWeight: 600,
              transition: 'all var(--transition-fast) ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(29, 185, 84, 0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(29, 185, 84, 0.06)';
            }}
          >
            <Download size={16} />
            Télécharger
          </button>
        )}
      </div>

      {/* Toast de succès */}
      {downloadStatus === 'completed' && showCompletedToast && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(29, 185, 84, 0.1)',
              border: '1px solid rgba(29, 185, 84, 0.2)',
              animation: 'fadeIn 0.3s ease',
            }}
          >
            <Check size={14} color="var(--color-success)" />
            <span style={{ color: 'var(--color-success)', fontSize: 13, fontWeight: 600 }}>
              Album téléchargé · disponible hors-ligne
            </span>
          </div>
        </div>
      )}

      {/* Message d'erreur temporaire */}
      {downloadStatus === 'error' && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(220,20,60,0.08)',
              border: '1px solid rgba(220,20,60,0.15)',
              animation: 'fadeIn 0.3s ease',
            }}
          >
            <CloudOff size={14} color="var(--color-accent)" />
            <span style={{ color: 'var(--color-accent)', fontSize: 12, fontWeight: 600 }}>
              Échec du téléchargement
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
