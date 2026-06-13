import { mergeSourceTotalRowsByPlayerIdentity } from '../../shared/merge-source-totals'
import { buildClassIdLookup, readRowClassId, resolveRowClassId } from './class-icons'
import { coerceFloat, coerceInt } from './coerce'
import { parseBuffStats, parseShieldStats } from './meter-display'
import { normalizeSkillIconName } from './skill-icons'

export const OVERLAY_ROW_COLORS = [
  '#737318',
  '#9b315d',
  '#2d6f9a',
  '#816218',
  '#5d4a8f',
  '#2d7f70',
  '#8b3f2e',
  '#4f7f2f',
  '#7a4387',
  '#944f24',
  '#3f667f',
  '#7b4b5b'
] as const

export type OverlayTab = 'dps' | 'skills' | 'self' | 'boss' | 'buffs' | 'shields'

export const OVERLAY_TABS: Array<{ id: OverlayTab; label: string }> = [
  { id: 'dps', label: 'DPS' },
  { id: 'skills', label: 'SKILL' },
  { id: 'self', label: 'SELF' },
  { id: 'boss', label: 'BOSS' },
  { id: 'buffs', label: 'BUFF' },
  { id: 'shields', label: 'SHIELD' }
]

export type SourceRow = {
  sourceId: string
  label: string
  gearScore?: number | null
  itemLevel?: number | null
  combatPower?: number | null
  classId: number | null
  skillIcon: string | null
  damage: number
  share: number
  dps: number
  hitCount: number
  critRate: number
  castCount: number | null
  hitRate: number | null
  backAttackRate: number | null
  headAttackRate: number | null
  frontAttackRate: number | null
}

export type PlayerSkillFilter = {
  sourceId: string
  label: string
  classId: number | null
  totalDamage: number
}

export type OverlayMeterState = {
  status: string
  encounterId: number
  totalDamage: number
  dps: number
  critRate: number
  elapsedSeconds: number
  hitCount: number
  unresolvedCount: number
  rows: SourceRow[]
  skillRows: SourceRow[]
  selfRows: SourceRow[]
  bossRows: SourceRow[]
  selfKnown: boolean
  selfWarning: string | null
  bossKnown: boolean
  bossName: string | null
  bossGateName: string | null
  bossDifficulty: string | null
  damageWarning: string | null
  error: string | null
}

