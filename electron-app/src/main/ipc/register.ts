import { dialog, ipcMain } from 'electron'
import type { EncounterDb } from '../db/encounter-db'
import {
  closeOverlayWindow,
  getOverlaySettings,
  isOverlayClickThrough,
  isOverlayLocked,
  setOverlayClickThrough,
  setOverlayLocked,
  setOverlayOpacity,
  setOverlayPointerPassthrough,
  resizeOverlayToHeight
} from '../overlay-window'
import { importEncounterJsonDir } from '../services/import-encounters'
import type { MeterClient } from '../services/meter-client'

export function registerIpcHandlers(db: EncounterDb, meter: MeterClient): void {
  ipcMain.handle('meter:fetchState', async () => meter.fetchState())
  ipcMain.handle('meter:reset', async () => {
    await meter.reset()
    return { ok: true }
  })
  ipcMain.handle('meter:shutdown', async () => {
    await meter.shutdown()
    return { ok: true }
  })

  ipcMain.handle('encounters:list', (_event, limit?: number) => db.listEncounters(limit ?? 30))
  ipcMain.handle('encounters:get', (_event, id: number) => db.getEncounter(id))
  ipcMain.handle('encounters:importJsonDir', async (_event, dirPath?: string) => {
    let target = dirPath
    if (!target) {
      const result = await dialog.showOpenDialog({
        title: '选择 runs 或 encounters 目录',
        properties: ['openDirectory']
      })
      if (result.canceled || !result.filePaths.length) {
        return { ok: false, imported: 0, cancelled: true }
      }
      target = result.filePaths[0]
    }
    const imported = importEncounterJsonDir(db, target)
    return { ok: true, imported, path: target }
  })

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
  ipcMain.handle('overlay:setOpacity', (_event, opacity: number) => setOverlayOpacity(Number(opacity)))
  ipcMain.handle('overlay:closeWindow', () => {
    closeOverlayWindow()
    return { ok: true }
  })
  ipcMain.on('overlay:setPointerPassthrough', (_event, passThrough: boolean) => {
    setOverlayPointerPassthrough(Boolean(passThrough))
  })
  ipcMain.handle('overlay:resizeToHeight', (_event, height: number) => {
    resizeOverlayToHeight(Number(height))
    return { ok: true }
  })

  ipcMain.handle('writer:lastError', () => null)
}
