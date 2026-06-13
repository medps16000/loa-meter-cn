import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import type { EncounterDb } from './db/encounter-db'
import { loadRendererWindow } from './load-renderer'
import {
  DEFAULT_OVERLAY_SETTINGS,
  loadOverlaySettings,
  saveOverlaySettings,
  type OverlaySettings
} from './overlay-settings'

const OVERLAY_MIN_WIDTH = 360
const OVERLAY_MIN_HEIGHT = 160
const OVERLAY_MAX_HEIGHT = 560
const OVERLAY_DEFAULT_HEIGHT = 430
const TITLE_INTERACTIVE_HEIGHT = 88
const FOOTER_INTERACTIVE_HEIGHT = 40

let overlayWindow: BrowserWindow | null = null
let overlayDb: EncounterDb | null = null
let overlaySettings: OverlaySettings = { ...DEFAULT_OVERLAY_SETTINGS }
let lockedBounds: Rectangle | null = null
let pointerPollTimer: ReturnType<typeof setInterval> | null = null
let pointerPassthroughActive = false

export function bindOverlayDatabase(db: EncounterDb): void {
  overlayDb = db
  overlaySettings = loadOverlaySettings(db)
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow
}

export function getOverlaySettings(): OverlaySettings {
  return { ...overlaySettings }
}

export function isOverlayClickThrough(): boolean {
  return overlaySettings.clickThrough
}

export function isOverlayLocked(): boolean {
  return overlaySettings.locked
}

function persistSettings(patch: Partial<OverlaySettings>): OverlaySettings {
  if (overlayDb) {
    overlaySettings = saveOverlaySettings(overlayDb, patch)
  } else {
    overlaySettings = {
      opacity: patch.opacity ?? overlaySettings.opacity,
      locked: patch.locked ?? overlaySettings.locked,
      clickThrough: patch.clickThrough ?? overlaySettings.clickThrough
    }
  }
  applyOverlaySettings()
  return { ...overlaySettings }
}

function broadcastOverlaySettings(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.webContents.send('overlay:settingsChanged', { ...overlaySettings })
}

function updatePointerPassthrough(passThrough: boolean): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (!overlaySettings.clickThrough) {
    overlayWindow.setIgnoreMouseEvents(false)
    pointerPassthroughActive = false
    return
  }
  if (pointerPassthroughActive === passThrough) return
  if (passThrough) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  } else {
    overlayWindow.setIgnoreMouseEvents(false)
  }
  pointerPassthroughActive = passThrough
}

function pollInteractiveRegion(): void {
  if (!overlaySettings.clickThrough || !overlayWindow || overlayWindow.isDestroyed()) return
  const bounds = overlayWindow.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const inX = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width
  const inTitle = inX && cursor.y >= bounds.y && cursor.y < bounds.y + TITLE_INTERACTIVE_HEIGHT
  const inFooter =
    inX &&
    cursor.y >= bounds.y + bounds.height - FOOTER_INTERACTIVE_HEIGHT &&
    cursor.y < bounds.y + bounds.height
  updatePointerPassthrough(!(inTitle || inFooter))
}

function startPointerPassthroughPolling(): void {
  stopPointerPassthroughPolling()
  pointerPollTimer = setInterval(pollInteractiveRegion, 50)
  pollInteractiveRegion()
}

function stopPointerPassthroughPolling(): void {
  if (!pointerPollTimer) return
  clearInterval(pointerPollTimer)
  pointerPollTimer = null
}

function applyOverlaySettings(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.setOpacity(overlaySettings.opacity)
  overlayWindow.setResizable(!overlaySettings.locked)
  overlayWindow.setMovable(!overlaySettings.locked)

  if (!overlaySettings.clickThrough) {
    overlayWindow.setIgnoreMouseEvents(false)
    pointerPassthroughActive = false
  }

  if (overlaySettings.locked) {
    lockedBounds = overlayWindow.getBounds()
    overlayWindow.setMinimumSize(lockedBounds.width, lockedBounds.height)
    overlayWindow.setMaximumSize(lockedBounds.width, lockedBounds.height)
  } else {
    lockedBounds = null
    overlayWindow.setMinimumSize(OVERLAY_MIN_WIDTH, OVERLAY_MIN_HEIGHT)
    overlayWindow.setMaximumSize(100000, OVERLAY_MAX_HEIGHT)
  }

  if (overlaySettings.clickThrough) {
    startPointerPassthroughPolling()
  } else {
    stopPointerPassthroughPolling()
    updatePointerPassthrough(false)
  }

  broadcastOverlaySettings()
}

function guardOverlayMove(win: BrowserWindow): void {
  win.on('move', () => {
    if (!overlaySettings.locked || !lockedBounds || win.isDestroyed()) return
    const current = win.getBounds()
    if (current.x === lockedBounds.x && current.y === lockedBounds.y) return
    win.setBounds({
      x: lockedBounds.x,
      y: lockedBounds.y,
      width: current.width,
      height: current.height
    })
  })
}

export function setOverlayClickThrough(enabled: boolean): OverlaySettings {
  return persistSettings({ clickThrough: enabled })
}

export function setOverlayLocked(locked: boolean): OverlaySettings {
  return persistSettings({ locked })
}

export function setOverlayOpacity(opacity: number): OverlaySettings {
  return persistSettings({ opacity })
}

export function setOverlayPointerPassthrough(passThrough: boolean): void {
  updatePointerPassthrough(passThrough)
}

export function resizeOverlayToHeight(targetHeight: number): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (overlaySettings.locked) return
  const bounds = overlayWindow.getBounds()
  const height = Math.max(
    OVERLAY_MIN_HEIGHT,
    Math.min(OVERLAY_MAX_HEIGHT, Math.round(targetHeight))
  )
  if (bounds.height === height) return
  overlayWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height
  })
}

export function createOverlayWindow(): BrowserWindow {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: 560,
    height: OVERLAY_DEFAULT_HEIGHT,
    x: Math.max(24, width - 600),
    y: 96,
    minWidth: 360,
    minHeight: 160,
    maxHeight: OVERLAY_MAX_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: !overlaySettings.locked,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  guardOverlayMove(win)
  applyOverlaySettings()

  loadRendererWindow(win, '../renderer/overlay/index.html', '/overlay/index.html')

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('closed', () => {
    stopPointerPassthroughPolling()
    overlayWindow = null
  })

  overlayWindow = win
  return win
}

export function closeOverlayWindow(): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  stopPointerPassthroughPolling()
  win.setIgnoreMouseEvents(false)
  win.close()
}
