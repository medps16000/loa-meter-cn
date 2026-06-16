CREATE TABLE IF NOT EXISTS encounters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_id     INTEGER,
  started_at       TEXT NOT NULL,
  closed_at        TEXT,
  boss_name        TEXT,
  boss_difficulty  TEXT,
  raid_name        TEXT,
  gate_name        TEXT,
  total_damage     INTEGER DEFAULT 0,
  dps              REAL DEFAULT 0,
  hit_count        INTEGER DEFAULT 0,
  crit_rate        REAL DEFAULT 0,
  duration_seconds REAL DEFAULT 0,
  row_count        INTEGER DEFAULT 0,
  status           TEXT,
  boss_only        INTEGER DEFAULT 1,
  boss_known       INTEGER DEFAULT 0,
  source           TEXT DEFAULT 'CN_D132',
  schema_version   INTEGER DEFAULT 2,
  run_dir          TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_encounters_started ON encounters(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_encounters_encounter_id ON encounters(encounter_id);
CREATE INDEX IF NOT EXISTS idx_encounters_boss_name ON encounters(boss_name);
CREATE INDEX IF NOT EXISTS idx_encounters_raid_gate ON encounters(raid_name, gate_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(status, closed_at);

CREATE TABLE IF NOT EXISTS encounter_snapshots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_row_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  captured_at      REAL NOT NULL,
  payload_json     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_encounter_snapshots_row
  ON encounter_snapshots(encounter_row_id, captured_at);

CREATE TABLE IF NOT EXISTS encounter_final_state (
  encounter_row_id INTEGER PRIMARY KEY REFERENCES encounters(id) ON DELETE CASCADE,
  payload_json     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS encounter_players (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_row_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  source_id        TEXT,
  source_id_dec    TEXT,
  character_id     TEXT,
  character_id_dec TEXT,
  player_name      TEXT,
  class_id         INTEGER,
  gear_score       REAL,
  gear_score_source TEXT,
  total_damage     INTEGER DEFAULT 0,
  damage_share     REAL DEFAULT 0,
  dps              REAL DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_encounter_players_row ON encounter_players(encounter_row_id);
CREATE INDEX IF NOT EXISTS idx_encounter_players_name ON encounter_players(player_name);

CREATE TABLE IF NOT EXISTS encounter_skill_rows (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_row_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  source_id        TEXT,
  player_name      TEXT,
  skill_id         TEXT,
  skill_name       TEXT,
  total_damage     INTEGER DEFAULT 0,
  damage_share     REAL DEFAULT 0,
  dps              REAL DEFAULT 0,
  hit_count        INTEGER DEFAULT 0,
  crit_rate        REAL DEFAULT 0,
  cast_count       INTEGER,
  hit_rate         REAL,
  back_attack_rate REAL,
  head_attack_rate REAL,
  front_attack_rate REAL,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_encounter_skill_rows_row
  ON encounter_skill_rows(encounter_row_id, source_id);

CREATE TABLE IF NOT EXISTS encounter_bosses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_row_id INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  target_id        TEXT,
  npc_type_id      INTEGER,
  npc_name         TEXT,
  npc_grade        TEXT,
  max_hp           INTEGER,
  is_primary       INTEGER DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_encounter_bosses_row ON encounter_bosses(encounter_row_id);
CREATE INDEX IF NOT EXISTS idx_encounter_bosses_name ON encounter_bosses(npc_name);

CREATE TABLE IF NOT EXISTS raid_gate_bosses (
  raid_name  TEXT NOT NULL,
  gate_name  TEXT NOT NULL,
  boss_name  TEXT NOT NULL,
  gate_order INTEGER DEFAULT 0,
  PRIMARY KEY (raid_name, gate_name, boss_name)
);

CREATE INDEX IF NOT EXISTS idx_raid_gate_bosses_boss ON raid_gate_bosses(boss_name);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
