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
// Thumbnail/compact mode hides the tabs + footer, so it may shrink well below
// the full-mode floor.
const OVERLAY_COMPACT_MIN_HEIGHT = 72
const OVERLAY_MAX_HEIGHT = 560
const OVERLAY_DEFAULT_HEIGHT = 430
const OVERLAY_DEFAULT_WIDTH = 560
// 缩略模式宽度: 只放下关卡/时长 + 紧凑 DPS 列表 (= 最小宽度, 尽量少占游戏画面).
const OVERLAY_COMPACT_WIDTH = OVERLAY_MIN_WIDTH
const TITLE_INTERACTIVE_HEIGHT = 88
const FOOTER_INTERACTIVE_HEIGHT = 40

type InteractiveRect = { x: number; y: number; width: number; height: number }

let overlayWindow: BrowserWindow | null = null
let overlayDb: EncounterDb | null = null
let overlaySettings: OverlaySettings = { ...DEFAULT_OVERLAY_SETTINGS }
let lockedBounds: Rectangle | null = null
// Full-mode width remembered when entering compact, restored on expand.
let savedFullWidth: number | null = null
let pointerPollTimer: ReturnType<typeof setInterval> | null = null
let pointerPassthroughActive = false
// Window-relative interactive regions reported by the renderer. When set, only
// these rectangles capture the cursor in click-through mode (everything else
// passes through). Currently this is just the top-right button group, so the
// top-left combat info and the footer opacity hint can't be clicked by mistake.
let interactiveRects: InteractiveRect[] = []

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
      clickThrough: patch.clickThrough ?? overlaySettings.clickThrough,
      compact: patch.compact ?? overlaySettings.compact
    }
  }
  applyOverlaySettings()
  return { ...overlaySettings }
}

// Compact mode is allowed to sit shorter than the full-mode floor.
function currentMinHeight(): number {
  return overlaySettings.compact ? OVERLAY_COMPACT_MIN_HEIGHT : OVERLAY_MIN_HEIGHT
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
  const relX = cursor.x - bounds.x
  const relY = cursor.y - bounds.y
  const inX = relX >= 0 && relX < bounds.width
  let interactive: boolean
  if (interactiveRects.length) {
    // Renderer reported the live interactive region(s) (the top-right button
    // group). Only those capture the cursor; the rest of the overlay passes
    // through so the combat info / footer hint can't be clicked by accident.
    interactive =
      inX &&
      relY >= 0 &&
      relY < bounds.height &&
      interactiveRects.some(
        (rect) =>
          relX >= rect.x &&
          relX < rect.x + rect.width &&
          relY >= rect.y &&
          relY < rect.y + rect.height
      )
  } else {
    // Fallback before the renderer reports (keeps the controls reachable).
    const inTitle = inX && relY >= 0 && relY < TITLE_INTERACTIVE_HEIGHT
    const inFooter =
      inX && relY >= bounds.height - FOOTER_INTERACTIVE_HEIGHT && relY < bounds.height
    interactive = inTitle || inFooter
  }
  updatePointerPassthrough(!interactive)
}

export function setOverlayInteractiveRects(rects: InteractiveRect[]): void {
  interactiveRects = Array.isArray(rects)
    ? rects.filter(
        (rect) =>
          rect &&
          Number.isFinite(rect.x) &&
          Number.isFinite(rect.y) &&
          rect.width > 0 &&
          rect.height > 0
      )
    : []
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
    overlayWindow.setMinimumSize(OVERLAY_MIN_WIDTH, currentMinHeight())
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

// Resize only the width (keeps x/y/height), honoring the min-width floor and
// temporarily relaxing the locked size pin so an explicit compact toggle works
// even when the overlay is locked.
function resizeOverlayWidth(targetWidth: number): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const bounds = overlayWindow.getBounds()
  const width = Math.max(OVERLAY_MIN_WIDTH, Math.round(targetWidth))
  if (bounds.width === width) return
  const wasLocked = overlaySettings.locked
  if (wasLocked) {
    overlayWindow.setMinimumSize(OVERLAY_MIN_WIDTH, currentMinHeight())
    overlayWindow.setMaximumSize(100000, OVERLAY_MAX_HEIGHT)
  }
  overlayWindow.setBounds({ x: bounds.x, y: bounds.y, width, height: bounds.height })
  if (wasLocked) {
    const pinned = overlayWindow.getBounds()
    lockedBounds = pinned
    overlayWindow.setMinimumSize(pinned.width, pinned.height)
    overlayWindow.setMaximumSize(pinned.width, pinned.height)
  }
}

export function setOverlayCompact(compact: boolean): OverlaySettings {
  const alreadyCompact = overlaySettings.compact
  if (compact && !alreadyCompact && overlayWindow && !overlayWindow.isDestroyed()) {
    savedFullWidth = overlayWindow.getBounds().width
  }
  const next = persistSettings({ compact })
  if (compact) {
    resizeOverlayWidth(OVERLAY_COMPACT_WIDTH)
  } else {
    resizeOverlayWidth(savedFullWidth ?? OVERLAY_DEFAULT_WIDTH)
    savedFullWidth = null
  }
  return next
}

export function toggleOverlayCompact(): OverlaySettings {
  return setOverlayCompact(!overlaySettings.compact)
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
    currentMinHeight(),
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
  const initialWidth = overlaySettings.compact ? OVERLAY_COMPACT_WIDTH : OVERLAY_DEFAULT_WIDTH
  const win = new BrowserWindow({
    width: initialWidth,
    height: OVERLAY_DEFAULT_HEIGHT,
    x: Math.max(24, width - 600),
    y: 96,
    minWidth: OVERLAY_MIN_WIDTH,
    minHeight: overlaySettings.compact ? OVERLAY_COMPACT_MIN_HEIGHT : OVERLAY_MIN_HEIGHT,
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
  interactiveRects = []
  win.setIgnoreMouseEvents(false)
  win.close()
}
