import { useCallback, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
  /** Called when the user triggers a refresh (pull past threshold and release) */
  onRefresh: () => Promise<void> | void;
  /** Threshold in px to trigger refresh (default: 70) */
  threshold?: number;
  /** Whether the pull-to-refresh is enabled */
  enabled?: boolean;
}

interface UsePullToRefreshReturn {
  /** Pull progress (0 to 1, where 1 = threshold reached) */
  pullProgress: number;
  /** Whether currently pulling down */
  isPulling: boolean;
  /** Whether currently refreshing (after release, before onRefresh completes) */
  isRefreshing: boolean;
  /** Whether the pull has passed the threshold and will trigger on release */
  isReady: boolean;
  /** Props to spread on the scrollable container */
  containerProps: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onScroll?: (e: React.UIEvent) => void;
    style?: React.CSSProperties;
  };
  /** Indicator style: transform to apply to the indicator element */
  indicatorStyle: React.CSSProperties;
}

/**
 * usePullToRefresh — Hook de pull-to-refresh tactile pour mobile.
 *
 * Fonctionnement :
 * 1. L'utilisateur tire vers le bas quand le scroll est en haut (scrollTop ≤ 0)
 * 2. Un indicateur visuel suit le doigt (progress 0→1)
 * 3. Au-delà du threshold, l'indicateur passe en mode "relâchez pour rafraîchir"
 * 4. Au relâchement, si threshold atteint → onRefresh() + spinner
 * 5. Au relâchement, si threshold non atteint → snap back
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 70,
  enabled = true,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const [pullProgress, setPullProgress] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isAtTopRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const reset = useCallback(() => {
    setPullProgress(0);
    setIsPulling(false);
    setIsReady(false);
    startYRef.current = 0;
    currentYRef.current = 0;
    isAtTopRef.current = false;
  }, []);

  const handleScroll = useCallback((e: React.UIEvent) => {
    const target = e.currentTarget as HTMLElement;
    isAtTopRef.current = target.scrollTop <= 0;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled || isRefreshing) return;

    const target = e.currentTarget as HTMLElement;

    // Only activate pull-to-refresh when at the top of the scroll
    if (target.scrollTop > 0) {
      isAtTopRef.current = false;
      return;
    }
    isAtTopRef.current = true;
    startYRef.current = e.touches[0].clientY;
    currentYRef.current = e.touches[0].clientY;
    setIsPulling(true);
  }, [enabled, isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled || !isPulling || isRefreshing) return;

    currentYRef.current = e.touches[0].clientY;
    const deltaY = currentYRef.current - startYRef.current;

    if (deltaY <= 0) {
      setPullProgress(0);
      setIsReady(false);
      return;
    }

    // Apply resistance: natural feel for the pull
    // Below threshold: linear with slight resistance
    // Above threshold: heavy resistance (rubber band)
    let progress: number;
    if (deltaY < threshold) {
      progress = deltaY / threshold;
    } else {
      const beyond = deltaY - threshold;
      // Rubber band effect: each pixel beyond the threshold counts less
      progress = 1 + beyond * 0.008;
    }

    // Clamp progress for the indicator animation
    const clamped = Math.min(progress, 1.5);
    setPullProgress(clamped);
    setIsReady(progress >= 1);
  }, [enabled, isPulling, isRefreshing, threshold]);

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !isPulling) return;

    if (isReady && !isRefreshing) {
      // Trigger refresh
      setIsRefreshing(true);
      setPullProgress(1);

      const result = onRefresh();
      const promise = result instanceof Promise ? result : Promise.resolve();

      refreshPromiseRef.current = promise;

      void promise.finally(() => {
        setIsRefreshing(false);
        reset();
        refreshPromiseRef.current = null;
      });
    } else {
      // Snap back
      reset();
    }
  }, [enabled, isPulling, isReady, isRefreshing, onRefresh, reset]);

  // Indicator transform: scale and rotate based on pull progress
  const indicatorStyle: React.CSSProperties = {
    opacity: isRefreshing ? 1 : Math.min(pullProgress * 2, 1),
    transform: isRefreshing
      ? 'translateY(0) scale(1)'
      : `translateY(${(pullProgress * threshold - threshold) * 0.5}px) scale(${Math.min(pullProgress * 0.5 + 0.5, 1)})`,
    transition: isPulling ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
    pointerEvents: isPulling || isRefreshing ? 'auto' : 'none',
  };

  return {
    pullProgress,
    isPulling,
    isRefreshing,
    isReady,
    containerProps: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onScroll: handleScroll,
    },
    indicatorStyle,
  };
}
