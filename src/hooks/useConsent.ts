/**
 * useConsent.ts — Hook React pour l'état du consentement RGPD.
 *
 * Wrapper réactif autour de consentManager.ts.
 * Met à jour le composant quand le statut change.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getConsentStatus,
  isTrackingAllowed,
  setConsent,
  withdrawConsent,
  type ConsentStatus,
} from '@/services/consentManager';

export interface UseConsentReturn {
  /** Statut actuel du consentement : 'unknown' | 'granted' | 'denied' | 'withdrawn' */
  status: ConsentStatus;
  /** true si le consentement est 'granted' */
  allowed: boolean;
  /** true si l'utilisateur n'a pas encore fait de choix */
  isPending: boolean;
  /** Accepter le tracking */
  accept: () => Promise<void>;
  /** Refuser le tracking */
  deny: () => Promise<void>;
  /** Retirer le consentement (DELETE en cascade) */
  withdraw: () => Promise<{ success: boolean; message: string }>;
}

export function useConsent(): UseConsentReturn {
  const [status, setStatus] = useState<ConsentStatus>(getConsentStatus);

  // Synchroniser le statut depuis localStorage au mount + quand la page revient au focus
  useEffect(() => {
    const sync = () => setStatus(getConsentStatus());

    // Ré-évaluer quand la page reçoit le focus (un autre onglet a pu modifier)
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  const accept = useCallback(async () => {
    await setConsent('granted');
    setStatus('granted');
  }, []);

  const deny = useCallback(async () => {
    await setConsent('denied');
    setStatus('denied');
  }, []);

  const withdraw = useCallback(async () => {
    const result = await withdrawConsent();
    setStatus(getConsentStatus());
    return result;
  }, []);

  return {
    status,
    allowed: isTrackingAllowed(),
    isPending: status === 'unknown',
    accept,
    deny,
    withdraw,
  };
}
