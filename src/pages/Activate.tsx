import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, CloudOff } from 'lucide-react';
import { useAudioPlayback } from '@/contexts/AudioContext';
import { useLibraryMode } from '@/contexts/LibraryModeContext';
import { activatePassCode } from '@/services/api';
import { loadOwnedAlbumForPlayback, resolveAlbumDecryptionKey, saveActivationSnapshot } from '@/services/albumOwnership';
import { getOrCreateDeviceId } from '@/services/device';
import { downloadAlbumWithStreaming } from '@/services/downloadManager';
import { saveEncryptedValue } from '@/services/storage';
import { Screen, PageHeader } from '@/components/Screen';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { PublicAlbumDetails } from '@/types/backend';

function normalizePassCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
}

export function ActivateScreen() {
  const navigate = useNavigate();
  const { effectiveMode } = useLibraryMode();
  const { loadAlbum, loadLibrary, playTrackAtIndex } = useAudioPlayback();
  const isOfflineMode = effectiveMode === 'offline';

  const [passCode, setPassCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('Entrez votre code au format XXXX-XXXX (ex : L4WE-YC42).');
  const [feedbackType, setFeedbackType] = useState<'none' | 'success' | 'error'>('none');
  const [activatedAlbum, setActivatedAlbum] = useState<PublicAlbumDetails | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // 🧹 Efface le code 10s après une erreur pour faciliter la resaisie
  useEffect(() => {
    if (feedbackType !== 'error') return;
    const timer = setTimeout(() => {
      setPassCode('');
      setFeedback('Entrez votre code au format XXXX-XXXX (ex : L4WE-YC42).');
      setFeedbackType('none');
      inputRef.current?.focus();
    }, 10_000);
    return () => clearTimeout(timer);
  }, [feedbackType]);

  const canSubmit = passCode.length === 8 && !loading;

  async function handleActivate() {
    if (loading) return;
    const code = normalizePassCode(passCode);
    setPassCode(code);
    if (code.length !== 8) { setFeedback('Le PassCode doit contenir 8 caractères.'); setFeedbackType('error'); return; }
    const deviceId = await getOrCreateDeviceId();
    setLoading(true);
    setFeedback('Validation en cours...');
    setFeedbackType('none');
    try {
      const response = await activatePassCode(code, deviceId);
      await saveEncryptedValue('passio_last_activation', JSON.stringify({ code: response.passcode.code, album_id: response.album.id, activated_at: response.passcode.activated_at, device_id: response.device_id }));
      const albumId = response.album.id;
      const resolvedKey = await resolveAlbumDecryptionKey(albumId, response.decryption_key ?? null);
      await saveActivationSnapshot(response.album as PublicAlbumDetails, resolvedKey);
      setFeedback(`Album "${response.album.title}" activé !`);
      setFeedbackType('success');
      loadAlbum(response.album as PublicAlbumDetails, resolvedKey);
      void loadLibrary();
      setActivatedAlbum(response.album as PublicAlbumDetails);
      navigate(`/album/${albumId}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      let friendlyMessage = "Une erreur est survenue lors de l'activation.";
      if (message.includes('404')) friendlyMessage = "Ce PassCode n'existe pas.";
      else if (message.includes('400')) friendlyMessage = 'Ce code est invalide ou a expiré.';
      else if (message.includes('403')) friendlyMessage = 'Ce code est déjà utilisé sur un autre appareil.';
      else if (message.includes('Network request failed')) friendlyMessage = 'Impossible de contacter le serveur.';
      setFeedback(friendlyMessage);
      setFeedbackType('error');
    } finally { setLoading(false); }
  }

  function handleDownload() {
    if (!activatedAlbum) return;
    const album = activatedAlbum;
    void loadOwnedAlbumForPlayback(album.id).then((loaded) => {
      loadAlbum(loaded.album, loaded.decryptionKey);
      void downloadAlbumWithStreaming(loaded.album, loaded.decryptionKey, (_track, index) => { if (index === 0) void playTrackAtIndex(0); });
    });
  }

  const chars = passCode.split('');
  const displayValue = chars.length <= 4 ? passCode : `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;

  return (
    <Screen padded maxWidth="580px">
      <PageHeader 
        title="Libérez votre son exclusif."
        subtitle="Entrez votre PassCode pour activer votre album et l'ajouter à votre bibliothèque sécurisée."

      />
      
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div style={{ position: 'absolute', top: -120, right: -80, width: 250, height: 250, borderRadius: '50%', backgroundColor: 'rgba(120,0,0,0.15)', opacity: 0.5, pointerEvents: 'none' }} />

        {isOfflineMode && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 16, borderRadius: 16, backgroundColor: 'rgba(120,0,0,0.15)' }}>
            <CloudOff size={22} color="var(--color-accent)" style={{ flexShrink: 0 }} />
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: '20px', margin: 0 }}>
              Connexion requise pour activer un PassCode. Repassez en mode en ligne pour continuer.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32, opacity: isOfflineMode ? 0.45 : 1 }}>
          {/* PassCode Input */}
          <div
            onClick={(e) => {
              // Focus l'input caché quand on clique sur le conteneur
              const input = e.currentTarget.querySelector('input');
              if (input) input.focus();
            }}
            className={feedbackType === 'error' ? 'shake' : ''}
            style={{ position: 'relative', backgroundColor: 'var(--color-surface-elevated)', padding: 16, borderRadius: 24, boxShadow: `0 0 20px rgba(0,0,0,0.2)${feedbackType === 'error' ? ', 0 0 0 1.5px rgba(220,20,60,0.5)' : ''}`, cursor: 'text' }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '10px 0' }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{
                  width: 36, height: 46, borderRadius: 10,
                  backgroundColor: passCode[i] ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${i === passCode.length ? 'var(--color-accent)' : 'rgba(255,255,255,0.04)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: passCode[i] ? '0 0 10px rgba(120,0,0,0.15)' : undefined,
                }}>
                  <span style={{ color: '#fff', fontSize: 18, fontWeight: 800 }}>{passCode[i] || ''}</span>
                </div>
              ))}
            </div>
            <input
              ref={(el) => {
                inputRef.current = el;
                // Auto-focus au montage
                if (el && !isOfflineMode) setTimeout(() => el.focus(), 100);
              }}
              value={passCode}
              onChange={(e) => setPassCode(normalizePassCode(e.target.value))}
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect="false"
              spellCheck="false"
              placeholder="XXXX-XXXX"
              style={{
                width: '100%', height: 40, background: 'transparent', border: 'none',
                color: 'transparent', caretColor: 'var(--color-accent)', outline: 'none',
                fontSize: 18, fontWeight: 800, letterSpacing: 8, textAlign: 'center',
                position: 'absolute', opacity: 0, top: 0, left: 0,
              }}
              disabled={isOfflineMode}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <PrimaryButton
              label={loading ? 'Activation...' : "Valider le code"}
              onPress={handleActivate}
              disabled={!canSubmit || isOfflineMode}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center', marginTop: 10 }}>
              {feedbackType === 'success' && <CheckCircle size={18} color="#00C853" />}
              {feedbackType === 'error' && <AlertCircle size={18} color="#D50000" />}
              <p style={{
                color: feedbackType === 'success' ? '#00C853' : feedbackType === 'error' ? '#D50000' : 'rgba(255,255,255,0.75)',
                fontSize: 14, margin: 0, textAlign: 'center',
              }}>{feedback}</p>
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}
