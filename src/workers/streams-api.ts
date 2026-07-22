/**
 * streams-api.ts — Cloudflare Worker pour le compteur de streams,
 *                    le moteur de recommandation collaborative,
 *                    et le système d'analytics RGPD (D1).
 *
 * Architecture :
 *   - Routes API v1 (KV) : compteurs streams, recommandations, top — inchangées
 *   - Routes API v2 (D1) : analytics enrichi (events, device, consent, sessions)
 *   - Cron : purge journalière des données D1 expirées
 *   - Fallback : assets statiques (env.ASSETS.fetch)
 *
 * Optimisations Free Tier :
 *   - V1 : KV (1 get = 0.01¢, idéal pour recommandation)
 *   - V2 : D1 (SQLite, agrégations, pas de list() coûteux)
 *   - CORS géré en préflight (OPTIONS)
 *   - Anti-fraude par TTL 48h sur les déduplications KV
 *
 * @see https://developers.cloudflare.com/workers/
 */

// ─── Types ────────────────────────────────────────────────────────────────

interface Env {
  /** Namespace KV pour le stockage des compteurs et transitions (V1). */
  STREAMS_KV: KVNamespace;
  /** Base de données D1 pour l'analytics RGPD (V2). */
  ANALYTICS_DB: D1Database;
  /** Binding automatique CF pour servir les assets statiques. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };

  // ── ImageKit (mirror d'images) ──
  /** Clé privée ImageKit (secret, défini via `wrangler secret put IMAGEKIT_PRIVATE_KEY`). */
  IMAGEKIT_PRIVATE_KEY?: string;
  /** ID du compte ImageKit (dans l'URL : ik.imagekit.io/{ID}/...). */
  IMAGEKIT_ID?: string;
  /** Clé API partagée pour sécuriser l'endpoint /api/v1/images/mirror (secret). */
  IMAGEKIT_API_KEY?: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────

/** Préfixes des clés KV pour organiser le namespace. */
const K = {
  COUNT: 'v2:cnt:',         // v2:cnt:{trackId}         → "1247"
  BEST:  'v2:best:',         // v2:best:{fromTrackId}    → JSON{trackId,score}
  TRANS: 'v2:trans:',        // v2:trans:{A}:{B}         → "89"
  DEDUP: 'v2:dedup:',        // v2:dedup:{date}:{tid}:{did} → "1" (TTL 48h)
};

/** En-têtes CORS pour toutes les réponses API. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-passio-device-id, x-passio-consent, x-passio-api-key',
  'Access-Control-Max-Age': '86400',
};

/** Rétention D1 : 90 jours pour les événements et sessions. */
const RETENTION_DAYS = 90;

/** Rétention D1 : 365 jours pour les infos d'appareil. */
const DEVICE_RETENTION_DAYS = 365;

// ─── Helpers ──────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

function getDeviceId(req: Request): string {
  return req.headers.get('x-passio-device-id') || '';
}

function getConsentHeader(req: Request): string {
  return req.headers.get('x-passio-consent') || '';
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Vérifie et applique le rate-limiting IP et DeviceID.
 * @returns Response si rejeté (400 ou 429), null si accepté.
 */
async function checkRateLimits(
  req: Request,
  env: Env,
  deviceId: string,
  isStreamCompletedEvent: boolean
): Promise<Response | null> {
  // 1. Validation du Device ID (soit un UUID v4 brut, soit l'empreinte passio-web:...)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const fingerprintRegex = /^passio-web:.+:(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+-[0-9a-f]{8,})$/i;
  if (!deviceId || (!uuidRegex.test(deviceId) && !fingerprintRegex.test(deviceId))) {
    return err('Invalid or spoofed deviceId', 400);
  }

  const ip = req.headers.get('CF-Connecting-IP') || '127.0.0.1';

  // 2. Rate limit IP : 30 requêtes par minute (sur toutes les routes d'écriture API)
  const minuteKey = `rl:ip:${ip}:${Math.floor(Date.now() / 60000)}`;
  const ipCountStr = await env.STREAMS_KV.get(minuteKey);
  const ipCount = parseInt(ipCountStr || '0', 10);
  if (ipCount >= 30) {
    return json({ error: 'Too many requests' }, 429);
  }
  await env.STREAMS_KV.put(minuteKey, String(ipCount + 1), { expirationTtl: 120 }); // TTL 2 min

  // 3. Rate limit DeviceID : 10 streams par heure (uniquement pour handlePostStream ou progress=100%)
  if (isStreamCompletedEvent) {
    const hourKey = `rl:dev:${deviceId}:${Math.floor(Date.now() / 3600000)}`;
    const devCountStr = await env.STREAMS_KV.get(hourKey);
    const devCount = parseInt(devCountStr || '0', 10);
    if (devCount >= 10) {
      return json({ error: 'Stream limit exceeded for this hour' }, 429);
    }
    await env.STREAMS_KV.put(hourKey, String(devCount + 1), { expirationTtl: 7200 }); // TTL 2h
  }

  return null;
}

// ─── Handlers API V1 (inchangés, sauf vérification consentement) ────────

/**
 * POST /api/v1/streams
 * Enregistre la fin d'écoute d'une piste.
 * 🚫 Bloqué si x-passio-consent !== 'granted'
 */
async function handlePostStream(req: Request, env: Env): Promise<Response> {
  // Vérification consentement pour le tracking V1
  const consent = getConsentHeader(req);
  if (consent !== 'granted') {
    return json({ counted: false, reason: 'consent_required' }, 403);
  }

  let body: { trackId?: string; fromTrackId?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body');
  }

  const { trackId, fromTrackId } = body;
  if (!trackId || typeof trackId !== 'string') {
    return err('Missing or invalid trackId');
  }

  const deviceId = getDeviceId(req);

  // Appliquer le rate-limiting et la validation du deviceId (V1 est toujours considéré comme un stream complété)
  const rateLimitResponse = await checkRateLimits(req, env, deviceId, true);
  if (rateLimitResponse) return rateLimitResponse;

  const date = todayDate();

  // ── 1. Anti-fraude : déduplication par device + jour + piste ──
  const dedupKey = `${K.DEDUP}${date}:${trackId}:${deviceId}`;
  const deduped = await env.STREAMS_KV.get(dedupKey);
  if (deduped) {
    return json({ counted: false, reason: 'duplicate' });
  }

  await env.STREAMS_KV.put(dedupKey, '1', { expirationTtl: 172_800 });

  // ── 2. Incrémenter le compteur global ──
  const countKey = `${K.COUNT}${trackId}`;
  const rawCount = await env.STREAMS_KV.get(countKey);
  const newCount = (parseInt(rawCount || '0', 10)) + 1;
  await env.STREAMS_KV.put(countKey, String(newCount));

  // ── 3. Enregistrer la transition A → B ──
  if (fromTrackId && fromTrackId !== trackId && typeof fromTrackId === 'string') {
    await recordTransition(env, fromTrackId, trackId);
  }

  return json({ counted: true, total: newCount }, 201);
}

/**
 * GET /api/v1/recommend?fromTrackId=xxx
 * Recommandation collaborative (lecture seule, pas de consentement nécessaire).
 */
async function handleGetRecommend(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const fromTrackId = url.searchParams.get('fromTrackId');

  if (!fromTrackId || typeof fromTrackId !== 'string') {
    return err('Missing fromTrackId');
  }

  const bestKey = `${K.BEST}${fromTrackId}`;
  const bestRaw = await env.STREAMS_KV.get(bestKey);

  if (bestRaw) {
    try {
      const best = JSON.parse(bestRaw) as { trackId: string; score: number };
      return json({
        trackId: best.trackId,
        score: best.score,
        source: 'collaborative',
      });
    } catch {
      // Corrompu → ignorer
    }
  }

  return json({ trackId: null, source: 'none' });
}

/**
 * GET /api/v1/streams/popular
 * Top 100 des pistes les plus écoutées.
 */
async function handleGetPopular(env: Env): Promise<Response> {
  const list = await env.STREAMS_KV.list({ prefix: K.COUNT, limit: 100 });

  const tracks: { trackId: string; count: number }[] = [];
  for (const key of list.keys) {
    const trackId = key.name.slice(K.COUNT.length);
    const count = parseInt(await env.STREAMS_KV.get(key.name) || '0', 10);
    tracks.push({ trackId, count });
  }

  tracks.sort((a, b) => b.count - a.count);
  return json({ tracks: tracks.slice(0, 100) });
}

/**
 * GET /api/v1/streams/count/:trackId
 * Compteur d'une piste spécifique.
 */
async function handleGetCount(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const trackId = url.pathname.replace('/api/v1/streams/count/', '');
  if (!trackId) return err('Missing trackId');

  const count = parseInt(await env.STREAMS_KV.get(`${K.COUNT}${trackId}`) || '0', 10);
  return json({ trackId, count });
}

// ─── Handlers API V2 (analytics RGPD, D1) ───────────────────────────────

/**
 * POST /api/v2/events
 * Enregistre un événement analytics (track_ended, track_progress, track_skip, page_view).
 * 🚫 Bloqué si x-passio-consent !== 'granted'
 *
 * Body (track events):
 *   { eventType: 'ended'|'progress'|'skip', trackId, progressPct, durationSec }
 * Body (page_view):
 *   { eventType: 'page_view', path, referrer }
 */
async function handlePostEvent(req: Request, env: Env): Promise<Response> {
  const consent = getConsentHeader(req);
  if (consent !== 'granted') {
    return json({ error: 'consent_required' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return err('Invalid JSON body');
  }

  const { eventType } = body;
  if (typeof eventType !== 'string') {
    return err('Missing or invalid eventType');
  }

  const deviceId = getDeviceId(req);

  // Déterminer s'il s'agit d'une fin de piste (ended ou progress à 100%)
  const progressPct = typeof body.progressPct === 'number' ? body.progressPct : null;
  const isCompleted = eventType === 'ended' || (eventType === 'progress' && progressPct === 1.0);

  // Appliquer le rate-limiting et la validation du deviceId
  const rateLimitResponse = await checkRateLimits(req, env, deviceId, isCompleted);
  if (rateLimitResponse) return rateLimitResponse;

  const db = env.ANALYTICS_DB;

  // Obtenir ou créer une session
  const sessionId = await getOrCreateSession(db, deviceId);

  if (eventType === 'page_view') {
    const path = typeof body.path === 'string' ? body.path : '';
    const referrer = typeof body.referrer === 'string' ? body.referrer : null;

    await db.prepare(
      `INSERT INTO page_views (session_id, path, referrer) VALUES (?1, ?2, ?3)`
    ).bind(sessionId, path, referrer).run();

    // Incrémenter le compteur de pages vues dans la session
    await db.prepare(
      `UPDATE sessions SET page_views = page_views + 1 WHERE id = ?1`
    ).bind(sessionId).run();

    return json({ success: true, eventType: 'page_view' }, 201);
  }

  // Track events (ended, progress, skip)
  const trackId = typeof body.trackId === 'string' ? body.trackId : '';
  const durationSec = typeof body.durationSec === 'number' ? body.durationSec : null;

  if (!trackId) {
    return err('Missing trackId for track event');
  }

  await db.prepare(
    `INSERT INTO track_events (session_id, track_id, event_type, progress_pct, duration_sec)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(sessionId, trackId, eventType, progressPct, durationSec).run();

  // Incrémenter le compteur de pistes jouées dans la session
  await db.prepare(
    `UPDATE sessions SET tracks_played = tracks_played + 1 WHERE id = ?1`
  ).bind(sessionId).run();

  return json({ success: true, eventType }, 201);
}

/**
 * POST /api/v2/device
 * Enregistre les informations techniques de l'appareil.
 * 🚫 Bloqué si x-passio-consent !== 'granted'
 */
async function handlePostDevice(req: Request, env: Env): Promise<Response> {
  const consent = getConsentHeader(req);
  if (consent !== 'granted') {
    return json({ error: 'consent_required' }, 403);
  }

  let body: {
    screenW?: number; screenH?: number; platform?: string;
    language?: string; browser?: string; os?: string;
  };
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body');
  }

  const deviceId = getDeviceId(req);
  if (!deviceId) return err('Missing deviceId');

  const db = env.ANALYTICS_DB;

  await db.prepare(
    `INSERT OR REPLACE INTO device_info
     (device_id, screen_w, screen_h, platform, language, browser, os, last_seen)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))`
  ).bind(
    deviceId,
    body.screenW ?? null,
    body.screenH ?? null,
    body.platform ?? null,
    body.language ?? null,
    body.browser ?? null,
    body.os ?? null,
  ).run();

  return json({ success: true }, 201);
}

/**
 * POST /api/v2/consent
 * Enregistre le statut de consentement d'un device.
 *
 * Body: { deviceId: string, status: 'granted' | 'denied' }
 */
async function handlePostConsent(req: Request, env: Env): Promise<Response> {
  let body: { deviceId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body');
  }

  const { deviceId, status } = body;
  if (!deviceId || typeof deviceId !== 'string') {
    return err('Missing or invalid deviceId');
  }
  if (!status || !['granted', 'denied'].includes(status)) {
    return err('Status must be "granted" or "denied"');
  }

  const db = env.ANALYTICS_DB;
  await db.prepare(
    `INSERT OR REPLACE INTO consents (device_id, status, updated_at)
     VALUES (?1, ?2, datetime('now'))`
  ).bind(deviceId, status).run();

  return json({ success: true }, 201);
}

/**
 * POST /api/v2/consent/withdraw
 * Retrait de consentement : DELETE en cascade de toutes les données
 * liées au device_id, conservation de la trace de retrait.
 *
 * Body: { deviceId: string }
 */
async function handleConsentWithdraw(req: Request, env: Env): Promise<Response> {
  let body: { deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body');
  }

  const { deviceId } = body;
  if (!deviceId || typeof deviceId !== 'string') {
    return err('Missing or invalid deviceId');
  }

  const db = env.ANALYTICS_DB;

  // Transaction atomique : DELETE en cascade
  await db.batch([
    db.prepare(
      `DELETE FROM track_events WHERE session_id IN (SELECT id FROM sessions WHERE device_id = ?1)`
    ).bind(deviceId),
    db.prepare(
      `DELETE FROM page_views WHERE session_id IN (SELECT id FROM sessions WHERE device_id = ?1)`
    ).bind(deviceId),
    db.prepare(`DELETE FROM sessions WHERE device_id = ?1`).bind(deviceId),
    db.prepare(`DELETE FROM device_info WHERE device_id = ?1`).bind(deviceId),
    db.prepare(
      `INSERT OR REPLACE INTO consents (device_id, status, updated_at)
       VALUES (?1, 'withdrawn', datetime('now'))`
    ).bind(deviceId),
  ]);

  return json({ success: true, message: 'Toutes les données ont été supprimées.' });
}

// ─── Logique métier ───────────────────────────────────────────────────────

async function recordTransition(
  env: Env,
  fromTrackId: string,
  toTrackId: string,
): Promise<void> {
  const transKey = `${K.TRANS}${fromTrackId}:${toTrackId}`;
  const bestKey = `${K.BEST}${fromTrackId}`;

  const raw = await env.STREAMS_KV.get(transKey);
  const score = (parseInt(raw || '0', 10)) + 1;
  await env.STREAMS_KV.put(transKey, String(score));

  const bestRaw = await env.STREAMS_KV.get(bestKey);
  const best = bestRaw ? (JSON.parse(bestRaw) as { trackId: string; score: number }) : null;

  if (!best || score > best.score) {
    await env.STREAMS_KV.put(
      bestKey,
      JSON.stringify({ trackId: toTrackId, score }),
    );
  }
}

async function getOrCreateSession(db: D1Database, deviceId: string): Promise<string> {
  // Chercher une session active pour ce device (moins de 30 minutes sans activité)
  const existing = await db.prepare(
    `SELECT id FROM sessions
     WHERE device_id = ?1
       AND ended_at IS NULL
       AND started_at > datetime('now', '-30 minutes')
     ORDER BY started_at DESC
     LIMIT 1`
  ).bind(deviceId).first<{ id: string }>();

  if (existing) {
    return existing.id;
  }

  // Créer une nouvelle session
  const sessionId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO sessions (id, device_id, started_at) VALUES (?1, ?2, datetime('now'))`
  ).bind(sessionId, deviceId).run();

  return sessionId;
}

// ─── ImageKit : Mirror distant vers stockage permanent ────────────────────

/**
 * POST /api/v1/images/mirror
 * Copie une image distante (Cloudinary, etc.) vers le stockage permanent ImageKit
 * en utilisant l'Upload API d'ImageKit avec une URL distante comme source.
 *
 * Body: {
 *   sourceUrl: string;    // URL de l'image source (ex: res.cloudinary.com/...)
 *   fileName?: string;    // Nom de fichier (optionnel, auto-détecté)
 *   folder?: string;      // Dossier de destination (défaut: /covers)
 *   useWsrv?: boolean;    // Forcer le proxy wsrv.nl (défaut: true)
 * }
 *
 * 🔐 Requiert les secrets IMAGEKIT_PRIVATE_KEY et IMAGEKIT_ID configurés
 *    dans le Worker via `wrangler secret put`.
 *
 * @returns { fileId, imagekitUrl, imagekitPath, width, height }
 */
async function handleImageMirror(req: Request, env: Env): Promise<Response> {
  // ── 1. Vérifier les credentials ImageKit ──
  if (!env.IMAGEKIT_PRIVATE_KEY || !env.IMAGEKIT_ID) {
    return err('ImageKit credentials not configured. Set IMAGEKIT_PRIVATE_KEY and IMAGEKIT_ID via wrangler secret put.', 500);
  }

  // ── 2. Authentification par API key partagée ──
  const apiKey = req.headers.get('x-passio-api-key');
  if (!apiKey || (env.IMAGEKIT_API_KEY && apiKey !== env.IMAGEKIT_API_KEY)) {
    return err('Unauthorized: missing or invalid x-passio-api-key', 401);
  }

  // ── 3. Parse le body ──
  let body: { sourceUrl?: string; fileName?: string; folder?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body');
  }

  const { sourceUrl, fileName, folder } = body;
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return err('Missing or invalid sourceUrl');
  }

  // Valider le format de l'URL source
  try {
    new URL(sourceUrl);
  } catch {
    return err('Invalid sourceUrl format');
  }

  // ── 4. Déduplication via KV ──
  // Hash SHA-256 de l'URL source pour clé de déduplication
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sourceUrl),
  );
  const sourceHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32); // 32 premiers caractères suffisent
  const mirrorKey = `img:mirror:${sourceHash}`;

  const existing = await env.STREAMS_KV.get(mirrorKey);
  if (existing) {
    return json({
      success: true,
      imagekitUrl: existing,
      imagekitPath: existing.replace(`https://ik.imagekit.io/${env.IMAGEKIT_ID}`, ''),
      cached: true,
    });
  }

  // ── 5. Proxifier via wsrv.nl si Cloudinary ──
  // On sait que wsrv.nl peut accéder à Cloudinary sans 401.
  let uploadUrl = sourceUrl;
  if (sourceUrl.includes('res.cloudinary.com')) {
    const cleanUrl = sourceUrl.replace(/^https?:\/\//, '');
    uploadUrl = `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp`;
  }

  // ── 6. Déterminer le nom de fichier ──
  const autoFileName = fileName
    || sourceUrl.split('/').pop()?.split('?')[0]
    || `image-${Date.now()}.jpg`;
  const targetFolder = folder || '/covers';

  // ── 7. Upload vers ImageKit (avec timeout 30s) ──
  const auth = btoa(`${env.IMAGEKIT_PRIVATE_KEY}:`);

  const uploadPayload = new FormData();
  uploadPayload.append('file', uploadUrl);
  uploadPayload.append('fileName', autoFileName);
  uploadPayload.append('useUniqueFileName', 'true');
  uploadPayload.append('folder', targetFolder);
  uploadPayload.append('tags', 'passio,mirrored');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}` },
      body: uploadPayload,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    return json({
      success: false,
      error: `ImageKit upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }, 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    return json({
      success: false,
      error: `ImageKit upload failed: ${response.status}`,
      details: errorBody,
    }, response.status);
  }

  const result = await response.json() as {
    fileId: string;
    name: string;
    url: string;
    thumbnail: string;
    height: number;
    width: number;
    size: number;
    filePath: string;
  };

  // ── 8. Stocker le mapping dans KV (365 jours) ──
  await env.STREAMS_KV.put(mirrorKey, result.url, { expirationTtl: 86_400 * 365 });

  return json({
    success: true,
    imagekitUrl: result.url,
    imagekitPath: result.filePath,
    fileId: result.fileId,
    width: result.width,
    height: result.height,
    size: result.size,
    cached: false,
  }, 201);
}

