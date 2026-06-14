import { useEffect, useState } from 'react';

/**
 * Returns the height (in px) of the bottom browser chrome / nav bar
 * (Safari bottom toolbar, Android Chrome URL bar) + system home indicator.
 *
 * Uses `window.visualViewport` which fires `resize` events when the
 * browser chrome appears/hides on scroll on mobile.
 *
 * Falls back to the CSS `env(safe-area-inset-bottom)` value when
 * visualViewport is unavailable (some older browsers).
 */
export function useBottomInset(): number {
  const [bottomInset, setBottomInset] = useState(() => {
    // Initial read: try CSS safe-area-inset-bottom directly
    return readSafeAreaInsetBottom();
  });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      // Fallback: poll safe-area-inset-bottom on resize when visualViewport is unavailable
      const onResize = () => setBottomInset(readSafeAreaInsetBottom());
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const handler = () => {
      // On mobile, the visual viewport shrinks when bottom browser UI appears.
      // diff = layout viewport height - (visual viewport height + top offset)
      // This gives us the height occupied by bottom browser chrome.
      const chromeInset = Math.max(0, window.innerHeight - (vv.height + (vv.offsetTop || 0)));
      const safeAreaInset = readSafeAreaInsetBottom();

      // Combine both: the browser nav bar + the system home indicator
      // We take the max because sometimes env(safe-area-inset-bottom) already
      // includes the browser chrome (iOS Safari does this).
      setBottomInset(Math.max(chromeInset, safeAreaInset));
    };

    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    // Also listen to window resize as a safety net
    window.addEventListener('resize', handler);

    // Run once immediately
    handler();

    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    };
  }, []);

  return bottomInset;
}

/**
 * Reads `env(safe-area-inset-bottom)` from the CSS environment.
 * Returns 0 if unavailable or unparseable.
 */
function readSafeAreaInsetBottom(): number {
  if (typeof document === 'undefined') return 0;

  // Use a dummy element to compute the env() value
  const dummy = document.createElement('div');
  dummy.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(dummy);
  const computed = getComputedStyle(dummy).paddingBottom;
  document.body.removeChild(dummy);

  const px = parseFloat(computed);
  return isNaN(px) ? 0 : Math.max(0, px);
}
