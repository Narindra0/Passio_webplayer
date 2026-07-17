import React from 'react';

/**
 * Wrapper autour de `React.lazy()` avec rechargement automatique en cas d'échec.
 *
 * Scénario : après un nouveau déploiement, les anciens chunks (avec anciens hashs)
 * ne sont plus disponibles sur le CDN. Le `catch()` recharge la page pour que
 * l'utilisateur récupère immédiatement la dernière version du Service Worker
 * et des bundles.
 */
export function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    componentImport().catch((error: unknown) => {
      console.error('[lazyWithRetry] Échec du chargement du module – rechargement de la page', error);
      window.location.reload();
      // Promise qui ne se résout jamais → React.lazy reste sur le fallback
      // jusqu'au rechargement de la page.
      return new Promise<{ default: T }>(() => {});
    }),
  );
}
