import { mergeSourceTotalRowsByPlayerIdentity } from '../../shared/merge-source-totals'
import { buildClassIdLookup, resolveRowClassId } from './class-icons'
import { coerceBool, coerceFloat, coerceInt } from './coerce'

export type SkillBreakdownRow = {
  name: string
  dps: number
  totalDamage: number
  stagger: number
  hitCount: number
  critRate: number
  sourceDamageShare: number
  damageShare: number
  skillId: string
  effectSummary: string
  castCount: number | null
  landedCastCount: number | null
  hitRate: number | null
  backAttackRate: number | null
  headAttackRate: number | null
  frontAttackRate: number | null
}

export type DisplayRow = {
  name: string
  dps: number
  totalDamage: number
  shieldDamage: number
  stagger: number
  critRate: number
  damageShare: number
  sourceId: string
  classId: number | null
  itemLevel: number | null
  combatPower: number | null
  reliability: string
  skillBreakdown: SkillBreakdownRow[]
}

export type PartyRosterRow = {
  name: string
  characterId: string
  source: string
  classId: number | null
  combatPower: number | null
  partyInstanceId: string
}

export type BuffCatalogEntry = {
  buffId: string
  name: string
  icon: string
  category: string
  subCategory: string
  target: string
  buffType: string
  uniqueGroup: number
  isSupportPartyBuff?: boolean
  isBossDebuff?: boolean
}

export type BuffSourceStats = {
  sourceId: string
  buffedBy: Record<string, number>
  buffedBySelf: Record<string, number>
  debuffedBy: Record<string, number>
  /** Debuff damage split by applier: effectId -> casterSourceId -> damage. */
  debuffedByCaster: Record<string, Record<string, number>>
}

export type BuffCasterStats = {
  casterSourceId: string
  casterName: string
  classId: number | null
  isSupport: boolean
  partyInstanceId: number | null
  partyGroupIndex: number | null
  partyBuffTotalDamage: number
  partyDebuffTotalDamage: number
  partyBuffedBy: Record<string, number>
  partyDebuffedBy: Record<string, number>
}

export type BuffPartyStats = {
  partyInstanceId: number
  partyGroupIndex: number | null
  totalDamage: number
  memberSourceIds: string[]
}

export type DefenseBreakApply = {
  sourceId: string
  count: number
}

export type BuffStatsView = {
  attributedRows: number
  catalog: Map<string, BuffCatalogEntry>
  totals: Array<{ buffId: string; damage: number }>
  bySource: Map<string, BuffSourceStats>
  byCaster: BuffCasterStats[]
  parties: BuffPartyStats[]
  defenseBreakApplies: DefenseBreakApply[]
  raidTotalDamage: number
}

export type ShieldSourceStats = {
  sourceId: string
  playerName?: string
  classId?: number | null
  partyInstanceId: number | null
  partyGroupIndex: number | null
  shieldGiven: number
  shieldReceived: number
  effectiveShieldGiven: number
  effectiveShieldReceived: number
  shieldGivenBy: Record<string, number>
  shieldReceivedBy: Record<string, number>
  effectiveShieldGivenBy: Record<string, number>
  effectiveShieldReceivedBy: Record<string, number>
}

export type ShieldCatalogEntry = {
  buffId: string
  name: string
  icon: string
  buffType: string
  uniqueGroup: number
}

export type ShieldPartyInfo = {
  partyInstanceId: number
  partyGroupIndex: number | null
  memberSourceIds: string[]
}

export type ShieldStatsView = {
  catalog: Map<string, ShieldCatalogEntry>
  parties: ShieldPartyInfo[]
  rows: ShieldSourceStats[]
}

function toRecordOfInt(value: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  if (!value || typeof value !== 'object') return result
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const amount = coerceInt(raw)
    if (amount > 0) result[key] = amount
  }
  return result
}

