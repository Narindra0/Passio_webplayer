import { useCallback, useRef, useState } from 'react';

interface UseSwipeHorizontalOptions {
  /** Called when swipe left completes past threshold (next track) */
  onSwipeLeft?: () => void;
  /** Called when swipe right completes past threshold (previous track) */
  onSwipeRight?: () => void;
  /** Whether the swipe handler is active */
  enabled?: boolean;
  /** Horizontal threshold in px of raw finger movement to trigger navigation (default: 60) */
  threshold?: number;
  /** Whether a next track exists */
  hasNext?: boolean;
  /** Whether a previous track exists */
  hasPrev?: boolean;
}

interface UseSwipeHorizontalReturn {
  /** Normalized drag offset in px (> 0 = swiped right, < 0 = swiped left) */
  dragOffset: number;
  /** Whether currently dragging */
  isDragging: boolean;
  /** Props to spread on the swipeable container */
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
  /** Reset drag state immediately */
  reset: () => void;
}

/**
 * useSwipeHorizontal — Hook de swipe horizontal pour naviguer entre les pistes.
 *
 * Idéal pour le BottomPlayer mobile : swipe gauche → piste suivante,
 * swipe droit → piste précédente. Inclut un système de résistance naturelle
 * et un snap-back immédiat si le seuil n'est pas atteint.
 *
 * Le seuil de déclenchement compare le delta BRUT (pas la valeur résistée)
 * pour garantir une expérience cohérente sur tous les appareils.
 */
export function useSwipeHorizontal({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  threshold = 60,
  hasNext = false,
  hasPrev = false,
}: UseSwipeHorizontalOptions = {}): UseSwipeHorizontalReturn {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const lastDeltaRef = useRef(0);
  const currentOffsetRef = useRef(0);
  const isAnimatingRef = useRef(false);

  // Références pour éviter les stale closures
  const callbacksRef = useRef({ onSwipeLeft, onSwipeRight, hasNext, hasPrev });
  callbacksRef.current = { onSwipeLeft, onSwipeRight, hasNext, hasPrev };

  const reset = useCallback(() => {
    currentOffsetRef.current = 0;
    lastDeltaRef.current = 0;
    setDragOffset(0);
    setIsDragging(false);
    isAnimatingRef.current = false;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    if (isAnimatingRef.current) return;

    startXRef.current = e.touches[0].screenX;
    lastDeltaRef.current = 0;
    setIsDragging(true);
    isAnimatingRef.current = false;
  }, [enabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    if (isAnimatingRef.current) return;

    const deltaX = e.touches[0].screenX - startXRef.current;
    lastDeltaRef.current = deltaX;

    // Apply resistance for visual feedback only
    const absDelta = Math.abs(deltaX);
    let offset: number;
    if (absDelta < threshold) {
      offset = deltaX * 0.55;
    } else {
      const beyond = absDelta - threshold;
      const sign = deltaX > 0 ? 1 : -1;
      offset = sign * (threshold * 0.55 + beyond * 0.2);
    }

    currentOffsetRef.current = offset;
    setDragOffset(offset);
  }, [isDragging, threshold]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    const absDelta = Math.abs(lastDeltaRef.current);
    const direction = lastDeltaRef.current > 0 ? 'right' : 'left';
    const navState = callbacksRef.current;

    if (absDelta >= threshold && !isAnimatingRef.current) {
      isAnimatingRef.current = true;

      if (direction === 'right' && navState.hasPrev) {
        callbacksRef.current.onSwipeRight?.();
      } else if (direction === 'left' && navState.hasNext) {
        callbacksRef.current.onSwipeLeft?.();
      }

      // Reset for instant response
      reset();
    } else {
      // Snap back with spring animation
      isAnimatingRef.current = true;
      currentOffsetRef.current = 0;
      setDragOffset(0);
      setTimeout(() => {
        isAnimatingRef.current = false;
      }, 250);
    }
  }, [isDragging, threshold, reset]);

  return {
    dragOffset,
    isDragging,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    reset,
  };
}
