import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Lock, Play, Pause, ShieldCheck, Radio, Clock, Download, CheckCircle, AlertCircle } from 'lucide-react';
import { useAudioPlayback, useAudioProgress } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { loadOwnedAlbumForPlayback, resolveAlbumDecryptionKey, albumHasStreamableTracks } from '@/services/albumOwnership';
import { readEncryptedValue } from '@/services/storage';
import { resolveOfflinePlayback } from '@/services/offlineAccess';
import { downloadAlbumWithStreaming, subscribeToDownloadProgress, getDownloadProgress, isAlbumReadyOffline, type DownloadProgress } from '@/services/downloadManager';
import { Screen, PageHeader } from '@/components/Screen';
import { PrimaryButton } from '@/components/PrimaryButton';
import { LyricsDisplay } from '@/components/LyricsDisplay';
import { getPurchaseAlbumUrl } from '@/config/urls';
import type { PublicAlbumDetails, PublicTrack } from '@/types/backend';

export function AlbumDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const audio = useAudioPlayback();
  const { progress, duration } = useAudioProgress();
  const { effectiveMode } = useLibraryMode();

  const [album, setAlbum] = useState<PublicAlbumDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [decryptionKey, setDecryptionKey] = useState<string | null>(null);
  const [ownedByDevice, setOwnedByDevice] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isOfflineReady, setIsOfflineReady] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const loadAlbumData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const offline = await resolveOfflinePlayback(id);
    if (offline.metadata) {
      setAlbum(offline.metadata);
      setDecryptionKey(offline.decryptionKey);
      setOwnedByDevice(true);
      const ready = await isAlbumReadyOffline(id);
      setIsOfflineReady(ready);
      setLoading(false);
      if (effectiveMode === 'offline') return;
    }
    try {
      const loaded = await loadOwnedAlbumForPlayback(id);
      setOwnedByDevice(loaded.ownedByDevice);
      setAlbum(loaded.album);
      setDecryptionKey(loaded.decryptionKey);
      const ready = await isAlbumReadyOffline(id);
      setIsOfflineReady(ready);
    } catch { /* ignore */ }
    setLoading(false);
  }, [id, effectiveMode]);

  useEffect(() => {
    void loadAlbumData();
    if (id) {
      unsubscribeRef.current = subscribeToDownloadProgress(id, (p) => {
        setDownloadProgress(p);
        if (p.status === 'completed') setIsOfflineReady(true);
      });
      const existing = getDownloadProgress(id);
      if (existing) { setDownloadProgress(existing); if (existing.status === 'completed') setIsOfflineReady(true); }
    }
    return () => { if (unsubscribeRef.current) unsubscribeRef.current(); };
  }, [id, loadAlbumData]);

  useEffect(() => { setShowLyrics(false); }, [audio.currentTrack?.id]);

  if (loading) return <Screen><div className="flex justify-center items-center" style={{ minHeight: 300 }}><div className="loader-spinner" /></div></Screen>;
  if (!album) return <Screen><div className="flex flex-col items-center gap-4 p-10"><p className="text-muted">Album introuvable</p><button onClick={() => navigate(-1)} className="btn btn-secondary">Retour</button></div></Screen>;

  const isFreeRelease = Boolean(album.is_free);
  const streamReady = Boolean(isFreeRelease && album.stream_status === 'ready' && album.stream_url);
  const isOwned = ownedByDevice || Boolean(decryptionKey);
  const isPaidNotOwned = !isFreeRelease && !isOwned;
  const canPlay = (isFreeRelease && streamReady) || isOwned;
  const sortedTracks = [...(album.tracks || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  async function handlePressTrack(track: PublicTrack, index: number) {
    if (!canPlay || !album) return;
    setActionError(null);
    let playAlbum = album;
    let playKey = decryptionKey;
    if (isOwned && playAlbum && (!playKey || !albumHasStreamableTracks(playAlbum))) {
      const loaded = await loadOwnedAlbumForPlayback(playAlbum.id);
      playAlbum = loaded.album; playKey = loaded.decryptionKey;
      if (loaded.decryptionKey) setDecryptionKey(loaded.decryptionKey);
      setOwnedByDevice(loaded.ownedByDevice);
    }
    const isCurrentAlbum = audio.album?.id === playAlbum?.id;
    if (!isCurrentAlbum && playAlbum) audio.loadAlbum(playAlbum, playKey);
    if (audio.currentTrack?.id === track.id && isCurrentAlbum) { audio.togglePlayPause(); return; }
    if (!isCurrentAlbum) await new Promise(r => setTimeout(r, 50));
    try { await audio.playTrackAtIndex(index); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Impossible de lire ce titre.'); }
  }

  async function handleDownload() {
    if (!album) return;
    setActionError(null);
    const loaded = await loadOwnedAlbumForPlayback(album.id);
    const key = decryptionKey ?? loaded.decryptionKey ?? (await resolveAlbumDecryptionKey(album.id, null));
    if (key) setDecryptionKey(key);
    const status = await downloadAlbumWithStreaming(loaded.album, key, (track, index) => { if (!audio.isPlaying && audio.currentTrack?.id !== track.id) void audio.playTrackAtIndex(index); });
    if (status === 'completed') setIsOfflineReady(true);
    else if (status === 'error') setActionError(getDownloadProgress(album.id)?.error ?? 'Échec du téléchargement.');
  }

  return (
    <Screen padded={false}>
      <div style={{ maxWidth: 800, margin: '0 auto', width: '100%' }}>
        {/* Gradient decoration */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300, background: 'linear-gradient(180deg, rgba(120,0,0,0.1), transparent)', pointerEvents: 'none', zIndex: 0 }} />

        {/* Header with cover */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--page-padding)', paddingTop: 20, gap: 24 }}>
          <div style={{ alignSelf: 'flex-start' }}>
            <button onClick={() => navigate(-1)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <ChevronLeft size={28} color="#fff" />
            </button>
          </div>

          <div className="album-cover" style={{ width: '85%', maxWidth: 400, aspectRatio: '1', borderRadius: 32, overflow: 'hidden', boxShadow: '0 20px 30px rgba(120,0,0,0.3)' }}>
            {album.cover_url ? (
              <img src={album.cover_url} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--color-surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 64, color: 'rgba(255,255,255,0.18)' }}>♪</span>
              </div>
            )}
          </div>

          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, padding: '0 8px' }}>
            <h1 style={{ color: '#fff', fontSize: 22, fontFamily: "var(--font-hanken)", fontWeight: 700, lineHeight: '31px', margin: 0 }}>
              <span style={{ color: 'var(--color-accent)', fontFamily: "var(--font-inter)", fontWeight: 800, textTransform: 'uppercase', fontSize: 14, letterSpacing: 1 }}>
                {album.artist_name || album.artist?.name}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}> — </span>
              {album.title}
            </h1>
            {isOwned && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: '5px 12px', borderRadius: 12 }}>
                <ShieldCheck size={13} color="#00C853" />
                <span style={{ color: '#00C853', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Album activé</span>
              </div>
            )}
            {isOfflineReady && isOwned && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: '5px 12px', borderRadius: 12 }}>
                <CheckCircle size={13} color="#00C853" />
                <span style={{ color: '#00C853', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Disponible hors-ligne</span>
              </div>
            )}
          </div>
        </div>

        {/* Purchase section */}
        {isPaidNotOwned && (
          <div className="album-purchase-section" style={{ margin: '0 24px 28px', padding: 24, backgroundColor: 'var(--color-surface-elevated)', borderRadius: 28, border: '1px solid rgba(120,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>Prix de l'album</p>
              <p style={{ color: 'var(--color-accent)', fontSize: 28, fontFamily: "var(--font-hanken)", fontWeight: 700, margin: 0 }}>
                {album.price_ariary > 0 ? `${album.price_ariary.toLocaleString()} Ar` : 'Gratuit'}
              </p>
            </div>
            <a href={getPurchaseAlbumUrl(id!)} target="_blank" rel="noopener noreferrer">
              <PrimaryButton label="Acheter sur le Web" />
            </a>
            <button onClick={() => navigate('/activate')} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}>
              <Lock size={14} color="var(--color-accent)" />
              <span style={{ color: 'var(--color-accent)', fontSize: 14, fontWeight: 600 }}>J'ai déjà un PassCode →</span>
            </button>
          </div>
        )}

        {/* Track list */}
        <div style={{ padding: 'var(--page-padding)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 800, margin: 0 }}>
              {showLyrics ? 'Paroles' : 'Pistes'}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {audio.currentTrack?.has_lyrics && (
                <button onClick={() => setShowLyrics(!showLyrics)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <Radio size={20} color="var(--color-accent)" />
                </button>
              )}
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: 600 }}>{album.tracks?.length ?? 0} titres</span>
            </div>
          </div>

          {showLyrics && audio.currentTrack && (
            <div style={{ height: 300, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, overflow: 'hidden', marginBottom: 24 }}>
              <LyricsDisplay lyricsUrl={audio.currentTrack.lyrics_url || null} trackId={audio.currentTrack.id} currentTime={progress * duration} isPlaying={audio.isPlaying} />
            </div>
          )}

          {sortedTracks.map((track, index) => {
            const isCurrent = audio.currentTrack?.id === track.id;
            const isThisPlaying = isCurrent && audio.isPlaying;
            return (
              <button
                key={track.id}
                onClick={() => void handlePressTrack(track, index)}
                disabled={!canPlay && !isPaidNotOwned}
                style={{
                  display: 'flex', alignItems: 'flex-start', padding: 16, width: '100%',
                  backgroundColor: isCurrent ? 'rgba(120,0,0,0.15)' : 'rgba(255,255,255,0.035)',
                  border: `1px solid ${isCurrent ? 'rgba(120,0,0,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 18, gap: 16, marginBottom: 10, cursor: canPlay ? 'pointer' : 'default',
                  textAlign: 'left', opacity: !canPlay && !isPaidNotOwned ? 0.5 : 1,
                }}
              >
                <div style={{ width: 28, textAlign: 'center', paddingTop: 2 }}>
                  {isThisPlaying ? <Pause size={16} color="var(--color-accent)" /> : isCurrent ? <Play size={16} color="var(--color-accent)" /> : <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: 800 }}>{index + 1}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: isCurrent ? 'var(--color-accent)' : '#fff', fontSize: 14, fontWeight: 600, lineHeight: '20px', margin: 0 }}>{track.title}</p>
                </div>
                {isPaidNotOwned ? <Lock size={16} color="rgba(255,255,255,0.45)" /> : isThisPlaying ? <Pause size={18} color="var(--color-accent)" /> : <Play size={18} color={isCurrent ? 'var(--color-accent)' : 'rgba(255,255,255,0.3)'} />}
              </button>
            );
          })}
        </div>

        {actionError && (
          <div style={{ margin: '16px 24px', padding: 12, borderRadius: 12, backgroundColor: 'rgba(120,0,0,0.12)', border: '1px solid rgba(120,0,0,0.35)' }}>
            <p className="text-error" style={{ fontSize: 13, lineHeight: '18px', margin: 0 }}>{actionError}</p>
          </div>
        )}

        {isOwned && !isOfflineReady && (
          <div style={{ margin: '24px 24px', padding: 16, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
            {downloadProgress?.status === 'downloading' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Download size={16} color="var(--color-accent)" />
                  <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{Math.round(downloadProgress.progress)}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${downloadProgress.progress}%` }} />
                </div>
              </div>
            ) : (
              <button onClick={handleDownload} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 12, width: '100%' }}>
                <Download size={18} color="var(--color-accent)" />
                <span style={{ color: 'var(--color-accent)', fontSize: 14, fontWeight: 600 }}>Télécharger hors-ligne</span>
              </button>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}
