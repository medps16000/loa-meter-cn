export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS encounters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_id     INTEGER,
  started_at       TEXT NOT NULL,
  closed_at        TEXT,
  boss_name        TEXT,
  total_damage     INTEGER DEFAULT 0,
  dps              REAL DEFAULT 0,
  hit_count        INTEGER DEFAULT 0,
  crit_rate        REAL DEFAULT 0,
  duration_seconds REAL DEFAULT 0,
  row_count        INTEGER DEFAULT 0,
  status           TEXT,
  boss_only        INTEGER DEFAULT 1,
  boss_known       INTEGER DEFAULT 0,
  source           TEXT DEFAULT 'LOA_METER_CN',
  schema_version   INTEGER DEFAULT 1,
  run_dir          TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_encounters_started ON encounters(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_encounters_encounter_id ON encounters(encounter_id);

CREATE TABLE IF NOT EXISTS encounter_snapshots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_row_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  captured_at      REAL NOT NULL,
  payload_json     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS encounter_final_state (
  encounter_row_id INTEGER PRIMARY KEY REFERENCES encounters(id) ON DELETE CASCADE,
  payload_json     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
