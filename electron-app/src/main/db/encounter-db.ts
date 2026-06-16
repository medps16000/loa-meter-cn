import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_SQL } from './schema'

export type EncounterSummary = {
  id: number
  encounterId: number | null
  startedAt: string
  closedAt: string | null
  bossName: string
  bossDifficulty: string | null
  raidName: string | null
  gateName: string | null
  totalDamage: number
  dps: number
  hitCount: number
  critRate: number
  durationSeconds: number
  rowCount: number
  status: string
  bossOnly: boolean
  bossKnown: boolean
}

export type EncounterBossRow = {
  targetId: string | null
  npcTypeId: number | null
  npcName: string | null
  npcGrade: string | null
  maxHp: number | null
  isPrimary: boolean
}

export type EncounterDetail = EncounterSummary & {
  finalState: Record<string, unknown> | null
  bosses: EncounterBossRow[]
  snapshots: Array<{ capturedAt: number; payload: Record<string, unknown> }>
}

function rowToSummary(row: Record<string, unknown>): EncounterSummary {
  return {
    id: Number(row.id),
    encounterId: row.encounter_id == null ? null : Number(row.encounter_id),
    startedAt: String(row.started_at ?? ''),
    closedAt: row.closed_at == null ? null : String(row.closed_at),
    bossName: String(row.boss_name ?? '全部目标'),
    bossDifficulty: row.boss_difficulty == null ? null : String(row.boss_difficulty),
    raidName: row.raid_name == null ? null : String(row.raid_name),
    gateName: row.gate_name == null ? null : String(row.gate_name),
    totalDamage: Number(row.total_damage ?? 0),
    dps: Number(row.dps ?? 0),
    hitCount: Number(row.hit_count ?? 0),
    critRate: Number(row.crit_rate ?? 0),
    durationSeconds: Number(row.duration_seconds ?? 0),
    rowCount: Number(row.row_count ?? 0),
    status: String(row.status ?? ''),
    bossOnly: Boolean(row.boss_only),
    bossKnown: Boolean(row.boss_known)
  }
}

