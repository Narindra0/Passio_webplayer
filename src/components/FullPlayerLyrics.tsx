import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchLyricsByUrl } from '@/services/api';
import { readLocalLyricsForTrack } from '@/services/downloadManager';

interface LyricLine {
  time: number;
  text: string;
}

interface FullPlayerLyricsProps {
  lyricsUrl: string | null;
  trackId?: string | null;
  currentTime: number;
  isPlaying: boolean;
  compact?: boolean;
}

function parseLrcContent(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const lrcRegex = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\](.*)$/;
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = trimmed.match(lrcRegex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3].padEnd(3, '0'), 10);
      const text = match[4].trim();
      if (text) lines.push({ time: minutes * 60 + seconds + milliseconds / 1000, text });
    }
  });
  return lines.sort((a, b) => a.time - b.time);
}

export function FullPlayerLyrics({ lyricsUrl, trackId, currentTime, isPlaying, compact }: FullPlayerLyricsProps) {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lyricsUrl && !trackId) { setLyrics([]); setError(null); return; }
    let mounted = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        if (trackId) {
          const local = await readLocalLyricsForTrack(trackId);
          if (local && mounted) {
            const parsed = parseLrcContent(local);
            if (parsed.length === 0) setError('Format LRC invalide');
            else setLyrics(parsed);
            setLoading(false);
            return;
          }
        }
        if (!lyricsUrl) { if (mounted) { setError('Paroles non disponibles'); setLoading(false); } return; }
        const content = await fetchLyricsByUrl(lyricsUrl);
        if (!mounted) return;
        const parsed = parseLrcContent(content);
        if (parsed.length === 0) setError('Format LRC invalide');
        else setLyrics(parsed);
      } catch { if (mounted) setError('Impossible de charger les paroles'); }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [lyricsUrl, trackId]);

  const currentLineIndex = useCallback(() => {
    if (lyrics.length === 0) return -1;
    for (let i = lyrics.length - 1; i >= 0; i--) { if (currentTime >= lyrics[i].time) return i; }
    return 0;
  }, [lyrics, currentTime]);

  const activeIndex = currentLineIndex();
  const currentLine = activeIndex >= 0 ? lyrics[activeIndex] : null;

  useEffect(() => {
    if (lyrics.length === 0 || activeIndex < 0) return;
    if (scrollRef.current) {
      if (compact) {
        if (!isPlaying) return;
        const lineHeight = 52;
        scrollRef.current.scrollTo({ top: Math.max(0, activeIndex * lineHeight - 150), behavior: 'smooth' });
      } else {
        const activeEl = scrollRef.current.querySelector(`[data-lyric-index="${activeIndex}"]`) as HTMLElement | null;
        if (activeEl) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [currentTime, isPlaying, activeIndex, lyrics.length, compact]);

  if (loading) return <div className="flex items-center justify-center p-8"><div className="loader-spinner" /></div>;
  if (error || lyrics.length === 0) return <div className="flex items-center justify-center p-8 text-muted">{error || 'Paroles non disponibles'}</div>;

  if (compact) {
    return (
      <div style={{ height: 66, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
        <p style={{ color: '#fff', fontSize: 18, fontWeight: 700, textAlign: 'center', margin: 0 }}>
          {currentLine?.text || '...'}
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '28px 28px 220px' }}>
      {lyrics.map((line, index) => {
        const isActive = index === activeIndex;
        const isPast = index < activeIndex;
        return (
          <div
            key={index}
            data-lyric-index={index}
            style={{
              padding: '8px 0 8px 18px',
              borderLeft: `3px solid ${isActive ? 'var(--color-accent)' : 'transparent'}`,
              marginBottom: 14,
              transition: 'all 0.2s ease',
            }}
          >
            <p style={{
              margin: 0,
              fontSize: isActive ? 28 : 24,
              lineHeight: isActive ? '38px' : '34px',
              color: isActive ? '#fff' : isPast ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.42)',
              fontWeight: 700,
              fontFamily: "var(--font-inter)",
              transition: 'all 0.2s ease',
            }}>
              {line.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