function toNestedRecordOfInt(value: unknown): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {}
  if (!value || typeof value !== 'object') return result
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const inner = toRecordOfInt(raw)
    if (Object.keys(inner).length) result[key] = inner
  }
  return result
}

export function parseBuffStats(payload: Record<string, unknown>): BuffStatsView | null {
  const raw = payload.buffStats
  if (!raw || typeof raw !== 'object') return null
  const stats = raw as Record<string, unknown>

  const catalog = new Map<string, BuffCatalogEntry>()
  const rawCatalog = stats.buffCatalog
  if (rawCatalog && typeof rawCatalog === 'object') {
    for (const [buffId, entry] of Object.entries(rawCatalog as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      catalog.set(buffId, {
        buffId,
        name: String(item.name ?? '').trim(),
        icon: String(item.icon ?? '').trim(),
        category: String(item.category ?? '').trim(),
        subCategory: String(item.subCategory ?? '').trim(),
        target: String(item.target ?? '').trim(),
        buffType: String(item.buffType ?? '').trim(),
        uniqueGroup: coerceInt(item.uniqueGroup),
        isSupportPartyBuff: Boolean(item.isSupportPartyBuff),
        isBossDebuff: Boolean(item.isBossDebuff)
      })
    }
  }

  const totals: Array<{ buffId: string; damage: number }> = []
  const rawTotals = stats.buffTotals
  if (rawTotals && typeof rawTotals === 'object') {
    for (const [buffId, damage] of Object.entries(rawTotals as Record<string, unknown>)) {
      const amount = coerceInt(damage)
      if (amount > 0) totals.push({ buffId, damage: amount })
    }
  }
  totals.sort((a, b) => b.damage - a.damage)

  const bySource = new Map<string, BuffSourceStats>()
  const rawBySource = stats.bySource
  if (Array.isArray(rawBySource)) {
    for (const entry of rawBySource) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const sourceId = String(item.sourceId ?? '').trim()
      if (!sourceId) continue
      bySource.set(sourceId, {
        sourceId,
        buffedBy: toRecordOfInt(item.buffedBy),
        buffedBySelf: toRecordOfInt(item.buffedBySelf),
        debuffedBy: toRecordOfInt(item.debuffedBy),
        debuffedByCaster: toNestedRecordOfInt(item.debuffedByCaster)
      })
    }
  }

  if (!catalog.size && !bySource.size) {
    const rawByCaster = stats.byCaster
    if (!Array.isArray(rawByCaster) || !rawByCaster.length) return null
  }

  const byCaster: BuffCasterStats[] = []
  const rawByCaster = stats.byCaster
  if (Array.isArray(rawByCaster)) {
    for (const entry of rawByCaster) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const casterSourceId = String(item.casterSourceId ?? '').trim()
      if (!casterSourceId) continue
      byCaster.push({
        casterSourceId,
        casterName: String(item.casterName ?? '').trim() || `Source ${casterSourceId}`,
        classId: coerceInt(item.classId) || null,
        isSupport: Boolean(item.isSupport),
        partyInstanceId: coerceInt(item.partyInstanceId) || null,
        partyGroupIndex: item.partyGroupIndex == null ? null : coerceInt(item.partyGroupIndex),
        partyBuffTotalDamage: coerceInt(item.partyBuffTotalDamage ?? item.partyTotalDamage),
        partyDebuffTotalDamage: coerceInt(item.partyDebuffTotalDamage ?? item.partyTotalDamage),
        partyBuffedBy: toRecordOfInt(item.partyBuffedBy),
        partyDebuffedBy: toRecordOfInt(item.partyDebuffedBy)
      })
    }
  }

  const parties: BuffPartyStats[] = []
  const rawParties = stats.parties
  if (Array.isArray(rawParties)) {
    for (const entry of rawParties) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const partyInstanceId = coerceInt(item.partyInstanceId)
      if (!partyInstanceId) continue
      parties.push({
        partyInstanceId,
        partyGroupIndex: item.partyGroupIndex == null ? null : coerceInt(item.partyGroupIndex),
        totalDamage: coerceInt(item.totalDamage),
        memberSourceIds: Array.isArray(item.memberSourceIds)
          ? item.memberSourceIds.map((id) => String(id))
          : []
      })
    }
  }

  const defenseBreakApplies: DefenseBreakApply[] = []
  const rawDefenseBreak = stats.defenseBreakApplies
  if (Array.isArray(rawDefenseBreak)) {
    for (const entry of rawDefenseBreak) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const sourceId = String(item.sourceId ?? '').trim()
      const count = coerceInt(item.count)
      if (!sourceId || count <= 0) continue
      defenseBreakApplies.push({ sourceId, count })
    }
  }

  if (!catalog.size && !bySource.size && !byCaster.length) return null
  return {
    attributedRows: coerceInt(stats.attributedRows),
    catalog,
    totals,
    bySource,
    byCaster,
    parties,
    defenseBreakApplies,
    raidTotalDamage: coerceInt(stats.raidTotalDamage)
  }
}

