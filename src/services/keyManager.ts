/**
 * keyManager.ts — Gestion centralisée du cycle de vie des clés de déchiffrement.
 *
 * Responsabilités :
 * 1. Stocker les clés avec horodatage d'expiration
 * 2. Valider les clés à la lecture (expiration)
 * 3. Révoquer les clés invalides (déconnexion, expiration des droits)
 * 4. Nettoyer les fichiers audio associés lors de la révocation
 * 5. Synchroniser les clés avec le serveur au retour en ligne
 *
 * Format de stockage (localStorage, encodé en base64 via storage.ts) :
 *   passio_key_{albumId} → { key: string, storedAt: ISO, expiresAt: ISO, verifiedOnlineAt: ISO }
 */

import { logger } from '@/utils/logger';
import { readEncryptedValue, saveEncryptedValue, deleteEncryptedValue } from '@/services/storage';
import { deleteAudioFromCache, clearAudioCache } from '@/services/offlineCache';
import { VAULT_PLAIN_AUDIO_MARKER } from '@/constants/vault';

// ── Constantes ─────────────────────────────────────────────────────────────

/** Durée de validité d'une clé depuis sa dernière vérification en ligne : 30 jours */
const KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Durée de grâce après expiration : 7 jours — l'utilisateur peut encore écouter */
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/** Préfixe pour le suivi du dernier check en ligne */
const LAST_ONLINE_CHECK_KEY = 'passio_last_key_online_check';

// ── Types ──────────────────────────────────────────────────────────────────

export interface KeyPayload {
  /** Clé de déchiffrement (hex string pour AES, ou XOR) */
  key: string;
  /** Date ISO du stockage initial */
  storedAt: string;
  /** Date ISO d'expiration (storedAt + KEY_TTL_MS) */
  expiresAt: string;
  /** Date ISO de la dernière vérification en ligne réussie */
  verifiedOnlineAt: string | null;
}

export type KeyStatus = 'valid' | 'expired' | 'grace' | 'revoked';

// ── Stockage des clés enrichi ──────────────────────────────────────────────

/**
 * Stocke une clé de déchiffrement avec son timestamp d'expiration.
 * Met à jour la date de vérification en ligne.
 */
export async function storeKey(albumId: string, decryptionKey: string | null): Promise<void> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + KEY_TTL_MS).toISOString();

  if (decryptionKey) {
    const payload: KeyPayload = {
      key: decryptionKey,
      storedAt: now,
      expiresAt,
      verifiedOnlineAt: now,
    };
    await saveEncryptedValue(`passio_key_${albumId}`, JSON.stringify(payload));
    logger.info('[KeyManager] ✅ Clé stockée pour', albumId, '— expire le', expiresAt);
  } else {
    // Album gratuit : stocker le marqueur
    await saveEncryptedValue(`passio_key_${albumId}`, VAULT_PLAIN_AUDIO_MARKER);
  }
}

/**
 * Lit et valide une clé de déchiffrement.
 * Retourne null si la clé est expirée (hors période de grâce) ou inexistante.
 */
export async function readKey(albumId: string): Promise<string | null> {
  const raw = await readEncryptedValue(`passio_key_${albumId}`);

  if (!raw) return null;

  // Marqueur d'album gratuit
  if (raw === VAULT_PLAIN_AUDIO_MARKER) return null;

  // Ancien format (clé brute) — migration silencieuse
  if (!raw.startsWith('{')) {
    return raw;
  }

  // Nouveau format JSON avec payload enrichi
  try {
    const payload = JSON.parse(raw) as KeyPayload;
    const status = getKeyStatus(payload);

    if (status === 'valid' || status === 'grace') {
      return payload.key;
    }

    // Clé expirée — ne pas la retourner (le offline player saura gérer)
    logger.warn('[KeyManager] ⏰ Clé expirée pour', albumId, '— statut:', status);
    return null;
  } catch {
    // Format invalide — retourner la valeur brute (rétrocompatibilité)
    return raw;
  }
}

/**
 * Évalue le statut d'une clé stockée.
 */
export function getKeyStatus(payload: KeyPayload): KeyStatus {
  const now = Date.now();
  const expiresAt = new Date(payload.expiresAt).getTime();
  const graceEnd = expiresAt + GRACE_PERIOD_MS;

  if (now < expiresAt) return 'valid';
  if (now < graceEnd) return 'grace';
  return 'expired';
}

/**
 * Met à jour la date de vérification en ligne d'une clé.
 * Prolonge sa durée de vie.
 */
export async function touchKeyOnline(albumId: string): Promise<void> {
  const raw = await readEncryptedValue(`passio_key_${albumId}`);
  if (!raw || raw === VAULT_PLAIN_AUDIO_MARKER || !raw.startsWith('{')) {
    // Ancien format ou gratuit — stocker avec nouveau format si clé existe
    // Lecture directe via readEncryptedValue (pas de dépendance circulaire)
    if (raw && raw !== VAULT_PLAIN_AUDIO_MARKER) {
      await storeKey(albumId, raw);
    }
    return;
  }

  try {
    const payload = JSON.parse(raw) as KeyPayload;
    const now = new Date().toISOString();
    const newExpiry = new Date(Date.now() + KEY_TTL_MS).toISOString();

    payload.verifiedOnlineAt = now;
    payload.expiresAt = newExpiry;

    await saveEncryptedValue(`passio_key_${albumId}`, JSON.stringify(payload));
    logger.info('[KeyManager] 🔄 Clé renouvelée pour', albumId, '— expire le', newExpiry);
  } catch {
    // Ignorer
  }
}

