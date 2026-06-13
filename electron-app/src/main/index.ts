import { app, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'node:path'
import { EncounterDb } from './db/encounter-db'
import { registerIpcHandlers } from './ipc/register'
import { loadRendererWindow } from './load-renderer'
import {
  bindOverlayDatabase,
  closeOverlayWindow,
  createOverlayWindow,
  getOverlayWindow,
  setOverlayClickThrough,
  isOverlayClickThrough
} from './overlay-window'
import { MeterClient, type MeterState } from './services/meter-client'
import {
  configurePackagedMeterEnvironment,
  forgetPackagedBackendProcess,
  startPackagedBackend
} from './backend-runtime'

function defaultDbPath(): string {
  const base =
    process.env.LOCALAPPDATA ??
    process.env.APPDATA ??
    join(app.getPath('home'), '.loa_meter_cn')
  return join(base, 'LOA_METER_CN', 'encounters.db')
}

function shouldShowMainWindow(): boolean {
  return process.env.METER_MAIN_UI !== '0'
}

function shouldShowOverlayWindow(): boolean {
  return process.env.METER_OVERLAY !== '0'
}

let mainWindow: BrowserWindow | null = null
let encounterDb: EncounterDb | null = null
let meterClient: MeterClient | null = null
let removeMeterListener: (() => void) | null = null
let quitAfterCleanup = false

function broadcastMeterState(state: MeterState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('meter:state', state)
  }
  const overlay = getOverlayWindow()
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('meter:state', state)
  }
}

function createWindow(offlineLabel?: string | null): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    title: offlineLabel ? `LOA METER CN [OFFLINE · ${offlineLabel}]` : 'LOA METER CN',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  loadRendererWindow(mainWindow, '../renderer/index.html')
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerGlobalShortcuts(): void {
  globalShortcut.register('Control+Shift+M', () => {
    setOverlayClickThrough(!isOverlayClickThrough())
  })
}

async function cleanupRuntime(sendShutdown: boolean): Promise<void> {
  globalShortcut.unregisterAll()
  closeOverlayWindow()
  removeMeterListener?.()
  removeMeterListener = null

  const client = meterClient
  meterClient = null
  client?.stop()
  if (sendShutdown && client && !client.isOffline) {
    await client.shutdown().catch(() => undefined)
  }

  encounterDb?.close()
  encounterDb = null
  forgetPackagedBackendProcess()
}

app.whenReady().then(() => {
  configurePackagedMeterEnvironment()
  startPackagedBackend()

  encounterDb = new EncounterDb(process.env.METER_DB_PATH ?? defaultDbPath())
  bindOverlayDatabase(encounterDb)
  meterClient = new MeterClient()
  registerIpcHandlers(encounterDb, meterClient)
  removeMeterListener = meterClient.onStateChange(broadcastMeterState)
  meterClient.start()

  if (shouldShowMainWindow()) {
    createWindow(meterClient.offlineInfo?.label ?? null)
  }
  if (shouldShowOverlayWindow()) {
    createOverlayWindow()
  }
  registerGlobalShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (shouldShowMainWindow()) createWindow(meterClient?.offlineInfo?.label ?? null)
      if (shouldShowOverlayWindow()) createOverlayWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (quitAfterCleanup) return
  event.preventDefault()
  quitAfterCleanup = true
  void cleanupRuntime(app.isPackaged).finally(() => app.quit())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  closeOverlayWindow()
})
