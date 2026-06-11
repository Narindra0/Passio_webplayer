import { getApiBaseUrl } from '@/services/api';
import { readEncryptedValue, saveEncryptedValue } from '@/services/storage';

const VAULT_PLAIN_AUDIO_MARKER = '__PASSIO_VAULT_PLAIN__';

export { VAULT_PLAIN_AUDIO_MARKER };

export async function persistVaultDecryptionKey(albumId: string, decryptionKey: string | null): Promise<void> {
  if (decryptionKey) {
    await saveEncryptedValue(`passio_key_${albumId}`, decryptionKey);
    return;
  }
  await saveEncryptedValue(`passio_key_${albumId}`, VAULT_PLAIN_AUDIO_MARKER);
}

export async function readVaultDecryptionKey(albumId: string): Promise<string | null> {
  const stored = await readEncryptedValue(`passio_key_${albumId}`);
  if (!stored || stored === VAULT_PLAIN_AUDIO_MARKER) return null;
  return stored;
}

export async function vaultHasCredentials(albumId: string): Promise<boolean> {
  const stored = await readEncryptedValue(`passio_key_${albumId}`);
  return Boolean(stored);
}
