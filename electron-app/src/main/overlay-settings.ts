import type { EncounterDb } from './db/encounter-db'

export type OverlaySettings = {
  opacity: number
  locked: boolean
  clickThrough: boolean
  /** 缩略模式: 只显示关卡/时长 + 紧凑 DPS 列表的小窗口. */
  compact: boolean
}

const OPACITY_KEY = 'overlay.opacity'
const LOCKED_KEY = 'overlay.locked'
const CLICK_THROUGH_KEY = 'overlay.clickThrough'
const COMPACT_KEY = 'overlay.compact'

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  opacity: 0.92,
  locked: false,
  clickThrough: false,
  compact: false
}

function clampOpacity(value: number): number {
  return Math.max(0.35, Math.min(1, value))
}

export function loadOverlaySettings(db: EncounterDb): OverlaySettings {
  const opacityRaw = db.getSetting(OPACITY_KEY)
  const lockedRaw = db.getSetting(LOCKED_KEY)
  const clickThroughRaw = db.getSetting(CLICK_THROUGH_KEY)
  const compactRaw = db.getSetting(COMPACT_KEY)
  return {
    opacity: opacityRaw == null ? DEFAULT_OVERLAY_SETTINGS.opacity : clampOpacity(Number(opacityRaw)),
    locked: lockedRaw === '1',
    clickThrough: clickThroughRaw === '1',
    compact: compactRaw === '1'
  }
}

export function saveOverlaySettings(db: EncounterDb, settings: Partial<OverlaySettings>): OverlaySettings {
  const current = loadOverlaySettings(db)
  const next: OverlaySettings = {
    opacity: settings.opacity == null ? current.opacity : clampOpacity(settings.opacity),
    locked: settings.locked ?? current.locked,
    clickThrough: settings.clickThrough ?? current.clickThrough,
    compact: settings.compact ?? current.compact
  }
  db.setSetting(OPACITY_KEY, String(next.opacity))
  db.setSetting(LOCKED_KEY, next.locked ? '1' : '0')
  db.setSetting(CLICK_THROUGH_KEY, next.clickThrough ? '1' : '0')
  db.setSetting(COMPACT_KEY, next.compact ? '1' : '0')
  return next
}
