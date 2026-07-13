import { readEncryptedValue, saveEncryptedValue } from '@/services/storage';

const VAULT_PLAIN_AUDIO_MARKER = '__PASSIO_VAULT_PLAIN__';

export { VAULT_PLAIN_AUDIO_MARKER };

/**
 * Persiste une clé de déchiffrement dans le vault local.
 * Utilise désormais le format enrichi avec timestamp via keyManager.
 * Cette fonction sert de point d'entrée unique pour les autres services.
 */
export async function persistVaultDecryptionKey(albumId: string, decryptionKey: string | null): Promise<void> {
  const { storeKey } = await import('./keyManager');
  await storeKey(albumId, decryptionKey);
}

/**
 * Lit et valide une clé de déchiffrement depuis le vault local.
 * Fait appel à keyManager.readKey() pour la validation d'expiration.
 */
export async function readVaultDecryptionKey(albumId: string): Promise<string | null> {
  try {
    const { readKey } = await import('./keyManager');
    return readKey(albumId);
  } catch {
    return null;
  }
}

/**
 * Vérifie si une clé existe dans le vault (sans validation d'expiration).
 */
export async function vaultHasCredentials(albumId: string): Promise<boolean> {
  try {
    const stored = await readEncryptedValue(`passio_key_${albumId}`);
    return Boolean(stored);
  } catch {
    return false;
  }
}