export class EncounterDb {
  readonly #db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.#db = new Database(dbPath)
    this.#db.pragma('journal_mode = WAL')
    // Required for ON DELETE CASCADE to actually fire when deleting encounters.
    this.#db.pragma('foreign_keys = ON')
    this.#migrateSchema()
    this.#db.exec(SCHEMA_SQL)
  }

  /** Add columns introduced after the v1 schema (before index creation). */
  #migrateSchema(): void {
    const tables = this.#db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'encounters'`)
      .all()
    if (!tables.length) return
    const columns = new Set(
      (this.#db.prepare(`PRAGMA table_info(encounters)`).all() as Array<{ name: string }>).map(
        (row) => row.name
      )
    )
    const migrations: Array<[string, string]> = [
      ['boss_difficulty', 'ALTER TABLE encounters ADD COLUMN boss_difficulty TEXT'],
      ['raid_name', 'ALTER TABLE encounters ADD COLUMN raid_name TEXT'],
      ['gate_name', 'ALTER TABLE encounters ADD COLUMN gate_name TEXT']
    ]
    for (const [column, ddl] of migrations) {
      if (!columns.has(column)) {
        this.#db.exec(ddl)
      }
    }
  }

  close(): void {
    this.#db.close()
  }

  getSetting(key: string): string | null {
    const row = this.#db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.#db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  listEncounters(
    limit = 30,
    filters: { raidName?: string; bossName?: string } = {}
  ): EncounterSummary[] {
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (filters.raidName) {
      clauses.push('raid_name = ?')
      params.push(filters.raidName)
    }
    if (filters.bossName) {
      clauses.push('boss_name = ?')
      params.push(filters.bossName)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.#db
      .prepare(`SELECT * FROM encounters ${where} ORDER BY started_at DESC LIMIT ?`)
      .all(...params, limit) as Array<Record<string, unknown>>
    return rows.map(rowToSummary)
  }

  listRaidNames(): string[] {
    const rows = this.#db
      .prepare(
        `SELECT DISTINCT raid_name FROM encounters
         WHERE raid_name IS NOT NULL AND raid_name != ''
         ORDER BY raid_name`
      )
      .all() as Array<{ raid_name: string }>
    return rows.map((row) => row.raid_name)
  }

  getEncounterBosses(id: number): EncounterBossRow[] {
    const rows = this.#db
      .prepare(
        `SELECT target_id, npc_type_id, npc_name, npc_grade, max_hp, is_primary
         FROM encounter_bosses WHERE encounter_row_id = ?
         ORDER BY is_primary DESC, id ASC`
      )
      .all(id) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      targetId: row.target_id == null ? null : String(row.target_id),
      npcTypeId: row.npc_type_id == null ? null : Number(row.npc_type_id),
      npcName: row.npc_name == null ? null : String(row.npc_name),
      npcGrade: row.npc_grade == null ? null : String(row.npc_grade),
      maxHp: row.max_hp == null ? null : Number(row.max_hp),
      isPrimary: Boolean(row.is_primary)
    }))
  }

  getEncounter(id: number): EncounterDetail | null {
    const row = this.#db
      .prepare(`SELECT * FROM encounters WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined
    if (!row) return null

    const finalRow = this.#db
      .prepare(`SELECT payload_json FROM encounter_final_state WHERE encounter_row_id = ?`)
      .get(id) as { payload_json: string } | undefined

    const snapshotRows = this.#db
      .prepare(
        `SELECT captured_at, payload_json FROM encounter_snapshots
         WHERE encounter_row_id = ? ORDER BY captured_at ASC`
      )
      .all(id) as Array<{ captured_at: number; payload_json: string }>

    return {
      ...rowToSummary(row),
      finalState: finalRow ? JSON.parse(finalRow.payload_json) : null,
      bosses: this.getEncounterBosses(id),
      snapshots: snapshotRows.map((item) => ({
        capturedAt: Number(item.captured_at),
        payload: JSON.parse(item.payload_json)
      }))
    }
  }

  /**
   * Delete an encounter and every dependent row. Child tables declare
   * ON DELETE CASCADE, and `foreign_keys = ON` is set in the constructor, so a
   * single delete cascades; the explicit child deletes inside the transaction
   * are a defensive fallback in case the pragma is ever disabled.
   * Returns true when a row was removed.
   */
  deleteEncounter(id: number): boolean {
    const tx = this.#db.transaction((rowId: number) => {
      for (const table of [
        'encounter_snapshots',
        'encounter_final_state',
        'encounter_players',
        'encounter_skill_rows',
        'encounter_bosses'
      ]) {
        this.#db.prepare(`DELETE FROM ${table} WHERE encounter_row_id = ?`).run(rowId)
      }
      return this.#db.prepare(`DELETE FROM encounters WHERE id = ?`).run(rowId).changes
    })
    return Number(tx(id)) > 0
  }

  /**
   * Lightweight fetch for overlay projection: summary + final-state payload
   * only. Unlike {@link getEncounter} this skips loading/parsing the per-tick
   * snapshot history (which can be large), so pinning a stored fight onto the
   * overlay stays fast.
   */
  getEncounterFinalState(
    id: number
  ): (EncounterSummary & { finalState: Record<string, unknown> | null }) | null {
    const row = this.#db
      .prepare(`SELECT * FROM encounters WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined
    if (!row) return null
    const finalRow = this.#db
      .prepare(`SELECT payload_json FROM encounter_final_state WHERE encounter_row_id = ?`)
      .get(id) as { payload_json: string } | undefined
    return {
      ...rowToSummary(row),
      finalState: finalRow ? JSON.parse(finalRow.payload_json) : null
    }
  }

  findOpenEncounter(encounterId: number): EncounterSummary | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM encounters
         WHERE encounter_id = ? AND closed_at IS NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(encounterId) as Record<string, unknown> | undefined
    return row ? rowToSummary(row) : null
  }

  startEncounter(input: {
    encounterId: number
    startedAt: string
    bossOnly: boolean
    runDir?: string
  }): number {
    const result = this.#db
      .prepare(
        `INSERT INTO encounters (
          encounter_id, started_at, boss_only, source, run_dir, status
        ) VALUES (?, ?, ?, 'CN_D132', ?, 'active')`
      )
      .run(
        input.encounterId,
        input.startedAt,
        input.bossOnly ? 1 : 0,
        input.runDir ?? null
      )
    return Number(result.lastInsertRowid)
  }

  updateEncounterMetrics(
    rowId: number,
    metrics: {
      bossName?: string
      bossDifficulty?: string | null
      raidName?: string | null
      gateName?: string | null
      totalDamage?: number
      dps?: number
      hitCount?: number
      critRate?: number
      durationSeconds?: number
      rowCount?: number
      status?: string
      bossKnown?: boolean
    }
  ): void {
    const fields: string[] = []
    const values: Array<string | number | null> = []

    const assign = (column: string, value: string | number | null | undefined) => {
      if (value === undefined) return
      fields.push(`${column} = ?`)
      values.push(value)
    }

    assign('boss_name', metrics.bossName)
    assign('boss_difficulty', metrics.bossDifficulty)
    assign('raid_name', metrics.raidName)
    assign('gate_name', metrics.gateName)
    assign('total_damage', metrics.totalDamage)
    assign('dps', metrics.dps)
    assign('hit_count', metrics.hitCount)
    assign('crit_rate', metrics.critRate)
    assign('duration_seconds', metrics.durationSeconds)
    assign('row_count', metrics.rowCount)
    assign('status', metrics.status)
    if (metrics.bossKnown !== undefined) {
      assign('boss_known', metrics.bossKnown ? 1 : 0)
    }

    if (!fields.length) return

    fields.push(`updated_at = datetime('now')`)
    values.push(rowId)
    this.#db
      .prepare(`UPDATE encounters SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)
  }

  appendSnapshot(rowId: number, capturedAt: number, payload: Record<string, unknown>): void {
    this.#db
      .prepare(
        `INSERT INTO encounter_snapshots (encounter_row_id, captured_at, payload_json)
         VALUES (?, ?, ?)`
      )
      .run(rowId, capturedAt, JSON.stringify(payload))
  }

  closeEncounter(
    rowId: number,
    input: {
      closedAt: string
      finalState: Record<string, unknown>
      metrics: {
        bossName?: string
        bossDifficulty?: string | null
        raidName?: string | null
        gateName?: string | null
        totalDamage?: number
        dps?: number
        hitCount?: number
        critRate?: number
        durationSeconds?: number
        rowCount?: number
        status?: string
        bossKnown?: boolean
      }
    }
  ): void {
    const tx = this.#db.transaction(() => {
      this.updateEncounterMetrics(rowId, input.metrics)
      this.#db
        .prepare(`UPDATE encounters SET closed_at = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.closedAt, input.metrics.status ?? 'closed', rowId)
      this.#db
        .prepare(
          `INSERT INTO encounter_final_state (encounter_row_id, payload_json)
           VALUES (?, ?)
           ON CONFLICT(encounter_row_id) DO UPDATE SET payload_json = excluded.payload_json`
        )
        .run(rowId, JSON.stringify(input.finalState))
    })
    tx()
  }

  trimSnapshots(rowId: number, maxSnapshots: number): void {
    this.#db
      .prepare(
        `DELETE FROM encounter_snapshots
         WHERE encounter_row_id = ?
           AND id NOT IN (
             SELECT id FROM encounter_snapshots
             WHERE encounter_row_id = ?
             ORDER BY captured_at DESC
             LIMIT ?
           )`
      )
      .run(rowId, rowId, maxSnapshots)
  }
}
