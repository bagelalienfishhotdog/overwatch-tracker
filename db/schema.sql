-- Players table
CREATE TABLE IF NOT EXISTS players (
  account     TEXT NOT NULL,
  server_id   TEXT NOT NULL DEFAULT 'default',
  display_name TEXT,
  first_seen  BIGINT NOT NULL,
  last_seen   BIGINT NOT NULL,
  online      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (server_id, account)
);

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
  id        BIGSERIAL PRIMARY KEY,
  account   TEXT NOT NULL,
  server_id TEXT NOT NULL DEFAULT 'default',
  world     TEXT NOT NULL,
  x         DOUBLE PRECISION NOT NULL,
  y         DOUBLE PRECISION NOT NULL,
  z         DOUBLE PRECISION NOT NULL,
  health    DOUBLE PRECISION,
  armor     DOUBLE PRECISION,
  timestamp BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_positions_account_ts ON positions(account, timestamp);
CREATE INDEX IF NOT EXISTS idx_positions_ts ON positions(timestamp);
CREATE INDEX IF NOT EXISTS idx_positions_server ON positions(server_id);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id           BIGSERIAL PRIMARY KEY,
  account      TEXT NOT NULL,
  server_id    TEXT NOT NULL DEFAULT 'default',
  world        TEXT NOT NULL,
  start_time   BIGINT NOT NULL,
  end_time     BIGINT,
  missed_polls INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account);
CREATE INDEX IF NOT EXISTS idx_sessions_server ON sessions(server_id);

-- Servers table
CREATE TABLE IF NOT EXISTS servers (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  url       TEXT NOT NULL,
  map_type  TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE
);

-- Tile cache table
CREATE TABLE IF NOT EXISTS tile_cache (
  url          TEXT PRIMARY KEY,
  server_id    TEXT NOT NULL,
  content      BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/png',
  fetched_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tile_cache_server ON tile_cache(server_id);

-- Perimeters table
CREATE TABLE IF NOT EXISTS perimeters (
  id BIGSERIAL PRIMARY KEY,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  center_x DOUBLE PRECISION NOT NULL,
  center_z DOUBLE PRECISION NOT NULL,
  radius DOUBLE PRECISION NOT NULL DEFAULT 500,
  color TEXT DEFAULT '#ff4444',
  shape_type TEXT DEFAULT 'circle',
  shape_data JSONB,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  active BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_perimeters_server ON perimeters(server_id);

-- Perimeter alerts table
CREATE TABLE IF NOT EXISTS perimeter_alerts (
  id BIGSERIAL PRIMARY KEY,
  perimeter_id INTEGER NOT NULL REFERENCES perimeters(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  display_name TEXT,
  detected_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pa_perimeter ON perimeter_alerts(perimeter_id);
CREATE INDEX IF NOT EXISTS idx_pa_detected ON perimeter_alerts(detected_at);

-- Intel events table
CREATE TABLE IF NOT EXISTS intel_events (
  id BIGSERIAL PRIMARY KEY,
  server_id TEXT NOT NULL,
  account TEXT NOT NULL,
  event_type TEXT NOT NULL,
  x DOUBLE PRECISION,
  z DOUBLE PRECISION,
  detail TEXT,
  detected_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ie_server ON intel_events(server_id, account);
CREATE INDEX IF NOT EXISTS idx_ie_type ON intel_events(server_id, event_type);
CREATE INDEX IF NOT EXISTS idx_ie_time ON intel_events(detected_at);

-- User profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id),
  username   TEXT UNIQUE NOT NULL,
  role       TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- User permissions table
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    UUID NOT NULL REFERENCES user_profiles(id),
  feature    TEXT NOT NULL,
  can_read   BOOLEAN DEFAULT TRUE,
  can_write  BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (user_id, feature)
);

-- Access codes table
CREATE TABLE IF NOT EXISTS access_codes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  role            TEXT NOT NULL DEFAULT 'viewer',
  permissions     JSONB,
  max_uses        INTEGER DEFAULT 1,
  use_count       INTEGER DEFAULT 0,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_by      UUID REFERENCES user_profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  hidden_features JSONB
);

-- Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tile_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE perimeters ENABLE ROW LEVEL SECURITY;
ALTER TABLE perimeter_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anon key
CREATE POLICY "Allow all" ON players FOR ALL USING (true);
CREATE POLICY "Allow all" ON positions FOR ALL USING (true);
CREATE POLICY "Allow all" ON sessions FOR ALL USING (true);
CREATE POLICY "Allow all" ON servers FOR ALL USING (true);
CREATE POLICY "Allow all" ON tile_cache FOR ALL USING (true);
CREATE POLICY "Allow all" ON perimeters FOR ALL USING (true);
CREATE POLICY "Allow all" ON perimeter_alerts FOR ALL USING (true);
CREATE POLICY "Allow all" ON intel_events FOR ALL USING (true);
CREATE POLICY "Allow all" ON user_profiles FOR ALL USING (true);
CREATE POLICY "Allow all" ON user_permissions FOR ALL USING (true);
CREATE POLICY "Allow all" ON access_codes FOR ALL USING (true);
