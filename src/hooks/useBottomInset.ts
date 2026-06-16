import { useEffect, useState } from 'react';

/**
 * Returns the height (in px) of the bottom safe area inset
 * (system home indicator on iOS/Android gesture navigation bar).
 *
 * Strategy:
 * 1. Reads `env(safe-area-inset-bottom)` via a dummy element (most reliable).
 * 2. Also monitors `window.visualViewport` resize to catch browser chrome
 *    appearing/hiding on scroll (Android Chrome bottom address bar).
 * 3. Syncs the value to a `--sab` CSS custom property on :root so that
 *    CSS can use it directly without waiting for JS re-renders.
 * 4. Does a deferred initial read via rAF to ensure the browser has fully
 *    laid out and computed env() values before the first read.
 */
export function useBottomInset(): number {
  const [bottomInset, setBottomInset] = useState(0);

  useEffect(() => {
    const update = () => {
      const safeAreaInset = readSafeAreaInsetBottom();
      const vv = window.visualViewport;
      let value = safeAreaInset;

      if (vv) {
        // Detect browser chrome (Android bottom address bar)
        const chromeInset = Math.max(
          0,
          window.innerHeight - (vv.height + (vv.offsetTop || 0)),
        );
        // Take the max: sometimes env() already includes chrome (iOS Safari)
        value = Math.max(safeAreaInset, chromeInset);
      }

      setBottomInset(value);
      // Sync to CSS custom property so CSS can use it without waiting for re-render
      document.documentElement.style.setProperty('--sab', `${value}px`);
    };

    // Deferred initial read: rAF ensures env() is computed after first paint
    const raf = requestAnimationFrame(() => {
      update();
    });

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);

    return () => {
      cancelAnimationFrame(raf);
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
    };
  }, []);

  return bottomInset;
}

/**
 * Reads `env(safe-area-inset-bottom)` from the CSS environment.
 * Injects a temporary fixed element to let the browser compute the env() value.
 * Returns 0 if unavailable or unparseable.
 */
function readSafeAreaInsetBottom(): number {
  if (typeof document === 'undefined') return 0;

  const dummy = document.createElement('div');
  dummy.style.cssText =
    'position:fixed;bottom:0;left:0;visibility:hidden;pointer-events:none;' +
    'height:env(safe-area-inset-bottom,0px);min-height:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(dummy);
  const value = parseFloat(getComputedStyle(dummy).height);
  document.body.removeChild(dummy);

  return isNaN(value) ? 0 : Math.max(0, value);
}