// ── Révocation ─────────────────────────────────────────────────────────────

/**
 * Révoque une clé : supprime la clé + les fichiers audio associés.
 */
export async function revokeKey(albumId: string, deleteAudio: boolean = true): Promise<void> {
  await deleteEncryptedValue(`passio_key_${albumId}`);

  if (deleteAudio) {
    // Supprimer les fichiers audio du cache via les métadonnées locales
    try {
      const metadataRaw = localStorage.getItem(`passio_album_metadata_${albumId}`);
      if (metadataRaw) {
        const metadata = JSON.parse(metadataRaw) as { tracks?: { id: string }[] };
        if (metadata.tracks) {
          for (const track of metadata.tracks) {
            await deleteAudioFromCache(track.id);
          }
        }
      }
      localStorage.removeItem(`passio_album_metadata_${albumId}`);
    } catch {
      // Silencieux
    }
  }

  logger.info('[KeyManager] 🗑️ Clé révoquée pour', albumId);
}

/**
 * Révoque TOUTES les clés et vide le cache audio.
 */
export async function revokeAllKeys(): Promise<void> {
  // Lister toutes les clés stockées
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('passio_key_')) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

  // Vider le cache audio complet
  await clearAudioCache();

  // Nettoyer les métadonnées
  const metadataKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('passio_album_metadata_')) {
      metadataKeys.push(key);
    }
  }
  for (const key of metadataKeys) {
    localStorage.removeItem(key);
  }

  // Nettoyer les mappings de cache
  const cacheMapKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('passio_audio_cache_map_')) {
      cacheMapKeys.push(key);
    }
  }
  for (const key of cacheMapKeys) {
    localStorage.removeItem(key);
  }

  logger.info('[KeyManager] 🗑️ Toutes les clés et données offline révoquées');
}

/**
 * Marque la date du dernier check en ligne.
 */
export async function markOnlineCheck(): Promise<void> {
  try {
    localStorage.setItem(LAST_ONLINE_CHECK_KEY, new Date().toISOString());
  } catch {
    // ignore
  }
}

// ── Validation en ligne ────────────────────────────────────────────────────

/**
 * Valide toutes les clés locales contre le serveur.
 * À appeler au retour en ligne.
 *
 * Stratégie :
 * 1. Récupère la liste des albums possédés depuis le serveur
 * 2. Pour chaque clé locale, vérifie si l'album est toujours possédé
 * 3. Si non → révoque la clé + supprime le cache audio
 * 4. Si oui → prolonge la validité de la clé
 */
export async function validateAllKeysOnline(): Promise<{
  validated: number;
  revoked: number;
}> {
  let validated = 0;
  let revoked = 0;

  try {
    // Importer dynamiquement pour éviter les dépendances circulaires
    const { listOwnedAlbums } = await import('./api');
    const ownedAlbums = await listOwnedAlbums();
    const ownedIds = new Set(ownedAlbums.map((a) => a.id));

    // Lister les clés locales
    const localAlbumIds: string[] = [];
  // Le préfixe storage.ts (passio_) + la clé (passio_key_) = passio_passio_key_
  const KEY_PREFIX = 'passio_passio_key_';
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) {
      const albumId = key.slice(KEY_PREFIX.length);
      if (albumId && albumId.length > 0) {
        localAlbumIds.push(albumId);
      }
    }
  }

    for (const albumId of localAlbumIds) {
      if (ownedIds.has(albumId)) {
        // L'album est toujours possédé → prolonger la clé
        await touchKeyOnline(albumId);
        validated++;
      } else {
        // L'album n'est plus possédé → révoquer
        await revokeKey(albumId, true);
        revoked++;
      }
    }

    await markOnlineCheck();
    logger.info('[KeyManager] ✅ Validation en ligne :', validated, 'validée(s),', revoked, 'révoquée(s)');
  } catch (err) {
    logger.warn('[KeyManager] ⚠️ Échec validation en ligne:', err);
  }

  return { validated, revoked };
}

// ── Migration ──────────────────────────────────────────────────────────────

/**
 * Migre les anciennes clés (format brut) vers le nouveau format enrichi.
 * À appeler une fois au démarrage.
 */
export async function migrateKeysFormat(): Promise<number> {
  let migrated = 0;

  const KEY_PREFIX = 'passio_passio_key_';
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(KEY_PREFIX)) continue;

    const raw = localStorage.getItem(key);
    if (!raw) continue;

    // Décoder le base64 pour vérifier le contenu
    let decoded: string;
    try {
      decoded = atob(raw);
    } catch {
      decoded = raw;
    }

    // Vérifier si c'est déjà au nouveau format (JSON) ou le marqueur gratuit
    if (decoded.startsWith('{') || decoded === VAULT_PLAIN_AUDIO_MARKER) continue;

    try {
      // Ancien format : la valeur décodée (decoded) est la clé hex brute
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + KEY_TTL_MS).toISOString();
      const payload: KeyPayload = {
        key: decoded,   // ← la valeur décodée, pas le base64 brut !
        storedAt: now,
        expiresAt,
        verifiedOnlineAt: now,
      };

      // Ré-écrire via saveEncryptedValue pour l'encodage
      await saveEncryptedValue(key, JSON.stringify(payload));
      migrated++;
    } catch {
      // Ignorer
    }
  }

  if (migrated > 0) {
    logger.info('[KeyManager] 🔄 Migration format clé :', migrated, 'clé(s) migrée(s)');
  }

  return migrated;
}
