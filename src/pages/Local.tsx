import { useState, useCallback, useEffect, useRef } from 'react';
import { Music, Play } from 'lucide-react';
import { Screen, PageHeader } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAudioPlayback } from '@/contexts/AudioContext';
import type { DeviceTrack } from '@/types/localLibrary';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function LocalScreen() {
  const [tracks, setTracks] = useState<DeviceTrack[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { playDeviceTrackAtIndex } = useAudioPlayback();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setIsLoading(true);
    setError(null);
    const audioFiles: DeviceTrack[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('audio/')) {
        audioFiles.push({
          id: `local-${i}-${Date.now()}`,
          uri: URL.createObjectURL(file),
          title: file.name.replace(/\.[^/.]+$/, ''),
          artist: 'Artiste inconnu',
          album: 'Fichier local',
          duration: 0,
          artworkUri: null,
        });
      }
    }
    if (audioFiles.length === 0) {
      setError('Aucun fichier audio trouvé. Sélectionnez des fichiers .mp3, .wav, .ogg etc.');
    }
    setTracks(audioFiles);
    setIsLoading(false);
  }, []);

  const handleTrackPress = useCallback((index: number) => {
    playDeviceTrackAtIndex(tracks, index);
  }, [tracks, playDeviceTrackAtIndex]);

  return (
    <Screen padded maxWidth="800px">
      <PageHeader 
        title="Fichiers Locaux"
        subtitle="Importez vos fichiers audio pour les écouter directement depuis votre appareil."
        style={{ paddingTop: 'var(--header-padding)' }}
      />

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <PrimaryButton
            label="Sélectionner des fichiers audio"
            onPress={() => fileInputRef.current?.click()}
          />
        </div>

        {error && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <p className="text-error">{error}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center p-10"><div className="loader-spinner" /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {tracks.map((track, index) => (
              <button
                key={track.id}
                onClick={() => handleTrackPress(index)}
                style={{
                  display: 'flex', alignItems: 'center', padding: '12px 24px',
                  border: 'none', background: 'none', cursor: 'pointer',
                  textAlign: 'left', width: '100%',
                }}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 8,
                  backgroundColor: 'var(--color-surface)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  marginRight: 16, flexShrink: 0,
                }}>
                  <Music size={24} color="rgba(255,255,255,0.75)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: '#fff', fontSize: 16, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {track.title}
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, margin: '4px 0 0 0' }}>
                    {track.artist}
                  </p>
                </div>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, margin: 0 }}>
                  {track.duration > 0 ? formatDuration(track.duration) : '--:--'}
                </p>
              </button>
            ))}
            {tracks.length === 0 && !isLoading && (
              <p className="text-muted" style={{ textAlign: 'center', marginTop: 40 }}>
                Sélectionnez des fichiers audio pour les écouter
              </p>
            )}
          </div>
        )}
    </Screen>
  );
}
