/**
 * ConsentSettings.tsx — Paramètres de consentement RGPD.
 *
 * Permet à l'utilisateur de :
 *   - Voir son statut actuel de consentement
 *   - Retirer son consentement (DELETE en cascade)
 *   - Voir le message de confirmation après retrait
 */

import { AlertTriangle, CheckCircle, Loader2, Shield, ShieldOff, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useConsent } from '@/hooks/useConsent';

interface ConsentSettingsProps {
  onClose?: () => void;
}

export function ConsentSettings({ onClose }: ConsentSettingsProps) {
  const { status, allowed, withdraw } = useConsent();
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleWithdraw = async () => {
    if (!allowed) return;
    setIsWithdrawing(true);
    const res = await withdraw();
    setResult(res);
    setIsWithdrawing(false);
  };

  const statusLabel = () => {
    switch (status) {
      case 'granted': return 'Consentement accordé';
      case 'denied': return 'Consentement refusé';
      case 'withdrawn': return 'Consentement retiré';
      case 'unknown': return 'Aucun choix effectué';
    }
  };

  const statusColor = () => {
    switch (status) {
      case 'granted': return 'var(--color-success)';
      case 'denied':
      case 'withdrawn': return 'var(--color-text-muted)';
      case 'unknown': return 'var(--color-warning)';
    }
  };

  const statusIcon = () => {
    switch (status) {
      case 'granted': return <CheckCircle size={20} style={{ color: statusColor() }} />;
      case 'denied':
      case 'withdrawn': return <ShieldOff size={20} style={{ color: statusColor() }} />;
      case 'unknown': return <Shield size={20} style={{ color: statusColor() }} />;
    }
  };

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border-subtle)',
        overflow: 'hidden',
        maxWidth: 520,
        width: '100%',
      }}
    >
      {/* En-tête */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={18} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
            Confidentialité
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.06)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.4)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Corps */}
      <div style={{ padding: '20px' }}>
        {/* Statut actuel */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderRadius: 'var(--radius-base)',
            background: 'var(--color-surface-elevated)',
            marginBottom: 16,
          }}
        >
          {statusIcon()}
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: statusColor() }}>
              {statusLabel()}
            </p>
            {status === 'granted' && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Des données d'écoute anonymes sont collectées pour améliorer les recommandations.
              </p>
            )}
            {status === 'withdrawn' && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                Toutes les données associées à votre appareil ont été supprimées.
              </p>
            )}
          </div>
        </div>

        {/* Message de résultat */}
        {result && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 'var(--radius-base)',
              background: result.success
                ? 'rgba(29, 185, 84, 0.08)'
                : 'rgba(233, 20, 41, 0.08)',
              border: `1px solid ${result.success ? 'rgba(29, 185, 84, 0.2)' : 'rgba(233, 20, 41, 0.2)'}`,
              marginBottom: 16,
            }}
          >
            {result.success ? (
              <CheckCircle size={16} style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: 2 }} />
            ) : (
              <AlertTriangle size={16} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: 2 }} />
            )}
            <p style={{ margin: 0, fontSize: 13, color: result.success ? 'var(--color-success)' : 'var(--color-error)' }}>
              {result.message}
            </p>
          </div>
        )}

        {/* Bouton de retrait */}
        {allowed && (
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 'var(--radius-base)',
              background: 'rgba(233, 20, 41, 0.06)',
              border: '1px solid rgba(233, 20, 41, 0.12)',
            }}
          >
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              Si vous retirez votre consentement, toutes les données d'écoute
              associées à votre appareil seront définitivement supprimées de nos
              serveurs (écoutes, sessions, pages vues, informations techniques).
              Cette action est irréversible.
            </p>
            <button
              onClick={handleWithdraw}
              disabled={isWithdrawing}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(233, 20, 41, 0.3)',
                background: 'rgba(233, 20, 41, 0.08)',
                color: 'var(--color-error)',
                fontSize: 13,
                fontWeight: 700,
                cursor: isWithdrawing ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                opacity: isWithdrawing ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isWithdrawing) e.currentTarget.style.background = 'rgba(233, 20, 41, 0.18)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(233, 20, 41, 0.08)';
              }}
            >
              {isWithdrawing ? (
                <Loader2 size={15} style={{ animation: 'spin 0.8s linear infinite' }} />
              ) : (
                <Trash2 size={15} />
              )}
              {isWithdrawing ? 'Suppression en cours…' : 'Retirer mon consentement et supprimer mes données'}
            </button>
          </div>
        )}

        {/* Message si déjà retiré */}
        {status === 'withdrawn' && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
            Vous avez déjà retiré votre consentement. Aucune donnée n'est collectée.
          </p>
        )}
      </div>
    </div>
  );
}
