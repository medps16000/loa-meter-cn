import type { EncounterDb } from '../db/encounter-db'
import type { MeterState } from './meter-client'

export type ProjectionInfo = {
  id: number
  bossName: string
  raidName: string | null
  gateName: string | null
  bossDifficulty: string | null
  startedAt: string
  durationSeconds: number
  totalDamage: number
}

let projection: { info: ProjectionInfo; payload: MeterState } | null = null

/**
 * Load a stored encounter and stage it as the overlay's data source.
 * The final-state snapshot already matches the live state.json contract
 * (summary / uiRows / displaySourceTotals / displaySourceSkillRows), so the
 * overlay can render it without a special code path.
 */
export function projectEncounter(db: EncounterDb, id: number): ProjectionInfo | null {
  const detail = db.getEncounterFinalState(id)
  if (!detail?.finalState) return null
  const info: ProjectionInfo = {
    id: detail.id,
    bossName: detail.bossName,
    raidName: detail.raidName,
    gateName: detail.gateName,
    bossDifficulty: detail.bossDifficulty,
    startedAt: detail.startedAt,
    durationSeconds: detail.durationSeconds,
    totalDamage: detail.totalDamage
  }
  const payload: MeterState = {
    ...detail.finalState,
    status: 'projected_encounter',
    _projectedEncounter: info
  }
  projection = { info, payload }
  return info
}

export function clearProjection(): void {
  projection = null
}

export function getProjectionPayload(): MeterState | null {
  return projection?.payload ?? null
}

export function getProjectionInfo(): ProjectionInfo | null {
  return projection?.info ?? null
}
