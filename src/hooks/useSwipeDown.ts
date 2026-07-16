import { useCallback, useEffect, useRef, useState } from 'react';

interface UseSwipeDownOptions {
  /** Threshold in px to trigger dismiss (default: 120) */
  threshold?: number;
  /** Called when swipe down completes past threshold */
  onDismiss?: () => void;
  /** Called when swipe down is released below threshold */
  onCancel?: () => void;
  /** Whether the swipe handler is active */
  enabled?: boolean;
  /** Extra resistance factor (0 = no drag, 1 = full drag). Default: 0.6 */
  resistance?: number;
}

interface UseSwipeDownReturn {
  /** Current drag offset in px (0 = initial, >0 = swiped down) */
  dragOffset: number;
  /** Whether currently dragging */
  isDragging: boolean;
  /** Props to spread on the container element */
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onMouseDown?: (e: React.MouseEvent) => void;
    onMouseMove?: (e: React.MouseEvent) => void;
    onMouseUp?: () => void;
  };
  /** Reset drag position immediately */
  reset: () => void;
}

/**
 * useSwipeDown — Hook de swipe vers le bas avec résistance naturelle.
 *
 * Idéal pour les panneaux modaux / FullPlayer mobile.
 * Utilise uniquement les touch events pour les performances (pas de layer supplémentaire).
 * La résistance rend le drag plus naturel en fin de course.
 */
export function useSwipeDown({
  threshold = 120,
  onDismiss,
  onCancel,
  enabled = true,
  resistance = 0.6,
}: UseSwipeDownOptions = {}): UseSwipeDownReturn {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const currentOffsetRef = useRef(0);
  const isAnimatingRef = useRef(false);

  // Use a ref for the latest callbacks to avoid stale closures
  const callbacksRef = useRef({ onDismiss, onCancel });
  callbacksRef.current = { onDismiss, onCancel };

  const reset = useCallback(() => {
    currentOffsetRef.current = 0;
    setDragOffset(0);
    setIsDragging(false);
    isAnimatingRef.current = false;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    if (isAnimatingRef.current) return;

    // Only intercept if the touch starts in the top 40% of the player
    // (avoids conflicting with scrollable content like lyrics/queue)
    const rect = e.currentTarget.getBoundingClientRect();
    const touchY = e.touches[0].clientY - rect.top;
    if (touchY > rect.height * 0.4) return;

    startYRef.current = e.touches[0].screenY;
    setIsDragging(true);
    isAnimatingRef.current = false;
  }, [enabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    if (isAnimatingRef.current) return;

    const deltaY = e.touches[0].screenY - startYRef.current;
    if (deltaY <= 0) return; // Only allow downward swipe

    // Apply resistance: the further you drag, the more resistance
    let offset: number;
    if (deltaY < threshold) {
      offset = deltaY * resistance;
    } else {
      // Beyond threshold, extra resistance (feels like stretching a spring)
      const beyond = deltaY - threshold;
      offset = threshold * resistance + beyond * resistance * 0.3;
    }

    currentOffsetRef.current = offset;
    setDragOffset(offset);
  }, [isDragging, threshold, resistance]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    const offset = currentOffsetRef.current;
    if (offset >= threshold) {
      // Dismiss: animate out fully then call callback
      isAnimatingRef.current = true;
      currentOffsetRef.current = offset + 80; // Add momentum
      setDragOffset(offset + 80);
      setTimeout(() => {
        callbacksRef.current.onDismiss?.();
        reset();
      }, 200);
    } else {
      // Snap back
      isAnimatingRef.current = true;
      currentOffsetRef.current = 0;
      setDragOffset(0);
      setTimeout(() => {
        isAnimatingRef.current = false;
        callbacksRef.current.onCancel?.();
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
