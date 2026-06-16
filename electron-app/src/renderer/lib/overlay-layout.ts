export const OVERLAY_ROW_HEIGHT = 30
// Includes the optional raid-name line in the titlebar.
export const OVERLAY_CHROME_HEIGHT = 214
export const OVERLAY_SKILL_CONTEXT_HEIGHT = 30
export const OVERLAY_ROWS_PADDING = 12
export const OVERLAY_HEIGHT_BUFFER = 8
export const OVERLAY_DEFAULT_PARTY_ROWS = 8
export const OVERLAY_MIN_HEIGHT = 160
// Thumbnail/compact mode drops the tabs + footer, so it can sit much shorter.
export const OVERLAY_COMPACT_MIN_HEIGHT = 72
export const OVERLAY_MAX_HEIGHT = 560
export const OVERLAY_MAX_AUTO_ROWS = 12
export const OVERLAY_ROW_LIMIT = 12
export const OVERLAY_SKILL_FIXED_ROWS = 6

export function computeOverlayHeight(
  rowCount: number,
  options: { skillContext?: boolean; maxRows?: number } = {}
): number {
  const maxRows = options.maxRows ?? OVERLAY_MAX_AUTO_ROWS
  const rows = Math.max(1, Math.min(maxRows, rowCount || 1))
  let height =
    OVERLAY_CHROME_HEIGHT + rows * OVERLAY_ROW_HEIGHT + OVERLAY_ROWS_PADDING + OVERLAY_HEIGHT_BUFFER
  if (options.skillContext) height += OVERLAY_SKILL_CONTEXT_HEIGHT
  return Math.max(OVERLAY_MIN_HEIGHT, Math.min(OVERLAY_MAX_HEIGHT, height))
}

export function defaultOverlayHeight(): number {
  return computeOverlayHeight(OVERLAY_DEFAULT_PARTY_ROWS)
}

export function measureOverlayContentHeight(root: HTMLElement | null): number | null {
  if (!root) return null
  const parts = [
    root.querySelector('.titlebar'),
    root.querySelector('.tabs'),
    root.querySelector('.skill-context'),
    root.querySelector('.shield-subtabs'),
    root.querySelector(':scope > .grid-head'),
    root.querySelector('.rows'),
    root.querySelector('.footer')
  ]
  let total = 0
  for (const part of parts) {
    if (!part) continue
    total += Math.ceil(part.getBoundingClientRect().height)
  }
  return total + OVERLAY_HEIGHT_BUFFER
}
