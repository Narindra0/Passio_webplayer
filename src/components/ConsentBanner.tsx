/**
 * ConsentBanner.tsx — Bannière de consentement RGPD.
 *
 * Apparaît en bas de l'écran au premier lancement (statut === 'unknown').
 * Permet à l'utilisateur de :
 *   - Accepter le tracking (statistiques anonymes d'écoute)
 *   - Refuser (aucun tracking, fonctionnalités du produit inchangées)
 *
 * Design : semi-transparent, flou, ancré en bas, non-bloquant.
 */

import { Shield, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConsent } from '@/hooks/useConsent';

export function ConsentBanner() {
  const { status, isPending, accept, deny } = useConsent();
  const [dismissed, setDismissed] = useState(false);
  const [animState, setAnimState] = useState<'entering' | 'visible' | 'exiting'>('entering');

  // Animation d'entrée différée (pour laisser le temps au reste de l'UI de se charger)
  useEffect(() => {
    if (isPending && !dismissed) {
      const timer = setTimeout(() => setAnimState('visible'), 800);
      return () => clearTimeout(timer);
    }
  }, [isPending, dismissed]);

  // Si déjà répondu ou dismissé → ne rien afficher
  if (!isPending || dismissed || animState === 'entering') return null;

  const handleAccept = async () => {
    setAnimState('exiting');
    setTimeout(() => {
      void accept();
      setDismissed(true);
    }, 300);
  };

  const handleDeny = async () => {
    setAnimState('exiting');
    setTimeout(() => {
      void deny();
      setDismissed(true);
    }, 300);
  };

  const handleDismiss = () => {
    setAnimState('exiting');
    setTimeout(() => setDismissed(true), 300);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10001,
        padding: '12px 16px',
        paddingBottom: 'calc(12px + var(--sab, env(safe-area-inset-bottom, 0px)))',
        animation: animState === 'visible'
          ? 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
          : 'fadeOut 0.3s ease forwards',
        pointerEvents: 'auto',
      }}

    >
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          background: 'rgba(20, 20, 20, 0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 16,
          padding: '16px 20px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Ligne supérieure : icône + texte + fermeture */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--color-accent-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            <Shield size={16} style={{ color: 'var(--color-accent)' }} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: '#fff',
                lineHeight: 1.4,
              }}
            >
              Nous respectons votre vie privée
            </p>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.55)',
                lineHeight: 1.5,
              }}
            >
              Nous collectons des données d'écoute anonymes pour améliorer
              votre expérience (recommandations, tendances). Aucune donnée
              personnelle n'est vendue ou partagée. Vous pouvez refuser ou
              retirer votre consentement à tout moment.
            </p>
          </div>

          <button
            onClick={handleDismiss}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.06)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255, 255, 255, 0.4)',
              flexShrink: 0,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)';
            }}
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Ligne des boutons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={handleDeny}
            className="btn-secondary"
            style={{
              padding: '8px 18px',
              fontSize: 13,
            }}
          >
            Refuser
          </button>
          <button
            onClick={handleAccept}
            className="btn-primary"
            style={{
              padding: '8px 18px',
              fontSize: 13,
            }}
          >
            Accepter
          </button>
        </div>

        {/* Lien politique de confidentialité */}
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: 'rgba(255, 255, 255, 0.3)',
            textAlign: 'right',
          }}
        >
          Consultez notre{' '}
          <a
            href="/privacy"
            style={{
              color: 'rgba(255, 255, 255, 0.5)',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            politique de confidentialité
          </a>
        </p>
      </div>
    </div>
  );
}