export function parseShieldStats(payload: Record<string, unknown>): ShieldSourceStats[] {
  return parseShieldStatsView(payload)?.rows ?? []
}

export function parseShieldStatsView(payload: Record<string, unknown>): ShieldStatsView | null {
  const raw = payload.shieldStats
  if (!raw || typeof raw !== 'object') return null
  const stats = raw as Record<string, unknown>

  const catalog = new Map<string, ShieldCatalogEntry>()
  const rawCatalog = stats.shieldCatalog
  if (rawCatalog && typeof rawCatalog === 'object') {
    for (const [buffId, entry] of Object.entries(rawCatalog as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      catalog.set(buffId, {
        buffId,
        name: String(item.name ?? '').trim(),
        icon: String(item.icon ?? '').trim(),
        buffType: String(item.buffType ?? '').trim(),
        uniqueGroup: coerceInt(item.uniqueGroup)
      })
    }
  }

  const parties: ShieldPartyInfo[] = []
  const rawParties = stats.parties
  if (Array.isArray(rawParties)) {
    for (const entry of rawParties) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const partyInstanceId = coerceInt(item.partyInstanceId)
      if (!partyInstanceId) continue
      parties.push({
        partyInstanceId,
        partyGroupIndex: item.partyGroupIndex == null ? null : coerceInt(item.partyGroupIndex),
        memberSourceIds: Array.isArray(item.memberSourceIds)
          ? item.memberSourceIds.map((id) => String(id))
          : []
      })
    }
  }

  const rows: ShieldSourceStats[] = []
  const rawRows = stats.bySource
  if (Array.isArray(rawRows)) {
    for (const entry of rawRows) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const sourceId = String(item.sourceId ?? '').trim()
      if (!sourceId) continue
      rows.push({
        sourceId,
        playerName: String(item.playerName ?? '').trim() || undefined,
        classId: item.classId == null ? null : coerceInt(item.classId) || null,
        partyInstanceId: item.partyInstanceId == null ? null : coerceInt(item.partyInstanceId),
        partyGroupIndex: item.partyGroupIndex == null ? null : coerceInt(item.partyGroupIndex),
        shieldGiven: coerceInt(item.shieldGiven),
        shieldReceived: coerceInt(item.shieldReceived),
        effectiveShieldGiven: coerceInt(item.effectiveShieldGiven),
        effectiveShieldReceived: coerceInt(item.effectiveShieldReceived),
        shieldGivenBy: toRecordOfInt(item.shieldGivenBy),
        shieldReceivedBy: toRecordOfInt(item.shieldReceivedBy),
        effectiveShieldGivenBy: toRecordOfInt(item.effectiveShieldGivenBy),
        effectiveShieldReceivedBy: toRecordOfInt(item.effectiveShieldReceivedBy)
      })
    }
  }
  if (!rows.length) return null
  return { catalog, parties, rows }
}

