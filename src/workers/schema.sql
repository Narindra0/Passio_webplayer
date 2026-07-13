-- ============================================================
--  Pass'io Web Player — Schéma D1 (Analytics RGPD)
--  Base de données : passio-analytics
--  Binding Worker   : ANALYTICS_DB
--  Créé le         : 2026-07-13
-- ============================================================
--  Exécuter avec :
--    npx wrangler d1 execute passio-analytics --file=src/workers/schema.sql
--  (depuis la racine du projet)
-- ============================================================

-- -------------------------------------------------------
--  1. Consents — enregistrement des choix RGPD
--     Note : 'withdrawn' est conservé comme preuve de retrait
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS consents (
  device_id   TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK(status IN ('granted','denied','withdrawn')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -------------------------------------------------------
--  2. Sessions — regroupement des événements par visite
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at      TEXT,
  page_views    INTEGER DEFAULT 0,
  tracks_played INTEGER DEFAULT 0,
  duration_sec  REAL,
  FOREIGN KEY (device_id) REFERENCES consents(device_id)
);

-- -------------------------------------------------------
--  3. Track events — écoutes, progressions, skips
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS track_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  track_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK(event_type IN ('ended','progress','skip')),
  progress_pct  REAL,
  duration_sec  REAL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- -------------------------------------------------------
--  4. Page views — navigation dans l'application
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_views (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL,
  path            TEXT NOT NULL,
  referrer        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- -------------------------------------------------------
--  5. Device info — caractéristiques techniques
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_info (
  device_id   TEXT PRIMARY KEY,
  screen_w    INTEGER,
  screen_h    INTEGER,
  platform    TEXT,
  language    TEXT,
  browser     TEXT,
  os          TEXT,
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (device_id) REFERENCES consents(device_id)
);

-- -------------------------------------------------------
--  Index — pour les requêtes analytics et purge cron
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_track_events_session  ON track_events(session_id);
CREATE INDEX IF NOT EXISTS idx_track_events_created  ON track_events(created_at);
CREATE INDEX IF NOT EXISTS idx_track_events_track    ON track_events(track_id);
CREATE INDEX IF NOT EXISTS idx_page_views_session    ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_page_views_created    ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_path       ON page_views(path);
CREATE INDEX IF NOT EXISTS idx_sessions_device       ON sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started      ON sessions(started_at);
