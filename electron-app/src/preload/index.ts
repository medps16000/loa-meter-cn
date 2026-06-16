import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export type OverlaySettings = {
  opacity: number
  locked: boolean
  clickThrough: boolean
  compact: boolean
}

export type MeterApi = {
  fetchState: () => Promise<Record<string, unknown>>
  reset: () => Promise<{ ok: boolean }>
  shutdown: () => Promise<{ ok: boolean }>
  onStateChange: (callback: (state: Record<string, unknown>) => void) => () => void
}

export type EncountersApi = {
  list: (
    limit?: number,
    filters?: { raidName?: string; bossName?: string }
  ) => Promise<unknown[]>
  get: (id: number) => Promise<unknown | null>
  listRaidNames: () => Promise<string[]>
  delete: (id: number) => Promise<{ ok: boolean }>
  importJsonDir: (dirPath?: string) => Promise<{
    ok: boolean
    imported: number
    path?: string
    cancelled?: boolean
  }>
}

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

const meterApi: MeterApi = {
  fetchState: () => ipcRenderer.invoke('meter:fetchState'),
  reset: () => ipcRenderer.invoke('meter:reset'),
  shutdown: () => ipcRenderer.invoke('meter:shutdown'),
  onStateChange: (callback: (state: Record<string, unknown>) => void) => {
    const listener = (_event: IpcRendererEvent, state: Record<string, unknown>) => callback(state)
    ipcRenderer.on('meter:state', listener)
    return () => ipcRenderer.removeListener('meter:state', listener)
  }
}

const encountersApi: EncountersApi = {
  list: (limit?: number, filters?: { raidName?: string; bossName?: string }) =>
    ipcRenderer.invoke('encounters:list', limit, filters),
  get: (id: number) => ipcRenderer.invoke('encounters:get', id),
  listRaidNames: () => ipcRenderer.invoke('encounters:listRaidNames'),
  delete: (id: number) => ipcRenderer.invoke('encounters:delete', id),
  importJsonDir: (dirPath?: string) => ipcRenderer.invoke('encounters:importJsonDir', dirPath)
}

const overlayApi = {
  getSettings: () => ipcRenderer.invoke('overlay:getSettings') as Promise<OverlaySettings>,
  getClickThrough: () => ipcRenderer.invoke('overlay:getClickThrough') as Promise<boolean>,
  getLocked: () => ipcRenderer.invoke('overlay:getLocked') as Promise<boolean>,
  toggleClickThrough: () => ipcRenderer.invoke('overlay:toggleClickThrough') as Promise<OverlaySettings>,
  setClickThrough: (enabled: boolean) =>
    ipcRenderer.invoke('overlay:setClickThrough', enabled) as Promise<OverlaySettings>,
  toggleLocked: () => ipcRenderer.invoke('overlay:toggleLocked') as Promise<OverlaySettings>,
  setLocked: (locked: boolean) =>
    ipcRenderer.invoke('overlay:setLocked', locked) as Promise<OverlaySettings>,
  toggleCompact: () => ipcRenderer.invoke('overlay:toggleCompact') as Promise<OverlaySettings>,
  setCompact: (compact: boolean) =>
    ipcRenderer.invoke('overlay:setCompact', compact) as Promise<OverlaySettings>,
  setOpacity: (opacity: number) =>
    ipcRenderer.invoke('overlay:setOpacity', opacity) as Promise<OverlaySettings>,
  closeWindow: () => ipcRenderer.invoke('overlay:closeWindow') as Promise<{ ok: boolean }>,
  projectEncounter: (id: number) =>
    ipcRenderer.invoke('overlay:projectEncounter', id) as Promise<{
      ok: boolean
      projection?: ProjectionInfo
    }>,
  clearProjection: () =>
    ipcRenderer.invoke('overlay:clearProjection') as Promise<{ ok: boolean }>,
  getProjection: () =>
    ipcRenderer.invoke('overlay:getProjection') as Promise<ProjectionInfo | null>,
  resizeToHeight: (height: number) =>
    ipcRenderer.invoke('overlay:resizeToHeight', height) as Promise<{ ok: boolean }>,
  setPointerPassthrough: (passThrough: boolean) => {
    ipcRenderer.send('overlay:setPointerPassthrough', passThrough)
  },
  setInteractiveRects: (
    rects: Array<{ x: number; y: number; width: number; height: number }>
  ) => {
    ipcRenderer.send('overlay:setInteractiveRects', rects)
  },
  onSettingsChanged: (callback: (settings: OverlaySettings) => void) => {
    const listener = (_event: IpcRendererEvent, settings: OverlaySettings) => callback(settings)
    ipcRenderer.on('overlay:settingsChanged', listener)
    return () => ipcRenderer.removeListener('overlay:settingsChanged', listener)
  }
}

contextBridge.exposeInMainWorld('meterApi', meterApi)
contextBridge.exposeInMainWorld('encountersApi', encountersApi)
contextBridge.exposeInMainWorld('overlayApi', overlayApi)
contextBridge.exposeInMainWorld('writerApi', {
  lastError: () => ipcRenderer.invoke('writer:lastError')
})
