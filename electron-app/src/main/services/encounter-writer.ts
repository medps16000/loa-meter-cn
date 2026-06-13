import type { EncounterDb } from '../db/encounter-db'
import { compactLogSnapshot } from './compact-snapshot'
import type { MeterClient } from './meter-client'

type WriterOptions = {
  bossOnly?: boolean
  maxSnapshots?: number
  writeIntervalMs?: number
  runDir?: string
}

function metricsFromState(state: Record<string, unknown>, bossOnly: boolean) {
  const summary =
    state.summary && typeof state.summary === 'object'
      ? (state.summary as Record<string, unknown>)
      : {}
  const displayTotals = Array.isArray(state.displaySourceTotals)
    ? state.displaySourceTotals
    : []
  return {
    bossName: String(summary.bossName ?? '全部目标'),
    totalDamage: Number(state.totalDamage ?? 0),
    dps: Number(state.dps ?? 0),
    hitCount: Number(state.hitCount ?? 0),
    critRate: Number(state.critRate ?? 0),
    durationSeconds: Number(state.elapsedSeconds ?? 0),
    rowCount: displayTotals.length,
    status: String(state.status ?? ''),
    bossKnown: Boolean(summary.bossKnown),
    bossOnly
  }
}

export class EncounterWriter {
  readonly #db: EncounterDb
  readonly #client: MeterClient
  readonly #bossOnly: boolean
  readonly #maxSnapshots: number
  readonly #writeIntervalMs: number
  readonly #runDir?: string

  #timer: NodeJS.Timeout | null = null
  #currentRowId: number | null = null
  #currentEncounterId: number | null = null
  #lastError: string | null = null

  constructor(db: EncounterDb, client: MeterClient, options: WriterOptions = {}) {
    this.#db = db
    this.#client = client
    this.#bossOnly = options.bossOnly ?? true
    this.#maxSnapshots = options.maxSnapshots ?? 1800
    this.#writeIntervalMs = options.writeIntervalMs ?? 3000
    this.#runDir = options.runDir
  }

  get lastError(): string | null {
    return this.#lastError
  }

  start(): void {
    if (this.#timer) return
    void this.#tick()
    this.#timer = setInterval(() => {
      void this.#tick()
    }, this.#writeIntervalMs)
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }
  }

  async #tick(): Promise<void> {
    try {
      const state = await this.#client.fetchState()
      await this.#applyState(state)
      this.#lastError = null
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error)
    }
  }

  async #applyState(state: Record<string, unknown>): Promise<void> {
    if (state.viewingArchivedEncounter === true) {
      return
    }

    const encounterId = Number(state.encounterId ?? 0)
    if (!encounterId) return

    const startedAt =
      typeof state.startedAt === 'number'
        ? new Date(state.startedAt * 1000).toISOString()
        : new Date().toISOString()

    if (this.#currentEncounterId !== encounterId) {
      if (this.#currentRowId != null) {
        const metrics = metricsFromState(state, this.#bossOnly)
        this.#db.closeEncounter(this.#currentRowId, {
          closedAt: new Date().toISOString(),
          finalState: compactLogSnapshot(state, metrics),
          metrics
        })
      }
      const existing = this.#db.findOpenEncounter(encounterId)
      this.#currentRowId =
        existing?.id ??
        this.#db.startEncounter({
          encounterId,
          startedAt,
          bossOnly: this.#bossOnly,
          runDir: this.#runDir
        })
      this.#currentEncounterId = encounterId
    }

    if (this.#currentRowId == null) return

    const metrics = metricsFromState(state, this.#bossOnly)
    this.#db.updateEncounterMetrics(this.#currentRowId, metrics)
    this.#db.appendSnapshot(
      this.#currentRowId,
      Number(state.updatedAt ?? Date.now() / 1000),
      compactLogSnapshot(state, metrics)
    )
    this.#db.trimSnapshots(this.#currentRowId, this.#maxSnapshots)
  }
}
