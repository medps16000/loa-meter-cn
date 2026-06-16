import { ipcMain } from 'electron'
import type { EncounterDb } from '../db/encounter-db'
import {
  closeOverlayWindow,
  getOverlaySettings,
  isOverlayClickThrough,
  isOverlayLocked,
  setOverlayClickThrough,
  setOverlayInteractiveRects,
  setOverlayLocked,
  setOverlayCompact,
  toggleOverlayCompact,
  setOverlayOpacity,
  setOverlayPointerPassthrough,
  resizeOverlayToHeight
} from '../overlay-window'
import {
  clearProjection,
  getProjectionInfo,
  projectEncounter
} from '../services/encounter-projection'
import { clearRunsLogs } from '../services/clear-runs-logs'
import type { MeterClient } from '../services/meter-client'

export type IpcHooks = {
  pushStateToOverlay: () => void
}

export function registerIpcHandlers(db: EncounterDb, meter: MeterClient, hooks: IpcHooks): void {
  ipcMain.handle('meter:fetchState', async () => meter.fetchState())
  ipcMain.handle('meter:reset', async () => {
    await meter.reset()
    return { ok: true }
  })
  ipcMain.handle('meter:shutdown', async () => {
    await meter.shutdown()
    return { ok: true }
  })

  ipcMain.handle(
    'encounters:list',
    (_event, limit?: number, filters?: { raidName?: string; bossName?: string }) =>
      db.listEncounters(limit ?? 30, filters ?? {})
  )
  ipcMain.handle('encounters:get', (_event, id: number) => db.getEncounter(id))
  ipcMain.handle('encounters:listRaidNames', () => db.listRaidNames())
  ipcMain.handle('encounters:delete', (_event, id: number) => {
    const numericId = Number(id)
    // If the record being removed is currently pinned on the overlay, drop the
    // projection so the overlay falls back to live data instead of a dangling
    // (now deleted) encounter.
    const projected = getProjectionInfo()
    const deleted = db.deleteEncounter(numericId)
    if (deleted && projected?.id === numericId) {
      clearProjection()
      hooks.pushStateToOverlay()
    }
    return { ok: deleted }
  })

  // Query-tool mode: pin a stored encounter onto the overlay.
  ipcMain.handle('overlay:projectEncounter', (_event, id: number) => {
    const info = projectEncounter(db, Number(id))
    if (!info) return { ok: false }
    hooks.pushStateToOverlay()
    return { ok: true, projection: info }
  })
  ipcMain.handle('overlay:clearProjection', () => {
    clearProjection()
    hooks.pushStateToOverlay()
    return { ok: true }
  })
  ipcMain.handle('overlay:getProjection', () => getProjectionInfo())

  // Free disk/memory pressure: wipe the collected wire captures + run logs under
  // %LOCALAPPDATA%\LOA_METER_CN\runs. History (encounters.db) is untouched.
  ipcMain.handle('logs:clear', () => clearRunsLogs())

  ipcMain.handle('overlay:getSettings', () => getOverlaySettings())
  ipcMain.handle('overlay:getClickThrough', () => isOverlayClickThrough())
  ipcMain.handle('overlay:getLocked', () => isOverlayLocked())
  ipcMain.handle('overlay:toggleClickThrough', () => {
    const next = !isOverlayClickThrough()
    return setOverlayClickThrough(next)
  })
  ipcMain.handle('overlay:setClickThrough', (_event, enabled: boolean) =>
    setOverlayClickThrough(Boolean(enabled))
  )
  ipcMain.handle('overlay:setLocked', (_event, locked: boolean) =>
    setOverlayLocked(Boolean(locked))
  )
  ipcMain.handle('overlay:toggleLocked', () => setOverlayLocked(!isOverlayLocked()))
  ipcMain.handle('overlay:setCompact', (_event, compact: boolean) =>
    setOverlayCompact(Boolean(compact))
  )
  ipcMain.handle('overlay:toggleCompact', () => toggleOverlayCompact())
  ipcMain.handle('overlay:setOpacity', (_event, opacity: number) => setOverlayOpacity(Number(opacity)))
  ipcMain.handle('overlay:closeWindow', () => {
    closeOverlayWindow()
    return { ok: true }
  })
  ipcMain.on('overlay:setPointerPassthrough', (_event, passThrough: boolean) => {
    setOverlayPointerPassthrough(Boolean(passThrough))
  })
  ipcMain.on(
    'overlay:setInteractiveRects',
    (_event, rects: Array<{ x: number; y: number; width: number; height: number }>) => {
      setOverlayInteractiveRects(Array.isArray(rects) ? rects : [])
    }
  )
  ipcMain.handle('overlay:resizeToHeight', (_event, height: number) => {
    resizeOverlayToHeight(Number(height))
    return { ok: true }
  })

  ipcMain.handle('writer:lastError', () => null)
}
