import { app } from 'electron'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type ClearLogsResult = {
  ok: boolean
  removed: number
  skipped: number
  freedBytes: number
  path: string
}

/**
 * 抓包采集到的 wire / 日志全部写在 %LOCALAPPDATA%\LOA_METER_CN\runs 下，每场战斗
 * 一个时间戳子目录。历史战绩在同级的 encounters.db（不在 runs 内），所以清空 runs
 * 不会丢失战斗记录，只是删掉占空间的原始 wire 抓包与运行日志。
 */
function runsRoot(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || app.getPath('home')
  return join(base, 'LOA_METER_CN', 'runs')
}

function dirSize(path: string): number {
  let total = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry.name)
    try {
      if (entry.isDirectory()) {
        total += dirSize(full)
      } else if (entry.isFile()) {
        total += statSync(full).size
      }
    } catch {
      // file disappeared / locked — ignore for the size estimate
    }
  }
  return total
}

/**
 * Delete every run subdirectory under runs/. The currently-recording run keeps
 * open file handles (Windows locks them), so its files are skipped automatically
 * and the active capture is not interrupted — only finished runs are freed.
 */
export function clearRunsLogs(): ClearLogsResult {
  const root = runsRoot()
  if (!existsSync(root)) {
    return { ok: true, removed: 0, skipped: 0, freedBytes: 0, path: root }
  }

  let removed = 0
  let skipped = 0
  let freedBytes = 0

  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return { ok: false, removed, skipped, freedBytes, path: root }
  }

  for (const entry of entries) {
    const full = join(root, entry.name)
    const before = dirSize(full)
    try {
      rmSync(full, { recursive: true, force: true })
    } catch {
      // partial deletion (e.g. the active run's locked jsonl) — fall through
    }
    if (existsSync(full)) {
      skipped += 1
      freedBytes += Math.max(0, before - dirSize(full))
    } else {
      removed += 1
      freedBytes += before
    }
  }

  return { ok: true, removed, skipped, freedBytes, path: root }
}