function sourceIdText(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function isGenericSourceLabel(label: string, sourceId: string): boolean {
  const normalized = label.trim().toLowerCase()
  return normalized === sourceId.toLowerCase() || normalized === `source ${sourceId}`.toLowerCase() || !normalized
}

function playerNameLabel(row: Record<string, unknown>): string {
  const sourceId = sourceIdText(row.sourceId)
  for (const key of ['playerName', 'sourceName', 'characterName', 'actorName', 'entityName', 'name', 'displayName']) {
    const value = String(row[key] ?? '').trim()
    if (value && !isGenericSourceLabel(value, sourceId)) return value
  }
  const label = String(row.sourceLabel ?? '').trim()
  if (label && !isGenericSourceLabel(label, sourceId)) return label
  return sourceId ? `Source ${sourceId}` : 'Source ?'
}

function formatGearScore(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function sourceLabel(row: Record<string, unknown>): string {
  const name = playerNameLabel(row)
  // 战斗力 combatPower 优先显示;缺失时回退到 itemLevel 装等.
  const combatText = formatGearScore(coerceFloat(row.combatPower))
  if (combatText) return `${name} ${combatText}`
  const gearText = formatGearScore(coerceFloat(row.itemLevel ?? row.gearScore))
  return gearText ? `${name} ${gearText}` : name
}

function skillLabel(row: Record<string, unknown>): string {
  for (const key of ['skillDisplay', 'skillName', 'primaryEffectName', 'skillEffectDisplay', 'name', 'displayName']) {
    const value = String(row[key] ?? '').trim()
    if (value) return value
  }
  const skillId = sourceIdText(row.skillId)
  const effectId = sourceIdText(row.primaryEffectId ?? row.skillEffectId)
  if (skillId && skillId !== '0') return `Skill ${skillId}`
  if (effectId) return `Effect ${effectId}`
  return 'Unknown Skill'
}

function rawDictRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>
}

function rowDamage(row: Record<string, unknown>): number {
  for (const key of ['totalDamage', 'damage', 'bossDamage']) {
    const damage = coerceInt(row[key])
    if (damage > 0) return damage
  }
  return 0
}

export function parseSourceTotalRows(
  value: unknown,
  totalDamage: number,
  limit: number,
  classLookup?: ReturnType<typeof buildClassIdLookup>
): SourceRow[] {
  const rows: SourceRow[] = []
  for (const row of mergeSourceTotalRowsByPlayerIdentity(rawDictRows(value))) {
    const sourceId = sourceIdText(row.sourceId)
    if (!sourceId) continue
    const damage = rowDamage(row)
    if (damage <= 0) continue
    const share = totalDamage > 0 ? damage / totalDamage : coerceFloat(row.damageShare)
    const gearScore = coerceFloat(row.gearScore)
    const itemLevel = coerceFloat(row.itemLevel ?? row.gearScore)
    const combatPower = coerceFloat(row.combatPower)
    rows.push({
      sourceId,
      label: sourceLabel(row),
      gearScore: gearScore > 0 ? gearScore : null,
      itemLevel: itemLevel > 0 ? itemLevel : null,
      combatPower: combatPower > 0 ? combatPower : null,
      classId: classLookup ? resolveRowClassId(row, classLookup) : null,
      skillIcon: null,
      damage,
      share,
      dps: coerceFloat(row.dps),
      hitCount: coerceInt(row.hitCount),
      critRate: coerceFloat(row.critRate),
      castCount: null,
      hitRate: null,
      backAttackRate: null,
      headAttackRate: null,
      frontAttackRate: null
    })
  }
  return rows.sort((a, b) => b.damage - a.damage).slice(0, Math.max(1, limit))
}

function modifierRate(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  return value == null || value === '' ? null : coerceFloat(value)
}

function skillBelongsToPlayer(row: Record<string, unknown>, player: PlayerSkillFilter): boolean {
  const rowSourceId = sourceIdText(row.sourceId)
  if (rowSourceId && player.sourceId && rowSourceId === player.sourceId) return true
  const label = player.label.trim()
  if (!label) return false
  for (const key of ['playerName', 'sourceName', 'sourceLabel', 'characterName', 'name']) {
    if (String(row[key] ?? '').trim() === label) return true
  }
  return false
}

function buildSkillIconLookup(payload: Record<string, unknown>): Map<string, string> {
  const lookup = new Map<string, string>()
  const sources = [
    payload.displaySkillTotals,
    payload.skillTotals,
    payload.displaySourceSkillRows,
    payload.sourceSkillRows,
    payload.selfSkillTotals,
    payload.selfSourceSkillRows
  ]
  for (const source of sources) {
    for (const row of rawDictRows(source)) {
      const skillId = sourceIdText(row.skillId ?? row.primaryEffectId ?? row.skillEffectId)
      const icon = normalizeSkillIconName(row.skillIcon)
      if (skillId && icon) lookup.set(skillId, icon)
    }
  }
  return lookup
}

function resolveSkillIcon(
  row: Record<string, unknown>,
  lookup: Map<string, string>
): string | null {
  const direct = normalizeSkillIconName(row.skillIcon)
  if (direct) return direct
  const skillId = sourceIdText(row.skillId ?? row.primaryEffectId ?? row.skillEffectId)
  if (skillId && lookup.has(skillId)) return lookup.get(skillId) ?? null
  return null
}

function skillRowDisplayQuality(row: Record<string, unknown>): number {
  const display = String(row.skillDisplay ?? '').trim()
  let score = 0
  if (display.includes('(')) score += 4
  if (String(row.skillName ?? '').trim()) score += 2
  if (String(row.skillIcon ?? '').trim()) score += 1
  return score
}

function skillRowDedupKey(row: Record<string, unknown>): string {
  const skillId = sourceIdText(row.skillId ?? row.primaryEffectId ?? row.skillEffectId)
  if (skillId && skillId !== '0') return `skill:${skillId}`
  return `label:${skillLabel(row)}`
}

function collectPlayerSkillRows(
  payload: Record<string, unknown>,
  player: PlayerSkillFilter
): Array<Record<string, unknown>> {
  const perPlayerSources = [payload.displaySourceSkillRows, payload.sourceSkillRows]
  const perPlayerMatchedByKey = new Map<string, Record<string, unknown>>()
  for (const source of perPlayerSources) {
    for (const row of rawDictRows(source)) {
      if (!skillBelongsToPlayer(row, player)) continue
      const key = skillRowDedupKey(row)
      const existing = perPlayerMatchedByKey.get(key)
      if (!existing || skillRowDisplayQuality(row) > skillRowDisplayQuality(existing)) {
        perPlayerMatchedByKey.set(key, row)
      }
    }
  }
  if (perPlayerMatchedByKey.size > 0) {
    return [...perPlayerMatchedByKey.values()]
  }

  const fallbackSources = [
    payload.displaySkillTotals,
    payload.skillTotals,
    payload.selfSkillTotals,
    payload.selfSourceSkillRows
  ]
  const matchedByKey = new Map<string, Record<string, unknown>>()
  for (const source of fallbackSources) {
    for (const row of rawDictRows(source)) {
      if (!skillBelongsToPlayer(row, player)) continue
      const key = skillRowDedupKey(row)
      const existing = matchedByKey.get(key)
      if (!existing || skillRowDisplayQuality(row) > skillRowDisplayQuality(existing)) {
        matchedByKey.set(key, row)
      }
    }
  }
  return [...matchedByKey.values()]
}

export function parsePlayerSkillRows(
  payload: Record<string, unknown>,
  player: PlayerSkillFilter,
  limit = 32
): SourceRow[] {
  const matched = collectPlayerSkillRows(payload, player)
  const playerTotal =
    player.totalDamage > 0
      ? player.totalDamage
      : matched.reduce((sum, row) => sum + rowDamage(row), 0)
  return parseSkillTotalRows(matched, playerTotal, limit, buildSkillIconLookup(payload))
}

export function parseSkillTotalRows(
  value: unknown,
  totalDamage: number,
  limit: number,
  skillIconLookup?: Map<string, string>
): SourceRow[] {
  const rows: SourceRow[] = []
  for (const row of rawDictRows(value)) {
    const skillId = sourceIdText(row.skillId ?? row.primaryEffectId ?? row.skillEffectId)
    const damage = rowDamage(row)
    if (damage <= 0) continue
    const share = totalDamage > 0 ? damage / totalDamage : coerceFloat(row.damageShare)
    let castCount: number | null = null
    let hitRate: number | null = null
    if (row.castStatsAvailable === true) {
      const castValue = coerceInt(row.castCount)
      if (castValue > 0) {
        castCount = castValue
        hitRate = coerceFloat(row.hitRate)
      }
    }
    rows.push({
      sourceId: skillId || '?',
      label: skillLabel(row),
      classId: readRowClassId(row),
      skillIcon: skillIconLookup ? resolveSkillIcon(row, skillIconLookup) : normalizeSkillIconName(row.skillIcon),
      damage,
      share,
      dps: coerceFloat(row.dps),
      hitCount: coerceInt(row.hitCount),
      critRate: coerceFloat(row.critRate),
      castCount,
      hitRate,
      backAttackRate: modifierRate(row, 'backAttackRate'),
      headAttackRate: modifierRate(row, 'headAttackRate'),
      frontAttackRate: modifierRate(row, 'frontAttackRate')
    })
  }
  return rows.sort((a, b) => b.damage - a.damage).slice(0, Math.max(1, limit))
}

export function parseOverlayState(payload: Record<string, unknown>, limit = 8): OverlayMeterState {
  const summary =
    payload.summary && typeof payload.summary === 'object'
      ? (payload.summary as Record<string, unknown>)
      : {}
  const allDamageSummary =
    payload.allDamageSummary && typeof payload.allDamageSummary === 'object'
      ? (payload.allDamageSummary as Record<string, unknown>)
      : {}
  const selfSummary =
    payload.selfSummary && typeof payload.selfSummary === 'object'
      ? (payload.selfSummary as Record<string, unknown>)
      : {}

  const bossKnown = Boolean(summary.bossKnown)
  const displaySummary = bossKnown ? summary : allDamageSummary

  let totalDamage = coerceInt(displaySummary.totalDamage, coerceInt(payload.totalDamage))
  let dps = coerceFloat(displaySummary.dps, coerceFloat(payload.dps))
  const hitCount = coerceInt(displaySummary.hitCount, coerceInt(payload.hitCount))
  const critRate = coerceFloat(displaySummary.critRate, coerceFloat(payload.critRate))
  const elapsedSeconds = coerceFloat(payload.elapsedSeconds)
  const unresolvedCount = coerceInt(payload.unresolvedRowCount)
  const zoneSeedSource = String(payload.zoneSeedSource ?? '').trim()
  let damageWarning = String(payload.damageWarning ?? '').trim() || null
  const fallbackDamage = coerceInt(payload.fallbackDamage)
  const fallbackReliability = String(payload.fallbackDamageReliability ?? '').trim()

  if (totalDamage <= 0 && fallbackDamage > 0) totalDamage = fallbackDamage
  if (!damageWarning && fallbackReliability === 'primary_value_raw_fallback') {
    damageWarning = '后端返回了低可信度伤害数据'
  }
  if (!damageWarning && zoneSeedSource === 'default_constant' && unresolvedCount > 0) {
    damageWarning = '后端正在等待可信战斗数据'
  }

  const classLookup = buildClassIdLookup(payload)
  const sourceRows = payload.sourceTotals
  const displaySourceRows = payload.displaySourceTotals
  const dpsSourceRows =
    bossKnown && Array.isArray(displaySourceRows) ? displaySourceRows : sourceRows
  let rows = parseSourceTotalRows(dpsSourceRows, totalDamage, limit, classLookup)

  if (totalDamage <= 0) totalDamage = rows.reduce((sum, row) => sum + row.damage, 0)
  if (!rows.length && totalDamage > 0) {
    const sourceNames = payload.sourceNames
    let sourceId = ''
    let label = 'Unassigned Damage'
    if (sourceNames && typeof sourceNames === 'object') {
      const entries = Object.entries(sourceNames as Record<string, unknown>)
      if (entries.length) {
        sourceId = entries[0][0]
        label = String(entries[0][1] ?? '').trim() || label
      }
    }
    rows = [
      {
        sourceId: sourceId || '?',
        label,
        classId: classLookup.bySourceId.get(sourceId) ?? classLookup.byPlayerName.get(label) ?? null,
        skillIcon: null,
        damage: totalDamage,
        share: 1,
        dps,
        hitCount,
        critRate,
        castCount: null,
        hitRate: null,
        backAttackRate: null,
        headAttackRate: null,
        frontAttackRate: null
      }
    ]
  }
  if (totalDamage > 0) {
    for (const row of rows) {
      if (row.share <= 0) row.share = row.damage / totalDamage
    }
  }

  const skillIconLookup = buildSkillIconLookup(payload)
  const skillRows = parseSkillTotalRows(
    payload.displaySkillTotals ?? payload.skillTotals ?? payload.skills,
    totalDamage,
    limit,
    skillIconLookup
  )
  const bossTotalDamage = coerceInt(summary.totalDamage)
  const bossRows = parseSourceTotalRows(
    payload.displaySourceTotals ?? payload.bossSourceTotals,
    bossTotalDamage,
    limit,
    classLookup
  )

  const selfTotalDamage = coerceInt(selfSummary.totalDamage)
  let selfRows = parseSourceTotalRows(payload.selfRows, selfTotalDamage, limit, classLookup)
  if (!selfRows.length) {
    selfRows = parseSkillTotalRows(
      payload.selfSkillTotals ?? payload.selfSourceSkillRows,
      selfTotalDamage,
      limit,
      skillIconLookup
    )
  }
  if (!selfRows.length && selfTotalDamage > 0) {
    const selfName = String(selfSummary.localPlayerName ?? 'Self')
    selfRows = [
      {
        sourceId: 'self',
        label: selfName,
        classId: classLookup.byPlayerName.get(selfName) ?? null,
        skillIcon: null,
        damage: selfTotalDamage,
        share: 1,
        dps: coerceFloat(selfSummary.dps),
        hitCount: coerceInt(selfSummary.hitCount),
        critRate: coerceFloat(selfSummary.critRate),
        castCount: null,
        hitRate: null,
        backAttackRate: null,
        headAttackRate: null,
        frontAttackRate: null
      }
    ]
  }

  return {
    status: String(payload.status ?? 'unknown'),
    encounterId: coerceInt(payload.encounterId, 1),
    totalDamage,
    dps,
    critRate,
    elapsedSeconds,
    hitCount,
    unresolvedCount,
    rows,
    skillRows,
    selfRows,
    bossRows,
    selfKnown: Boolean(selfSummary.officialComparable),
    selfWarning: String(selfSummary.warning ?? '').trim() || null,
    bossKnown,
    bossName: String(summary.bossName ?? '').trim() || null,
    bossGateName: String(summary.bossGateName ?? '').trim() || null,
    bossDifficulty: String(summary.bossDifficulty ?? '').trim() || null,
    damageWarning,
    error: null
  }
}

export function rowsForTab(state: OverlayMeterState, tab: OverlayTab): SourceRow[] {
  if (tab === 'skills') return state.skillRows
  if (tab === 'self') return state.selfRows
  if (tab === 'boss') return state.bossKnown ? state.bossRows : []
  return state.rows
}

export type OverlayBuffColumn = {
  key: string
  label: string
  buffIds: string[]
}

export type OverlayBuffRow = {
  sourceId: string
  label: string
  classId: number | null
  cells: Array<number | null>
}

export type OverlayBuffTable = {
  columns: OverlayBuffColumn[]
  rows: OverlayBuffRow[]
}

function buffColumnLabel(name: string): string {
  return name.replace(/\s*\d+$/u, '') || name
}

export function parseOverlayBuffTable(
  payload: Record<string, unknown>,
  playerRows: SourceRow[],
  maxColumns = 4
): OverlayBuffTable | null {
  const stats = parseBuffStats(payload)
  if (!stats) return null

  // Prefer LOA Logs-style support effectiveness (caster row × party buff column).
  const supportCasters = stats.byCaster.filter(
    (caster) => Object.keys(caster.partyBuffedBy).length > 0
  )
  if (supportCasters.length) {
    const groups = new Map<string, OverlayBuffColumn & { totalDamage: number }>()
    for (const { buffId, damage } of stats.totals) {
      const entry = stats.catalog.get(buffId)
      if (!entry || entry.category !== 'buff') continue
      if (entry.target !== 'self_party' && entry.target !== 'party') continue
      const key = entry.uniqueGroup > 0 ? `g${entry.uniqueGroup}` : `b${buffId}`
      const existing = groups.get(key)
      if (existing) {
        existing.buffIds.push(buffId)
        existing.totalDamage += damage
      } else {
        groups.set(key, {
          key,
          label: buffColumnLabel(entry.name),
          buffIds: [buffId],
          totalDamage: damage
        })
      }
    }
    const columns = [...groups.values()]
      .sort((a, b) => b.totalDamage - a.totalDamage)
      .slice(0, Math.max(1, maxColumns))
      .map(({ key, label, buffIds }) => ({ key, label, buffIds }))
    if (columns.length) {
      const rows: OverlayBuffRow[] = supportCasters.slice(0, 8).map((caster) => {
        const denom =
          caster.partyBuffTotalDamage > 0 ? caster.partyBuffTotalDamage : stats.raidTotalDamage
        const cells = columns.map((column) => {
          if (denom <= 0) return null
          let damage = 0
          for (const buffId of column.buffIds) {
            damage += caster.partyBuffedBy[buffId] ?? 0
          }
          if (damage <= 0) return null
          return Math.min(damage / denom, 1)
        })
        return {
          sourceId: caster.casterSourceId,
          label: caster.casterName,
          classId: caster.classId,
          cells
        }
      })
      return { columns, rows }
    }
  }

  const groups = new Map<string, OverlayBuffColumn & { totalDamage: number }>()
  for (const { buffId, damage } of stats.totals) {
    const entry = stats.catalog.get(buffId)
    if (!entry || entry.category !== 'buff') continue
    if (entry.target !== 'self_party' && entry.target !== 'party') continue
    const key = entry.uniqueGroup > 0 ? `g${entry.uniqueGroup}` : `b${buffId}`
    const existing = groups.get(key)
    if (existing) {
      existing.buffIds.push(buffId)
      existing.totalDamage += damage
    } else {
      groups.set(key, {
        key,
        label: buffColumnLabel(entry.name),
        buffIds: [buffId],
        totalDamage: damage
      })
    }
  }
  const columns = [...groups.values()]
    .sort((a, b) => b.totalDamage - a.totalDamage)
    .slice(0, Math.max(1, maxColumns))
    .map(({ key, label, buffIds }) => ({ key, label, buffIds }))
  if (!columns.length) return null

  const rows: OverlayBuffRow[] = playerRows.map((player) => {
    const source = stats.bySource.get(player.sourceId)
    const cells = columns.map((column) => {
      if (!source || player.damage <= 0) return null
      let damage = 0
      for (const buffId of column.buffIds) {
        damage += source.buffedBy[buffId] ?? 0
      }
      if (damage <= 0) return null
      return Math.min(damage / player.damage, 1)
    })
    return {
      sourceId: player.sourceId,
      label: player.label,
      classId: player.classId,
      cells
    }
  })
  return { columns, rows }
}

export type OverlayShieldRow = {
  sourceId: string
  label: string
  classId: number | null
  shieldGiven: number
  shieldReceived: number
  effectiveShieldGiven: number
  effectiveShieldReceived: number
}

export function parseOverlayShieldRows(
  payload: Record<string, unknown>,
  playerRows: SourceRow[],
  limit = 12
): OverlayShieldRow[] {
  const shieldRows = parseShieldStats(payload)
  if (!shieldRows.length) return []
  const playerBySourceId = new Map(playerRows.map((row) => [row.sourceId, row]))
  return shieldRows
    .map((entry) => {
      const player = playerBySourceId.get(entry.sourceId)
      const label = entry.playerName ?? player?.label ?? ''
      return {
        sourceId: entry.sourceId,
        label,
        classId: entry.classId ?? player?.classId ?? null,
        shieldGiven: entry.shieldGiven,
        shieldReceived: entry.shieldReceived,
        effectiveShieldGiven: entry.effectiveShieldGiven,
        effectiveShieldReceived: entry.effectiveShieldReceived
      }
    })
    .filter((row) => row.label && !row.label.startsWith('Source '))
    .sort(
      (a, b) =>
        b.effectiveShieldGiven - a.effectiveShieldGiven ||
        b.shieldGiven - a.shieldGiven ||
        b.effectiveShieldReceived - a.effectiveShieldReceived
    )
    .slice(0, Math.max(1, limit))
}

export function stableColorSeed(text: string): number {
  let hash = 0
  for (const char of text) {
    hash = ((hash * 131) + char.charCodeAt(0)) >>> 0
  }
  return hash
}

export function overlayPaletteColor(row: SourceRow, fallbackIndex = 0): string {
  const key = row.sourceId.trim() || row.label.trim() || String(fallbackIndex)
  return OVERLAY_ROW_COLORS[stableColorSeed(key) % OVERLAY_ROW_COLORS.length]
}

export { formatDamage as shortDamage } from './format'

export type OverlayStatusTone =
  | 'offline'
  | 'online'
  | 'instance'
  | 'combat'
  | 'complete'
  | 'warning'

export type OverlayStatusIndicator = {
  tone: OverlayStatusTone
  label: string
}

export function resolveOverlayStatusIndicator(input: {
  status: string
  error: string | null
  totalDamage?: number
  encounterComplete?: boolean
}): OverlayStatusIndicator {
  if (input.error) {
    return { tone: 'offline', label: '服务器离线' }
  }

  const status = String(input.status ?? '').trim()
  if (status === 'encounter_complete' || input.encounterComplete) {
    return { tone: 'complete', label: '战斗已结束' }
  }
  if (status === 'ready' || (input.totalDamage ?? 0) > 0) {
    return { tone: 'combat', label: '战斗中 · DPS 统计中' }
  }
  if (status === 'waiting_for_boss' || status === 'waiting_for_damage') {
    return { tone: 'instance', label: '副本内 · 等待 DPS 生成' }
  }
  if (status === 'waiting_for_backend') {
    return { tone: 'warning', label: '在线 · 等待后端数据' }
  }
  if (status === 'waiting_for_packets') {
    return { tone: 'online', label: '在线 · 等待战斗' }
  }
  return { tone: 'online', label: '在线 · 等待战斗' }
}

export function compactDamageWarning(state: OverlayMeterState): string {
  const warning = String(state.damageWarning ?? '').trim()
  const status = String(state.status ?? '').trim()
  if (status === 'waiting_for_backend') {
    return '等待后端数据；进本前重启 meter'
  }
  if (status === 'waiting_for_boss' || warning.includes('Boss')) {
    return '等待 Boss 目标确认'
  }
  return warning || status || '等待伤害数据'
}

export function emptyTabMessage(state: OverlayMeterState, tab: OverlayTab): string {
  if (state.error) return 'meter server offline'
  if (tab === 'boss' && !state.bossKnown) return 'Boss unknown; DPS tab shows all targets'
  if (tab === 'self' && !state.selfKnown) return state.selfWarning ?? 'self source not resolved'
  if (tab === 'skills') return 'waiting for skill totals'
  if (tab === 'buffs') return '等待增益归因数据…'
  if (tab === 'shields') return '等待护盾数据…'
  if (state.damageWarning) return compactDamageWarning(state)
  if (state.unresolvedCount > 0) return `unresolved damage rows: ${state.unresolvedCount}`
  return 'waiting for damage'
}
