import { useCallback, useEffect, useState } from 'react';
import { Database, Trash2 } from 'lucide-react';
import { getStorageStats, type StorageStats } from '@/services/storageQuota';
import { deleteAllOffline } from '@/services/downloadManager';

interface StorageQuotaBarProps {
  /** Recharger les stats après une suppression */
  onRefresh?: () => void;
}

export function StorageQuotaBar({ onRefresh }: StorageQuotaBarProps) {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    const s = await getStorageStats();
    setStats(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleDeleteAll = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    await deleteAllOffline();
    setConfirmDelete(false);
    onRefresh?.();
    void loadStats();
  };

  if (loading || !stats) return null;
  if (stats.albumCount === 0 && stats.trackCount === 0) return null;

  const usagePercent = Math.round(stats.usageRatio * 100);
  const isHigh = stats.usageRatio > 0.8;
  const isMid = stats.usageRatio > 0.5;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderRadius: 'var(--radius-md)',
        background: isHigh
          ? 'rgba(220,20,60,0.08)'
          : 'var(--color-surface-elevated)',
        border: `1px solid ${
          isHigh
            ? 'rgba(220,20,60,0.15)'
            : 'var(--color-border-subtle)'
        }`,
        marginBottom: 16,
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 'var(--radius-full)',
          background: isHigh
            ? 'rgba(220,20,60,0.12)'
            : 'rgba(255,255,255,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Database
          size={16}
          color={isHigh ? 'var(--color-accent)' : 'var(--color-text-muted)'}
        />
      </div>

      {/* Stats text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              color: isHigh ? 'var(--color-accent)' : 'var(--color-text-primary)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {stats.usedFormatted}
          </span>
          {stats.availableFormatted !== 'N/A' && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
              / {stats.availableFormatted}
            </span>
          )}
          <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
            ·
          </span>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
            {stats.albumCount} album{stats.albumCount > 1 ? 's' : ''}
            {stats.trackCount > 0 && ` · ${stats.trackCount} piste${stats.trackCount > 1 ? 's' : ''}`}
          </span>
          {isHigh && (
            <span style={{ color: 'var(--color-accent)', fontSize: 11, fontWeight: 700 }}>
              Stockage presque plein
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: '100%',
            height: 3,
            borderRadius: 2,
            background: 'var(--color-border-subtle)',
            marginTop: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${usagePercent}%`,
              borderRadius: 2,
              background: isHigh
                ? 'linear-gradient(90deg, var(--color-accent), #FF6B6B)'
                : isMid
                  ? 'linear-gradient(90deg, #FFA500, #FFD700)'
                  : 'linear-gradient(90deg, var(--color-accent), var(--color-accent-light))',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={handleDeleteAll}
        title={confirmDelete ? 'Confirmer la suppression ?' : 'Tout supprimer'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 'var(--radius-full)',
          background: confirmDelete
            ? 'rgba(220,20,60,0.15)'
            : 'transparent',
          border: `1px solid ${
            confirmDelete
              ? 'rgba(220,20,60,0.3)'
              : 'var(--color-border-subtle)'
          }`,
          cursor: 'pointer',
          color: confirmDelete
            ? 'var(--color-accent)'
            : 'var(--color-text-muted)',
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!confirmDelete) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
            e.currentTarget.style.color = 'var(--color-text-primary)';
          }
        }}
        onMouseLeave={(e) => {
          if (!confirmDelete) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-muted)';
          }
        }}
      >
        <Trash2 size={13} />
        {confirmDelete ? 'Confirmer ?' : 'Supprimer tout'}
      </button>
    </div>
  );
}