export type DisplayState = {
  status: string
  encounterId: number
  durationSeconds: number
  totalDamage: number
  shieldDamage: number
  dps: number
  hitCount: number
  critRate: number
  rows: DisplayRow[]
  bossOnly: boolean
  bossKnown: boolean
  bossName: string
  bossGateName: string | null
  bossRaidName: string | null
  bossDifficulty: string | null
  bossTargetIds: unknown[]
  warning: string | null
  error: string | null
  serverBuild: string | null
  partyRoster: PartyRosterRow[]
  historicalFromRecord: boolean
  historicalRecordName: string | null
  selfSummary: Record<string, unknown> | null
}

function formatGearScore(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function playerNameLabel(row: Record<string, unknown>): string {
  const sourceId = String(row.sourceId ?? '').trim()
  for (const key of ['sourceLabel', 'playerName', 'sourceName', 'characterName', 'name']) {
    const value = String(row[key] ?? '').trim()
    if (value && value.toLowerCase() !== sourceId.toLowerCase() && value.toLowerCase() !== `source ${sourceId}`.toLowerCase()) {
      return value
    }
  }
  return sourceId ? `Source ${sourceId}` : '未知来源'
}

function sourceLabel(row: Record<string, unknown>): string {
  const name = playerNameLabel(row)
  // 战斗力优先;缺失时回退到 itemLevel 装等.
  const combatText = formatGearScore(coerceFloat(row.combatPower))
  if (combatText) return `${name} ${combatText}`
  const gearText = formatGearScore(coerceFloat(row.itemLevel ?? row.gearScore))
  return gearText ? `${name} ${gearText}` : name
}

function skillLabel(row: Record<string, unknown>): string {
  for (const key of ['skillDisplay', 'skillName', 'primaryEffectName']) {
    const value = String(row[key] ?? '').trim()
    if (value) return value
  }
  const skillId = String(row.skillId ?? '').trim()
  if (skillId && skillId !== '0') return `Skill ${skillId}`
  const effectId = String(row.primaryEffectId ?? row.skillEffectId ?? '').trim()
  if (effectId) return `Effect ${effectId}`
  return '未知技能'
}

function effectSummary(row: Record<string, unknown>, limit = 2): string {
  const effects = row.effectBreakdown
  if (!Array.isArray(effects) || !effects.length) return ''
  const parts: string[] = []
  for (const effect of effects.slice(0, Math.max(1, limit))) {
    if (!effect || typeof effect !== 'object') continue
    const item = effect as Record<string, unknown>
    let name = String(item.skillEffectDisplay ?? item.skillEffectName ?? '').trim()
    if (!name) {
      const effectId = String(item.skillEffectId ?? '').trim()
      name = effectId ? `Effect ${effectId}` : 'Effect'
    }
    parts.push(`${name} ${coerceInt(item.totalDamage)}`)
  }
  if (effects.length > parts.length) {
    parts.push(`+${effects.length - parts.length}`)
  }
  return parts.join(' / ')
}

export function parseSkillBreakdownRows(
  value: unknown,
  sourceTotalDamage: number,
  encounterTotalDamage: number
): SkillBreakdownRow[] {
  if (!Array.isArray(value)) return []
  const rows: SkillBreakdownRow[] = []
  for (const rawRow of value) {
    if (!rawRow || typeof rawRow !== 'object') continue
    const row = rawRow as Record<string, unknown>
    const damage = coerceInt(row.totalDamage)
    if (damage <= 0) continue
    let castCount: number | null = null
    let landedCastCount: number | null = null
    let hitRate: number | null = null
    if (row.castStatsAvailable === true) {
      castCount = coerceInt(row.castCount)
      landedCastCount = coerceInt(row.landedCastCount)
      if (castCount <= 0) {
        castCount = null
        landedCastCount = null
      } else {
        hitRate = coerceFloat(row.hitRate)
      }
    }
    const modifierRate = (rateKey: string): number | null => {
      const value = row[rateKey]
      return value == null || value === '' ? null : coerceFloat(value)
    }
    rows.push({
      name: skillLabel(row),
      dps: coerceFloat(row.dps),
      totalDamage: damage,
      stagger: coerceInt(row.stagger),
      hitCount: coerceInt(row.hitCount),
      critRate: coerceFloat(row.critRate),
      sourceDamageShare: sourceTotalDamage > 0 ? damage / sourceTotalDamage : 0,
      damageShare: sourceTotalDamage > 0 ? damage / sourceTotalDamage : 0,
      skillId: String(row.skillId ?? '').trim(),
      effectSummary: effectSummary(row),
      castCount,
      landedCastCount,
      hitRate,
      backAttackRate: modifierRate('backAttackRate'),
      headAttackRate: modifierRate('headAttackRate'),
      frontAttackRate: modifierRate('frontAttackRate')
    })
  }
  return rows.sort((a, b) => b.totalDamage - a.totalDamage)
}

export function parseMeterPayload(
  payload: Record<string, unknown>,
  options: { limit?: number; bossOnly?: boolean } = {}
): DisplayState {
  const limit = options.limit ?? 12
  const bossOnly = options.bossOnly ?? true

  const summary =
    payload.summary && typeof payload.summary === 'object'
      ? (payload.summary as Record<string, unknown>)
      : {}
  const allSummary =
    payload.allDamageSummary && typeof payload.allDamageSummary === 'object'
      ? (payload.allDamageSummary as Record<string, unknown>)
      : {}
  const displayContract =
    payload.display && typeof payload.display === 'object'
      ? (payload.display as Record<string, unknown>)
      : {}
  const bossCandidate =
    payload.bossNpcCandidate && typeof payload.bossNpcCandidate === 'object'
      ? (payload.bossNpcCandidate as Record<string, unknown>)
      : {}

  let rawRows: unknown[] = []
  let totalDamage = 0
  let shieldDamage = 0
  let dps = 0
  let hitCount = 0
  let critRate = 0
  let bossKnown = false
  let bossName = ''
  let bossGateName: string | null = null
  let bossRaidName: string | null = null
  let bossDifficulty: string | null = null
  let warning: string | null = null

  if (bossOnly) {
    rawRows = Array.isArray(payload.uiRows) ? payload.uiRows : []
    totalDamage = coerceInt(summary.totalDamage, coerceInt(displayContract.totalDamage))
    shieldDamage = coerceInt(summary.shieldDamage, coerceInt(displayContract.shieldDamage))
    dps = coerceFloat(summary.dps, coerceFloat(displayContract.dps))
    hitCount = coerceInt(summary.hitCount, coerceInt(displayContract.hitCount))
    critRate = coerceFloat(summary.critRate)
    bossKnown = coerceBool(summary.bossKnown, coerceBool(displayContract.bossKnown))
    bossName = String(summary.bossName ?? displayContract.bossName ?? '').trim()
    bossGateName = String(summary.bossGateName ?? displayContract.bossGateName ?? '').trim() || null
    bossRaidName = String(summary.bossRaidName ?? displayContract.bossRaidName ?? '').trim() || null
    bossDifficulty = String(summary.bossDifficulty ?? displayContract.bossDifficulty ?? '').trim() || null
    warning =
      String(summary.warning ?? payload.damageWarning ?? '')
        .trim() || null

    const displaySourceTotals = payload.displaySourceTotals
    if (bossKnown && Array.isArray(displaySourceTotals)) {
      rawRows = displaySourceTotals
    }
    if (!bossKnown) {
      const candidateName = String(bossCandidate.npcName ?? '').trim()
      if (candidateName && !bossName) bossName = candidateName
      rawRows = Array.isArray(payload.sourceTotals) ? payload.sourceTotals : []
      totalDamage = coerceInt(allSummary.totalDamage, coerceInt(payload.totalDamage))
      shieldDamage = coerceInt(allSummary.shieldDamage, coerceInt(payload.shieldDamage))
      dps = coerceFloat(allSummary.dps, coerceFloat(payload.dps))
      hitCount = coerceInt(allSummary.hitCount, coerceInt(payload.hitCount))
      critRate = coerceFloat(allSummary.critRate, coerceFloat(payload.critRate))
      warning =
        candidateName
          ? `${candidateName} 目标未确认，暂按全部目标显示`
          : 'Boss 未识别，暂按全部目标显示'
    }
  } else {
    rawRows = Array.isArray(payload.sourceTotals) ? payload.sourceTotals : []
    totalDamage = coerceInt(payload.totalDamage, coerceInt(displayContract.totalDamage))
    shieldDamage = coerceInt(payload.shieldDamage, coerceInt(displayContract.shieldDamage))
    dps = coerceFloat(payload.dps, coerceFloat(displayContract.dps))
    hitCount = coerceInt(payload.hitCount, coerceInt(displayContract.hitCount))
    critRate = coerceFloat(payload.critRate)
    bossKnown = false
    bossName = '全部目标'
    warning = String(payload.damageWarning ?? '').trim() || null
  }

  const uiRowSkillBreakdownBySourceId = new Map<string, unknown>()
  if (Array.isArray(payload.uiRows)) {
    for (const item of payload.uiRows) {
      if (!item || typeof item !== 'object') continue
      const uiRow = item as Record<string, unknown>
      const sourceId = String(uiRow.sourceId ?? '').trim()
      if (!sourceId || !Array.isArray(uiRow.skillBreakdown) || !uiRow.skillBreakdown.length) continue
      uiRowSkillBreakdownBySourceId.set(sourceId, uiRow.skillBreakdown)
    }
  }

  const classLookup = buildClassIdLookup(payload)
  const mergedRawRows = mergeSourceTotalRowsByPlayerIdentity(
    rawRows.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  )
  const rows: DisplayRow[] = []
  for (const rawRow of mergedRawRows) {
    if (!rawRow || typeof rawRow !== 'object') continue
    const row = rawRow as Record<string, unknown>
    const damage = coerceInt(row.totalDamage)
    if (damage <= 0) continue
    const sourceId = String(row.sourceId ?? '')
    const skillBreakdownSource =
      row.skillBreakdown ??
      (sourceId ? uiRowSkillBreakdownBySourceId.get(sourceId) : undefined)
    rows.push({
      name: sourceLabel(row),
      dps: coerceFloat(row.dps),
      totalDamage: damage,
      shieldDamage: coerceInt(row.shieldDamage),
      stagger: coerceInt(row.stagger),
      critRate: coerceFloat(row.critRate),
      damageShare: coerceFloat(row.damageShare),
      sourceId,
      classId: resolveRowClassId(row, classLookup),
      itemLevel: coerceFloat(row.itemLevel ?? row.gearScore) > 0 ? coerceFloat(row.itemLevel ?? row.gearScore) : null,
      combatPower: coerceFloat(row.combatPower) > 0 ? coerceFloat(row.combatPower) : null,
      reliability: String(row.reliability ?? row.damageReliability ?? 'ok'),
      skillBreakdown: parseSkillBreakdownRows(skillBreakdownSource, damage, totalDamage)
    })
  }

  rows.sort((a, b) => b.totalDamage - a.totalDamage)
  const limitedRows = rows.slice(0, Math.max(1, limit))
  if (totalDamage <= 0 && limitedRows.length) {
    totalDamage = limitedRows.reduce((sum, row) => sum + row.totalDamage, 0)
  }
  if (totalDamage > 0) {
    for (const row of limitedRows) {
      if (row.damageShare <= 0) row.damageShare = row.totalDamage / totalDamage
      for (const skill of row.skillBreakdown) {
        if (skill.damageShare <= 0 && row.totalDamage > 0) {
          skill.damageShare = skill.totalDamage / row.totalDamage
        }
      }
    }
  }

  const partyRoster: PartyRosterRow[] = []
  const partyEntries = Array.isArray(payload.partyRoster) ? payload.partyRoster : []
  for (const entry of partyEntries) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const name = String(item.name ?? '').trim()
    if (!name) continue
    const rosterClassId = coerceInt(item.classId)
    const rosterCombatPower = coerceFloat(item.combatPower)
    partyRoster.push({
      name,
      characterId: String(item.characterId ?? item.characterIdDec ?? '').trim(),
      source: String(item.source ?? '').trim(),
      classId: rosterClassId > 0 ? rosterClassId : classLookup.byPlayerName.get(name) ?? null,
      combatPower: rosterCombatPower > 0 ? rosterCombatPower : null,
      partyInstanceId: String(item.partyInstanceId ?? '').trim()
    })
  }

  const durationMs = coerceInt(summary.durationMs)
  const durationSeconds = durationMs > 0 ? durationMs / 1000 : coerceFloat(payload.elapsedSeconds)

  const selfSummary =
    payload.selfSummary && typeof payload.selfSummary === 'object'
      ? (payload.selfSummary as Record<string, unknown>)
      : null

  return {
    status: String(payload.status ?? 'unknown'),
    encounterId: coerceInt(payload.encounterId, 1),
    durationSeconds,
    totalDamage,
    shieldDamage,
    dps,
    hitCount,
    critRate,
    rows: limitedRows,
    bossOnly,
    bossKnown,
    bossName,
    bossGateName,
    bossRaidName,
    bossDifficulty,
    bossTargetIds: Array.isArray(summary.bossTargetIds) ? summary.bossTargetIds : [],
    warning,
    error: null,
    serverBuild: String(payload.serverBuild ?? '').trim() || null,
    partyRoster,
    historicalFromRecord: false,
    historicalRecordName: null,
    selfSummary
  }
}

