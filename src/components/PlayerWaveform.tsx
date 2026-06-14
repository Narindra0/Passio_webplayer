import React, { useMemo, useRef } from 'react';

const BAR_COUNT = 52;
const BAR_WIDTH = 3;
const BAR_GAP = 2.5;
const MIN_BAR_RATIO = 0.22;
const MAX_BAR_RATIO = 1;

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generateBarHeights(seed: string, count: number): number[] {
  let state = hashSeed(seed || 'default');
  const heights: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const t = state / 0xffffffff;
    const envelope = 0.55 + 0.45 * Math.sin((i / count) * Math.PI);
    const ratio = MIN_BAR_RATIO + (MAX_BAR_RATIO - MIN_BAR_RATIO) * t * envelope;
    heights.push(ratio);
  }
  return heights;
}

export interface PlayerWaveformProps {
  progress: number;
  onSeek: (ratio: number) => void;
  trackKey?: string;
  playedColor?: string;
  unplayedColor?: string;
}

export function PlayerWaveform({
  progress,
  onSeek,
  trackKey = 'default',
  playedColor = '#ffffff',
  unplayedColor = 'rgba(255,255,255,0.22)',
}: PlayerWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clampedProgress = Math.max(0, Math.min(1, progress));

  const barHeights = useMemo(() => generateBarHeights(trackKey, BAR_COUNT), [trackKey]);

  const handleClick = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    onSeek(Math.max(0, Math.min(1, x / rect.width)));
  };

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      style={{
        height: 60,
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        position: 'relative',
        width: '100%',
      }}

    >
      <div style={{ display: 'flex', alignItems: 'center', gap: BAR_GAP, width: '100%', height: 44, justifyContent: 'center' }}>
        {barHeights.map((ratio, index) => {
          const barCenter = (index + 0.5) / BAR_COUNT;
          const isPlayed = barCenter <= clampedProgress;
          return (
            <div
              key={index}
              style={{
                width: BAR_WIDTH,
                height: `${ratio * 44}px`,
                borderRadius: BAR_WIDTH / 2,
                backgroundColor: isPlayed ? playedColor : unplayedColor,
                transition: 'background-color 0.1s ease',
                flexShrink: 0,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
