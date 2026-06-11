import { saveEncryptedValue, readEncryptedValue } from './storage';

const DEVICE_ID_KEY = 'passio_device_id';

function buildDeviceFingerprint(): string {
  const parts = [
    'passio-web',
    navigator.platform || 'web',
    navigator.userAgent?.substring(0, 50) || 'browser',
  ];

  const randomPart =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  return `${parts.join(':')}:${randomPart}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await readEncryptedValue(DEVICE_ID_KEY);
  if (existing) return existing;

  const deviceId = buildDeviceFingerprint();
  await saveEncryptedValue(DEVICE_ID_KEY, deviceId);
  return deviceId;
}