export function stateFromLogDocument(document: Record<string, unknown>): Record<string, unknown> {
  const finalState = document.finalState
  if (finalState && typeof finalState === 'object' && Object.keys(finalState).length > 0) {
    return finalState as Record<string, unknown>
  }
  const snapshots = document.snapshots
  if (Array.isArray(snapshots)) {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index]
      if (snapshot && typeof snapshot === 'object') {
        return snapshot as Record<string, unknown>
      }
    }
  }
  return {}
}

export function parseHistoricalPayload(
  document: Record<string, unknown>,
  options: { limit?: number } = {}
): DisplayState {
  const state = stateFromLogDocument(document)
  const displayContract =
    state.display && typeof state.display === 'object'
      ? (state.display as Record<string, unknown>)
      : {}
  const bossOnly = coerceBool(displayContract.bossOnly, coerceBool(document.bossOnly, true))
  const display = parseMeterPayload(state, { limit: options.limit, bossOnly })
  return {
    ...display,
    historicalFromRecord: true,
    historicalRecordName: String(document.startedAt ?? '历史记录')
  }
}

export function bossTitleText(display: DisplayState): string {
  if (!display.bossOnly) return '全部目标'
  if (display.bossKnown && display.bossName) return display.bossName
  if (display.bossName) return `${display.bossName}（未确认）`
  return 'Boss 未识别'
}

/** 副本名称 + 关卡, e.g. "终幕：终结之日 第一关". */
export function raidTitleText(display: DisplayState): string | null {
  if (!display.bossRaidName) return null
  return display.bossGateName
    ? `${display.bossRaidName} ${display.bossGateName}`
    : display.bossRaidName
}
