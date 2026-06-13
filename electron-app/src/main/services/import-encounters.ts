import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { EncounterDb } from '../db/encounter-db'

function walkJsonFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkJsonFiles(full, out)
    else if (entry.isFile() && /^encounter_.*\.json$/i.test(entry.name)) out.push(full)
  }
  return out
}

function metricsFromDocument(document: Record<string, unknown>) {
  const state =
    document.finalState && typeof document.finalState === 'object'
      ? (document.finalState as Record<string, unknown>)
      : {}
  const display =
    state.display && typeof state.display === 'object'
      ? (state.display as Record<string, unknown>)
      : {}
  const summary =
    state.summary && typeof state.summary === 'object'
      ? (state.summary as Record<string, unknown>)
      : {}

  return {
    bossName: String(display.bossName ?? summary.bossName ?? '全部目标'),
    totalDamage: Number(display.totalDamage ?? state.totalDamage ?? 0),
    dps: Number(display.dps ?? state.dps ?? 0),
    hitCount: Number(display.hitCount ?? state.hitCount ?? 0),
    critRate: Number(display.critRate ?? state.critRate ?? 0),
    durationSeconds: Number(state.elapsedSeconds ?? 0),
    rowCount: Number(display.rowCount ?? 0),
    status: String(state.status ?? 'imported'),
    bossKnown: Boolean(display.bossKnown ?? summary.bossKnown)
  }
}

export function importEncounterJsonDir(db: EncounterDb, runsDir: string): number {
  let imported = 0
  for (const file of walkJsonFiles(runsDir)) {
    let document: Record<string, unknown>
    try {
      document = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    if (!document || typeof document !== 'object') continue

    const metrics = metricsFromDocument(document)
    const rowId = db.startEncounter({
      encounterId: Number(document.encounterId ?? 0) || 0,
      startedAt: String(document.startedAt ?? new Date(statSync(file).mtime).toISOString()),
      bossOnly: Boolean(document.bossOnly ?? true),
      runDir: dirname(file)
    })

    db.closeEncounter(rowId, {
      closedAt: String(document.closedAt ?? document.startedAt ?? new Date().toISOString()),
      finalState:
        document.finalState && typeof document.finalState === 'object'
          ? (document.finalState as Record<string, unknown>)
          : {},
      metrics
    })

    const snapshots = document.snapshots
    if (Array.isArray(snapshots)) {
      for (const snapshot of snapshots) {
        if (!snapshot || typeof snapshot !== 'object') continue
        const item = snapshot as Record<string, unknown>
        db.appendSnapshot(
          rowId,
          Number(item.updatedAt ?? item.capturedAt ?? Date.now() / 1000),
          item
        )
      }
      db.trimSnapshots(rowId, 1800)
    }

    imported += 1
    console.log(`[import] ${basename(file)} -> row ${rowId}`)
  }
  return imported
}
