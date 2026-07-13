import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  TrendingUp,
  Play,
  Music,
  Flame,
} from 'lucide-react';
import { Screen } from '@/components/Screen';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { fetchPopularTracks } from '@/services/streamTracker';
import { getAlbum, listAlbums, unwrapAlbumDetails } from '@/services/api';
import { sortTracksByPosition } from '@/utils/tracks';
import { useCachedImage } from '@/hooks/useCachedImage';
import { formatTitle } from '@/utils/formatTitle';
import type { PublicAlbumDetails, PublicTrack } from '@/types/backend';

// ─── Types ────────────────────────────────────────────────────────────────

interface PopularTrackEntry {
  trackId: string;
  count: number;
  rank: number;
  track?: PublicTrack;
  album?: PublicAlbumDetails;
}

// ─── Composant ────────────────────────────────────────────────────────────

export function TopScreen() {
  const navigate = useNavigate();
  const { playFromTrackList } = useAudioPlayback();
  const [entries, setEntries] = useState<PopularTrackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const albumCacheRef = useRef<Map<string, PublicAlbumDetails>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // 1. Récupérer le top depuis le Worker
        const popular = await fetchPopularTracks();
        if (cancelled || popular.length === 0) {
          if (popular.length === 0) setError('Aucune donnée de streaming pour le moment.');
          setLoading(false);
          return;
        }

        // 2. Récupérer le catalogue pour enrichir les pistes
        const allAlbums = await listAlbums();
        const detailsMap = new Map<string, PublicAlbumDetails>();
        const trackToAlbum = new Map<string, { album: PublicAlbumDetails; track: PublicTrack }>();

        await Promise.all(
          allAlbums.map(async (summary) => {
            try {
              const raw = await getAlbum(summary.id);
              const details = unwrapAlbumDetails(raw);
              detailsMap.set(summary.id, details);
              const sorted = sortTracksByPosition(details.tracks || []);
              for (const t of sorted) {
                trackToAlbum.set(t.id, { album: details, track: t });
              }
            } catch { /* skip */ }
          }),
        );

        albumCacheRef.current = detailsMap;

        if (cancelled) return;

        // 3. Combiner les données
        const enriched: PopularTrackEntry[] = popular
          .map((item, index) => {
            const found = trackToAlbum.get(item.trackId);
            return {
              trackId: item.trackId,
              count: item.count,
              rank: index + 1,
              track: found?.track,
              album: found?.album,
            };
          })
          .filter((entry) => entry.track && entry.album); // Ne garder que les pistes trouvées

        setEntries(enriched.length > 0 ? enriched : popular.map((item, i) => ({
          trackId: item.trackId,
          count: item.count,
          rank: i + 1,
        })));
      } catch (err) {
        if (!cancelled) setError('Erreur lors du chargement du top.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  function handlePlayTrack(entry: PopularTrackEntry) {
    const validEntries = entries.filter((e) => e.track && e.album);
    if (validEntries.length === 0) return;

    const items = validEntries.map((e) => ({
      id: e.track!.id,
      album_id: e.album!.id,
    }));

    playFromTrackList(items, albumCacheRef.current, entry.trackId).catch(() => {});
  }

  const totalStreams = useMemo(
    () => entries.reduce((sum, e) => sum + e.count, 0),
    [entries],
  );

  return (
    <Screen gradient padded>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, paddingBottom: 24 }}>
        <button
          onClick={() => navigate('/discover')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 'var(--radius-full)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
            cursor: 'pointer', color: 'var(--color-text-secondary)',
            fontSize: 13, fontWeight: 600, flexShrink: 0,
            transition: 'all var(--transition-fast) ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface-elevated)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
        >
          <ArrowLeft size={16} />
          Retour
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: '0 0 20px rgba(239,68,68,0.3)',
          }}>
            <TrendingUp size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{
              color: 'var(--color-text-primary)', fontSize: 24, fontWeight: 700,
              margin: 0, lineHeight: 1.2,
            }}>
              Top Streams
            </h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '4px 0 0' }}>
              {entries.length > 0
                ? `${entries.length} titres · ${totalStreams.toLocaleString('fr-FR')} écoutes`
                : 'Classement des titres les plus écoutés'}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="loader-spinner" style={{ width: 32, height: 32 }} />
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Music size={40} color="var(--color-text-muted)" style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ color: 'var(--color-text-muted)', fontSize: 15, maxWidth: 400, margin: '0 auto' }}>
            {error}
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 8, opacity: 0.6 }}>
            Les écoutes commencent à se cumuler dès que des utilisateurs écoutent des pistes.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {entries.map((entry) => (
            <TopTrackRow
              key={entry.trackId}
              entry={entry}
              onPlay={() => handlePlayTrack(entry)}
            />
          ))}
        </div>
      )}
    </Screen>
  );
}

// ─── Row Component ────────────────────────────────────────────────────────

function TopTrackRow({
  entry,
  onPlay,
}: {
  entry: PopularTrackEntry;
  onPlay: () => void;
}) {
  const cachedCover = useCachedImage(entry.album?.cover_url || null);

  const formattedCount = useMemo(() => {
    if (entry.count >= 1_000_000) return `${(entry.count / 1_000_000).toFixed(1)}M`;
    if (entry.count >= 1_000) return `${(entry.count / 1_000).toFixed(1)}k`;
    return String(entry.count);
  }, [entry.count]);

  return (
    <button
      onClick={onPlay}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm)',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        transition: 'all var(--transition-fast) ease',
        color: 'inherit',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Rank badge */}
      <div style={{
        width: 32, height: 32, borderRadius: 'var(--radius-full)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        background: entry.rank <= 3
          ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
          : 'var(--color-surface-elevated)',
        color: entry.rank <= 3 ? '#fff' : 'var(--color-text-muted)',
        fontSize: 13,
        fontWeight: 700,
        boxShadow: entry.rank <= 3 ? '0 0 12px rgba(239,68,68,0.3)' : 'none',
      }}>
        {entry.rank}
      </div>

      {/* Cover */}
      {entry.album?.cover_url ? (
        <img
          src={cachedCover || entry.album.cover_url}
          alt=""
          loading="lazy"
          style={{
            width: 44, height: 44,
            borderRadius: 'var(--radius-sm)',
            objectFit: 'cover',
            backgroundColor: 'var(--color-surface-elevated)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div style={{
          width: 44, height: 44,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface-elevated)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Music size={18} color="var(--color-text-muted)" />
        </div>
      )}

      {/* Track info */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          color: 'var(--color-text-primary)',
          fontSize: 14, fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: '20px',
        }}>
          {entry.track ? formatTitle(entry.track.title) : entry.trackId}
        </div>
        {entry.track && (
          <div style={{
            color: 'var(--color-text-muted)',
            fontSize: 12, fontWeight: 500,
            marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {entry.album?.artist_name || entry.album?.artist?.name || 'Artiste inconnu'}
          </div>
        )}
      </div>

      {/* Stream count badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 12px',
        borderRadius: 'var(--radius-full)',
        background: 'var(--color-accent-soft)',
        border: '1px solid rgba(220,20,60,0.15)',
        flexShrink: 0,
      }}>
        <Flame size={14} color="#ef4444" />
        <span style={{
          color: '#ef4444',
          fontSize: 12,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {formattedCount}
        </span>
      </div>

      {/* Play indicator */}
      <div style={{
        width: 32, height: 32,
        borderRadius: 'var(--radius-full)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        color: 'var(--color-text-muted)',
        transition: 'all var(--transition-fast) ease',
      }}>
        <Play size={16} />
      </div>
    </button>
  );
}
