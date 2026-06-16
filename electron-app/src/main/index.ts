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
import { getProjectionPayload } from './services/encounter-projection'
import { MeterClient, type MeterState } from './services/meter-client'
import { startBackend, stopBackend } from './backend'

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

function broadcastMeterState(state: MeterState): void {
  // The main window is a query-only tool and no longer renders live combat, so
  // we deliberately do NOT forward the (large) per-tick state to it. Only the
  // overlay consumes live updates, which keeps the main UI cheap.
  const overlay = getOverlayWindow()
  if (overlay && !overlay.isDestroyed()) {
    // While a stored encounter is projected, the overlay is pinned to it and
    // live updates are suppressed.
    const projected = getProjectionPayload()
    overlay.webContents.send('meter:state', projected ?? state)
  }
}

function pushStateToOverlay(): void {
  let overlay = getOverlayWindow()
  if (!overlay || overlay.isDestroyed()) {
    if (!shouldShowOverlayWindow()) return
    overlay = createOverlayWindow()
  }
  const payload = getProjectionPayload() ?? meterClient?.latestState ?? null
  if (!payload) return
  const send = (): void => {
    const win = getOverlayWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('meter:state', payload)
    }
  }
  if (overlay.webContents.isLoading()) {
    overlay.webContents.once('did-finish-load', send)
  } else {
    send()
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

app.whenReady().then(() => {
  // Start the bundled capture backend first (packaged Windows only); it serves
  // live combat state on 127.0.0.1:8765 that the meter client below consumes.
  // The client's reconnect loop tolerates the backend still coming up.
  startBackend()
  encounterDb = new EncounterDb(process.env.METER_DB_PATH ?? defaultDbPath())
  bindOverlayDatabase(encounterDb)
  meterClient = new MeterClient()
  registerIpcHandlers(encounterDb, meterClient, { pushStateToOverlay })
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
  globalShortcut.unregisterAll()
  removeMeterListener?.()
  removeMeterListener = null
  meterClient?.stop()
  encounterDb?.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  closeOverlayWindow()
})

// Ask the bundled backend (meter server + workers) to stop before we exit so it
// does not keep intercepting game packets after the UI closes.
let backendStopped = false
app.on('before-quit', (event) => {
  if (backendStopped) return
  event.preventDefault()
  void stopBackend().finally(() => {
    backendStopped = true
    app.quit()
  })
})
