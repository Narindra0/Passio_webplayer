import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchLyricsByUrl } from '@/services/api';
import { readLocalLyricsForTrack } from '@/services/downloadManager';

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsDisplayProps {
  lyricsUrl: string | null;
  trackId?: string | null;
  currentTime: number;
  isPlaying: boolean;
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
      if (text) {
        lines.push({ time: minutes * 60 + seconds + milliseconds / 1000, text });
      }
    }
  });
  return lines.sort((a, b) => a.time - b.time);
}

export function LyricsDisplay({ lyricsUrl, trackId, currentTime, isPlaying }: LyricsDisplayProps) {
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
        if (!lyricsUrl) {
          if (mounted) { setError('Paroles non disponibles hors-ligne'); setLoading(false); }
          return;
        }
        const content = await fetchLyricsByUrl(lyricsUrl);
        if (!mounted) return;
        const parsed = parseLrcContent(content);
        if (parsed.length === 0) setError('Format LRC invalide');
        else setLyrics(parsed);
      } catch {
        if (mounted) setError('Impossible de charger les paroles');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [lyricsUrl, trackId]);

  const currentLineIndex = useCallback(() => {
    if (lyrics.length === 0) return -1;
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics[i].time) return i;
    }
    return 0;
  }, [lyrics, currentTime]);

  useEffect(() => {
    if (!isPlaying || lyrics.length === 0) return;
    const index = currentLineIndex();
    if (index >= 0 && scrollRef.current) {
      const lineHeight = 40;
      scrollRef.current.scrollTo({ top: Math.max(0, index * lineHeight - 150), behavior: 'smooth' });
    }
  }, [currentTime, isPlaying, currentLineIndex, lyrics.length]);

  if (loading) return <div className="flex items-center justify-center p-8"><div className="loader-spinner" /></div>;
  if (error) return <div className="flex flex-col items-center gap-3 p-8"><p className="text-muted">{error}</p></div>;
  if (lyrics.length === 0) return <div className="flex flex-col items-center gap-3 p-8"><p className="text-muted">Paroles non disponibles</p></div>;

  const activeIndex = currentLineIndex();

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 16px', maxHeight: '100%' }}>
      {lyrics.map((line, index) => {
        const isActive = index === activeIndex;
        const isPast = index < activeIndex;
        return (
          <div
            key={index}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              backgroundColor: isActive ? 'rgba(120, 0, 0, 0.12)' : 'transparent',
              marginBottom: 4,
            }}
          >
            <p style={{
              margin: 0,
              fontSize: isActive ? 18 : 16,
              lineHeight: '24px',
              color: isActive ? 'var(--color-accent)' : isPast ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)',
              fontWeight: isActive ? 600 : 400,
              textAlign: 'center',
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
