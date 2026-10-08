PRAGMA foreign_keys = ON;

-- Plan importé (image sur disque, métadonnées ici)
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_file TEXT NOT NULL,
  image_url TEXT NOT NULL,
  mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
  width INTEGER NOT NULL CHECK(width > 0),
  height INTEGER NOT NULL CHECK(height > 0),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Campagne de mesures menée sur un plan.
CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_surveys_plan ON surveys(plan_id);

-- APs déclarés à la main sur le plan (x,y normalisés 0-1)
CREATE TABLE IF NOT EXISTS access_points (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  x REAL NOT NULL CHECK(x BETWEEN 0 AND 1),
  y REAL NOT NULL CHECK(y BETWEEN 0 AND 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ap_plan ON access_points(plan_id);

-- Position cliquée sur le terrain
CREATE TABLE IF NOT EXISTS scan_points (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  survey_id TEXT REFERENCES surveys(id) ON DELETE CASCADE,
  x REAL NOT NULL CHECK(x BETWEEN 0 AND 1),
  y REAL NOT NULL CHECK(y BETWEEN 0 AND 1),
  note TEXT DEFAULT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sp_plan ON scan_points(plan_id);

-- Noms conviviaux des bornes (BSSID -> nom), par plan (cf. ApMapping upstream)
CREATE TABLE IF NOT EXISTS ap_mappings (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bssid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, bssid)
);
CREATE INDEX IF NOT EXISTS idx_apm_plan ON ap_mappings(plan_id);

-- Débit iperf3 par scan (une ligne max, seulement si un serveur est configuré)
CREATE TABLE IF NOT EXISTS speed_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL UNIQUE REFERENCES scans(id) ON DELETE CASCADE,
  tcp_down_bps INTEGER DEFAULT NULL,
  tcp_up_bps INTEGER DEFAULT NULL,
  duration_s INTEGER NOT NULL,
  error TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Réglages globaux clé/valeur (serveur iperf, durée des tests, ...)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un appui sur "Scan" à un point donné
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  scan_point_id TEXT NOT NULL REFERENCES scan_points(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('live','test')),
  scanned_at TEXT NOT NULL,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  gateway_ip TEXT DEFAULT NULL,
  gateway_rtt_ms REAL DEFAULT NULL,
  gateway_loss_percent REAL DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scans_point ON scans(scan_point_id);
CREATE INDEX IF NOT EXISTS idx_scans_plan ON scans(plan_id);

-- Une ligne = un BSSID vu pendant un scan (contenu de normalizeEntry)
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  bssid TEXT NOT NULL,
  ssid TEXT,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
  band TEXT NOT NULL,
  frequency_mhz INTEGER NOT NULL,
  channel INTEGER,
  bandwidth_mhz INTEGER,
  center_frequency_mhz INTEGER,
  center_channel INTEGER,
  rssi INTEGER NOT NULL CHECK(rssi BETWEEN -127 AND 0),
  quality INTEGER NOT NULL CHECK(quality BETWEEN 0 AND 100),
  level TEXT NOT NULL,
  security TEXT NOT NULL,
  standard TEXT NOT NULL,
  virtual_bssid INTEGER NOT NULL DEFAULT 0 CHECK(virtual_bssid IN (0,1)),
  unreliable_bssid INTEGER NOT NULL DEFAULT 0 CHECK(unreliable_bssid IN (0,1)),
  current INTEGER NOT NULL DEFAULT 0 CHECK(current IN (0,1)),
  capabilities TEXT NOT NULL DEFAULT '[]',
  timestamp_us INTEGER
);
CREATE INDEX IF NOT EXISTS idx_obs_scan ON observations(scan_id);
CREATE INDEX IF NOT EXISTS idx_obs_bssid ON observations(bssid);
CREATE INDEX IF NOT EXISTS idx_obs_ssid_band ON observations(ssid, band);
