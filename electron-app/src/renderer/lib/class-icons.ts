import { coerceInt } from './coerce'

export const CLASS_NAMES: Record<number, string> = {
  0: 'Unknown',
  101: 'Warrior (Male)',
  102: 'Berserker',
  103: 'Destroyer',
  104: 'Gunlancer',
  105: 'Paladin',
  111: 'Female Warrior',
  112: 'Slayer',
  113: 'Valkyrie',
  201: 'Mage',
  202: 'Arcanist',
  203: 'Summoner',
  204: 'Bard',
  205: 'Sorceress',
  301: 'Martial Artist (Female)',
  302: 'Wardancer',
  303: 'Scrapper',
  304: 'Soulfist',
  305: 'Glaivier',
  311: 'Martial Artist (Male)',
  312: 'Striker',
  313: 'Breaker',
  401: 'Assassin',
  402: 'Deathblade',
  403: 'Shadowhunter',
  404: 'Reaper',
  405: 'Souleater',
  501: 'Gunner (Male)',
  502: 'Sharpshooter',
  503: 'Deadeye',
  504: 'Artillerist',
  505: 'Machinist',
  511: 'Gunner (Female)',
  512: 'Gunslinger',
  601: 'Specialist',
  602: 'Artist',
  603: 'Aeromancer',
  604: 'Wildsoul',
  701: 'Guardianknight',
  702: 'Guardianknight'
}

/** Class bar colors aligned with LOA Logs palette */
export const CLASS_COLORS: Record<number, string> = {
  101: '#b45309',
  102: '#dc2626',
  103: '#ea580c',
  104: '#2563eb',
  105: '#ca8a04',
  111: '#b91c1c',
  112: '#be123c',
  113: '#db2777',
  201: '#7c3aed',
  202: '#9333ea',
  203: '#a855f7',
  204: '#16a34a',
  205: '#7e22ce',
  301: '#ca8a04',
  302: '#eab308',
  303: '#f97316',
  304: '#fb923c',
  305: '#f59e0b',
  311: '#d97706',
  312: '#f59e0b',
  313: '#f97316',
  401: '#6d28d9',
  402: '#7c3aed',
  403: '#8b5cf6',
  404: '#a78bfa',
  405: '#9333ea',
  501: '#15803d',
  502: '#22c55e',
  503: '#16a34a',
  504: '#65a30d',
  505: '#84cc16',
  511: '#059669',
  512: '#10b981',
  601: '#0891b2',
  602: '#06b6d4',
  603: '#0ea5e9',
  604: '#22c55e',
  701: '#475569',
  702: '#64748b'
}

const iconModules = import.meta.glob('../assets/classes/*.png', {
  eager: true,
  import: 'default'
}) as Record<string, string>

const ICON_BY_CLASS_ID = new Map<number, string>()
for (const [path, url] of Object.entries(iconModules)) {
  const match = path.match(/\/(\d+)\.png$/)
  if (!match) continue
  ICON_BY_CLASS_ID.set(Number(match[1]), url)
}

export type ClassIdLookup = {
  bySourceId: Map<string, number>
  byPlayerName: Map<string, number>
}

function rowClassId(row: Record<string, unknown>): number | null {
  const classId = coerceInt(
    row.skillClassId,
    coerceInt(row.inferredClassId, coerceInt(row.classId, coerceInt(row.classid)))
  )
  return classId > 0 ? classId : null
}

function rowLabel(row: Record<string, unknown>): string {
  for (const key of ['playerName', 'sourceLabel', 'sourceName', 'name']) {
    const value = String(row[key] ?? '').trim()
    if (value) return value
  }
  return ''
}

function addWeightedClass(
  bucket: Map<string, Map<number, number>>,
  key: string,
  classId: number,
  weight: number
): void {
  if (!key || weight <= 0) return
  const counts = bucket.get(key) ?? new Map<number, number>()
  counts.set(classId, (counts.get(classId) ?? 0) + weight)
  bucket.set(key, counts)
}

function pickDominantClass(counts: Map<number, number> | undefined): number | null {
  if (!counts || !counts.size) return null
  let bestId: number | null = null
  let bestWeight = -1
  for (const [classId, weight] of counts) {
    if (weight > bestWeight) {
      bestWeight = weight
      bestId = classId
    }
  }
  return bestId
}

export function buildClassIdLookup(payload: Record<string, unknown>): ClassIdLookup {
  const bySource = new Map<string, Map<number, number>>()
  const byName = new Map<string, Map<number, number>>()
  // Runs on every combat tick: iterate each source array in place rather than
  // spreading them into two throwaway arrays (filter + concat) per call.
  const sourceArrays = [
    payload.displaySourceSkillRows,
    payload.displaySkillTotals,
    payload.skillTotals,
    payload.sourceSkillRows,
    payload.selfSkillTotals,
    payload.selfSourceSkillRows
  ]

  for (const source of sourceArrays) {
    if (!Array.isArray(source)) continue
    for (const raw of source) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const classId = rowClassId(row)
      if (!classId) continue
      const weight = Math.max(1, coerceInt(row.totalDamage, coerceInt(row.damage)))
      const sourceId = String(row.sourceId ?? '').trim()
      const label = rowLabel(row)
      addWeightedClass(bySource, sourceId, classId, weight)
      addWeightedClass(byName, label, classId, weight)
    }
  }

  const bySourceId = new Map<string, number>()
  const byPlayerName = new Map<string, number>()
  for (const [sourceId, counts] of bySource) {
    const picked = pickDominantClass(counts)
    if (picked) bySourceId.set(sourceId, picked)
  }
  for (const [name, counts] of byName) {
    const picked = pickDominantClass(counts)
    if (picked) byPlayerName.set(name, picked)
  }

  return { bySourceId, byPlayerName }
}

export function readRowClassId(row: Record<string, unknown>): number | null {
  return rowClassId(row)
}

export function resolveRowClassId(
  row: Record<string, unknown>,
  lookup: ClassIdLookup
): number | null {
  const direct = rowClassId(row)
  if (direct) return direct
  const sourceId = String(row.sourceId ?? '').trim()
  if (sourceId && lookup.bySourceId.has(sourceId)) {
    return lookup.bySourceId.get(sourceId) ?? null
  }
  const label = rowLabel(row)
  if (label && lookup.byPlayerName.has(label)) {
    return lookup.byPlayerName.get(label) ?? null
  }
  return null
}

export function classIconSrc(classId: number | null | undefined): string | null {
  if (!classId || classId <= 0) return null
  return ICON_BY_CLASS_ID.get(classId) ?? null
}

export function classDisplayName(classId: number | null | undefined): string | null {
  if (!classId || classId <= 0) return null
  return CLASS_NAMES[classId] ?? `Class ${classId}`
}

export function classBarColor(classId: number | null | undefined): string | null {
  if (!classId || classId <= 0) return null
  return CLASS_COLORS[classId] ?? null
}
