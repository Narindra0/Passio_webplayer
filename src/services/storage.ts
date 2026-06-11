const STORAGE_PREFIX = 'passio_';

function encode(value: string): string {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return btoa(value);
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    return atob(value);
  }
}

export async function saveEncryptedValue(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, encode(value));
  } catch (err) {
    console.warn('[Storage] Failed to save:', key, err);
  }
}

export async function readEncryptedValue(key: string): Promise<string | null> {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    if (!stored) return null;
    return decode(stored);
  } catch {
    return null;
  }
}

export async function deleteEncryptedValue(key: string): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // ignore
  }
}
