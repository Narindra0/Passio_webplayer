/**
 * crypto.ts — Déchiffrement AES-256-CBC en mémoire vive (RAM).
 * Utilise Web Crypto API pour le navigateur.
 */

const IV_LENGTH = 16;

function hexToBytes(hex: string): Uint8Array {
  const sanitized = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (sanitized.length % 2 !== 0) throw new Error('Clé hex invalide');
  const bytes = new Uint8Array(sanitized.length / 2);
  for (let i = 0; i < sanitized.length; i += 2) {
    bytes[i / 2] = parseInt(sanitized.slice(i, i + 2), 16);
  }
  return bytes;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function decryptTrackBuffer(
  encryptedBuffer: ArrayBuffer,
  rawKeyHex: string
): Promise<ArrayBuffer> {
  const encryptedBytes = new Uint8Array(encryptedBuffer);

  // Séparation IV / Ciphertext
  const iv = encryptedBytes.slice(0, IV_LENGTH);
  const ciphertext = encryptedBytes.slice(IV_LENGTH);

  // Importer la clé AES (Web Crypto API)
  const rawKey = hexToBytes(rawKeyHex);
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey.buffer as ArrayBuffer,
    { name: 'AES-CBC' },
    false,
    ['decrypt']
  );

  // Déchiffrement
  const decrypted: ArrayBuffer = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );

  // Efface les données sensibles (clé, IV, ciphertext) de la RAM
  rawKey.fill(0);
  iv.fill(0);
  ciphertext.fill(0);

  return decrypted;
}

export function base64ToArrayBufferFn(base64: string): ArrayBuffer {
  return base64ToArrayBuffer(base64);
}