// ─── Cron : purge journalière ─────────────────────────────────────────────

async function handleScheduledPurge(env: Env): Promise<void> {
  const db = env.ANALYTICS_DB;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const deviceCutoff = new Date(Date.now() - DEVICE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await db.batch([
    // Purge track_events et page_views > 90 jours
    db.prepare(`DELETE FROM track_events WHERE created_at < ?1`).bind(cutoff),
    db.prepare(`DELETE FROM page_views WHERE created_at < ?1`).bind(cutoff),
    // Purge sessions orphelines (sans events récents)
    db.prepare(
      `DELETE FROM sessions WHERE started_at < ?1
       AND id NOT IN (SELECT DISTINCT session_id FROM track_events WHERE created_at >= ?1)
       AND id NOT IN (SELECT DISTINCT session_id FROM page_views WHERE created_at >= ?1)`
    ).bind(cutoff, cutoff, cutoff),
    // Purge device_info si last_seen > 365 jours
    db.prepare(`DELETE FROM device_info WHERE last_seen < ?1`).bind(deviceCutoff),
  ]);
}

// ─── Routeur principal ────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // ── Préflight CORS ──
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ── Routage API ──
    const path = url.pathname;

    // Routes V2 (analytics D1)
    if (method === 'POST' && path === '/api/v2/events') {
      return handlePostEvent(request, env);
    }
    if (method === 'POST' && path === '/api/v2/device') {
      return handlePostDevice(request, env);
    }
    if (method === 'POST' && path === '/api/v2/consent') {
      return handlePostConsent(request, env);
    }
    if (method === 'POST' && path === '/api/v2/consent/withdraw') {
      return handleConsentWithdraw(request, env);
    }

    // Routes V1 (KV — inchangées)
    if (method === 'POST' && path === '/api/v1/streams') {
      return handlePostStream(request, env);
    }
    if (method === 'GET' && path === '/api/v1/recommend') {
      return handleGetRecommend(request, env);
    }
    if (method === 'GET' && path === '/api/v1/streams/popular') {
      return handleGetPopular(env);
    }
    if (method === 'GET' && path.startsWith('/api/v1/streams/count/')) {
      return handleGetCount(request, env);
    }

    // ── ImageKit Mirror ──
    if (method === 'POST' && path === '/api/v1/images/mirror') {
      return handleImageMirror(request, env);
    }

    // ── Fallback : assets statiques (SPA) ──
    return env.ASSETS.fetch(request);
  },

  // ── Cron : purge D1 ──
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduledPurge(env);
  },
};
