import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeSourceTotalRowsByPlayerIdentity } from '../../shared/merge-source-totals'
import type { MeterState } from './meter-client'

const DEFAULT_ENCOUNTER = join(
  '..',
  '..',
  'offline',
  'runs',
  '20260607_195723',
  'encounters',
  'encounter_20260607_200939',
  'encounter_20260607_200939.json'
)

const DEFAULT_STATIC_STATE = join(
  '..',
  '..',
  'offline',
  'runs',
  '20260607_195723',
  'captures',
  'truth_allop_wire_20260607_195723_live_meter_state.json'
)

export type OfflineReplayInfo = {
  mode: 'replay' | 'static'
  sourcePath: string
  label: string
  snapshotCount: number
  replayDurationSeconds: number
}

function resolveOfflinePath(): string {
  const configured = process.env.METER_OFFLINE_PATH?.trim()
  if (configured) return configured
  const mode = process.env.METER_OFFLINE_MODE?.trim().toLowerCase()
  if (mode === 'static') return join(process.cwd(), DEFAULT_STATIC_STATE)
  return join(process.cwd(), DEFAULT_ENCOUNTER)
}

function readJsonFile(path: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

function mergeSourceTotalArray(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null
  const rows = value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  return mergeSourceTotalRowsByPlayerIdentity(rows)
}

function normalizeSnapshot(snapshot: Record<string, unknown>): MeterState {
  const state: MeterState = { ...snapshot }
  const uiRows = Array.isArray(snapshot.uiRows) ? snapshot.uiRows : null
  if (!Array.isArray(state.displaySourceTotals) && uiRows) {
    state.displaySourceTotals = uiRows
  }
  if (!Array.isArray(state.sourceTotals) && uiRows) {
    state.sourceTotals = uiRows
  }
  const mergedDisplaySourceTotals = mergeSourceTotalArray(state.displaySourceTotals)
  if (mergedDisplaySourceTotals) {
    state.displaySourceTotals = mergedDisplaySourceTotals
  }
  const mergedUiRows = mergeSourceTotalArray(state.uiRows)
  if (mergedUiRows) {
    state.uiRows = mergedUiRows
  }
  const mergedSourceTotals = mergeSourceTotalArray(state.sourceTotals)
  if (mergedSourceTotals) {
    state.sourceTotals = mergedSourceTotals
  }
  if (!Array.isArray(state.displaySkillTotals) && Array.isArray(snapshot.displaySkillTotals)) {
    state.displaySkillTotals = snapshot.displaySkillTotals
  }
  return state
}

const ENRICHMENT_ARRAY_KEYS = [
  'displaySkillTotals',
  'displaySourceSkillRows',
  'selfSkillTotals',
  'selfSourceSkillRows'
] as const

function loadSnapshots(document: Record<string, unknown>): Record<string, unknown>[] {
  const snapshots = document.snapshots
  if (Array.isArray(snapshots) && snapshots.length) {
    return snapshots.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  }
  const finalState = document.finalState
  if (finalState && typeof finalState === 'object') {
    return [finalState as Record<string, unknown>]
  }
  return [document]
}

function resolveEnrichmentState(document: Record<string, unknown>, snapshots: Record<string, unknown>[]): Record<string, unknown> {
  const finalState = document.finalState
  if (finalState && typeof finalState === 'object') {
    return finalState as Record<string, unknown>
  }
  return snapshots.at(-1) ?? {}
}

function mergeEnrichmentArrays(
  state: Record<string, unknown>,
  enrichment: Record<string, unknown>
): void {
  for (const key of ENRICHMENT_ARRAY_KEYS) {
    const current = state[key]
    const fallback = enrichment[key]
    if (!Array.isArray(fallback) || !fallback.length) continue
    if (!Array.isArray(current) || !current.length) {
      state[key] = fallback
    }
  }
}

export class OfflineMeterReplay {
  readonly #snapshots: Record<string, unknown>[]
  readonly #enrichmentState: Record<string, unknown>
  readonly #info: OfflineReplayInfo
  #startedAt = Date.now()
  #replayDurationMs: number

  constructor(path: string) {
    if (!existsSync(path)) {
      throw new Error(`offline meter file not found: ${path}`)
    }

    const document = readJsonFile(path)
    this.#snapshots = loadSnapshots(document)
    this.#enrichmentState = resolveEnrichmentState(document, this.#snapshots)
    const mode =
      Array.isArray(document.snapshots) && document.snapshots.length > 1 ? 'replay' : 'static'
    const bossName = String(
      (this.#snapshots.at(-1)?.summary as Record<string, unknown> | undefined)?.bossName ??
        document.bossName ??
        'offline encounter'
    ).trim()
    this.#replayDurationMs = Math.max(
      15_000,
      Number(process.env.METER_OFFLINE_REPLAY_SECONDS ?? 90) * 1000
    )
    this.#info = {
      mode,
      sourcePath: path,
      label: bossName || 'offline encounter',
      snapshotCount: this.#snapshots.length,
      replayDurationSeconds: this.#replayDurationMs / 1000
    }
  }

  static tryCreate(): OfflineMeterReplay | null {
    if (process.env.METER_OFFLINE !== '1') return null
    const path = resolveOfflinePath()
    return new OfflineMeterReplay(path)
  }

  get info(): OfflineReplayInfo {
    return { ...this.#info }
  }

  fetchState(): MeterState {
    const index = this.#currentIndex()
    const snapshot = this.#snapshots[index] ?? this.#snapshots.at(-1) ?? {}
    const state = normalizeSnapshot(snapshot)
    mergeEnrichmentArrays(state, this.#enrichmentState)
    return {
      ...state,
      _offlineReplay: true,
      _offlineReplayMode: this.#info.mode,
      _offlineReplayLabel: this.#info.label,
      _offlineReplayIndex: index + 1,
      _offlineReplayTotal: this.#snapshots.length,
      _offlineReplayProgress:
        this.#snapshots.length > 1 ? index / (this.#snapshots.length - 1) : 1
    }
  }

  reset(): void {
    this.#startedAt = Date.now()
  }

  shutdown(): void {
    // no-op for offline replay
  }

  #currentIndex(): number {
    if (this.#info.mode === 'static' || this.#snapshots.length <= 1) {
      return this.#snapshots.length - 1
    }
    const progress = Math.min(1, (Date.now() - this.#startedAt) / this.#replayDurationMs)
    return Math.min(this.#snapshots.length - 1, Math.floor(progress * (this.#snapshots.length - 1)))
  }
}
