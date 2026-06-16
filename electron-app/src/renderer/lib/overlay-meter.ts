import { mergeSourceTotalRowsByPlayerIdentity } from '../../shared/merge-source-totals'
import { buildClassIdLookup, readRowClassId, resolveRowClassId } from './class-icons'
import { coerceFloat, coerceInt } from './coerce'
import {
  parseBuffStats,
  parseShieldStatsView,
  type BuffCatalogEntry,
  type BuffCasterStats,
  type ShieldSourceStats
} from './meter-display'
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

// 'self' / 'boss' remain in the union (parseOverlayState still builds those
// rows and rowsForTab handles them) but are no longer surfaced as overlay tabs.
export type OverlayTab = 'dps' | 'skills' | 'self' | 'boss' | 'buffs' | 'debuff' | 'shields'

export const OVERLAY_TABS: Array<{ id: OverlayTab; label: string }> = [
  { id: 'dps', label: 'DPS' },
  { id: 'skills', label: 'SKILL' },
  { id: 'buffs', label: 'BUFF' },
  { id: 'debuff', label: 'DEBUFF' },
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
  /** Esther (埃斯德) 盟友召唤实体: 不归属玩家, 仅出现在 DPS 页. */
  isEsther: boolean
  estherIcon: string | null
  damage: number
  /** Boss 护盾伤害 (record+0x60), 已包含在 damage 内, 单列拆分用. */
  shieldDamage: number
  /** 实际瘫痪值 (record+0x3c), 独立于伤害. */
  stagger: number
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
  /** Boss 护盾伤害合计 (record+0x60), 已包含在 totalDamage 内. */
  shieldDamage: number
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
  bossRaidName: string | null
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
  // 战斗力 (combatPower, 0x15F4) 优先显示;缺失时回退到 itemLevel 装等.
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
      isEsther: row.isEsther === true,
      estherIcon: normalizeSkillIconName(String(row.estherIcon ?? '')) || null,
      damage,
      shieldDamage: coerceInt(row.shieldDamage),
      stagger: coerceInt(row.stagger),
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
      isEsther: false,
      estherIcon: null,
      damage,
      shieldDamage: coerceInt(row.shieldDamage),
      stagger: coerceInt(row.stagger),
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
  const shieldDamage = coerceInt(displaySummary.shieldDamage, coerceInt(payload.shieldDamage))
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
    damageWarning = 'showing fallback damage because real zone seed is missing'
  }
  if (!damageWarning && zoneSeedSource === 'default_constant' && unresolvedCount > 0) {
    damageWarning = 'missing real zone seed; D132 rows are suppressed'
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
        isEsther: false,
        estherIcon: null,
        damage: totalDamage,
        shieldDamage,
        stagger: 0,
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

  // NOTE: the 'self' and 'boss' tabs were retired from OVERLAY_TABS and are
  // unreachable from the UI (see rowsForTab / setTab). Parsing per-source self
  // and boss row sets on every combat tick was therefore pure waste — including
  // a second full parse of displaySourceTotals already covered by `rows`. We
  // keep the fields on the state shape (empty) so the type contract and
  // rowsForTab fallback stay intact without the per-tick cost.

  return {
    status: String(payload.status ?? 'unknown'),
    encounterId: coerceInt(payload.encounterId, 1),
    totalDamage,
    shieldDamage,
    dps,
    critRate,
    elapsedSeconds,
    hitCount,
    unresolvedCount,
    rows,
    skillRows,
    selfRows: [],
    bossRows: [],
    selfKnown: Boolean(selfSummary.officialComparable),
    selfWarning: String(selfSummary.warning ?? '').trim() || null,
    bossKnown,
    bossName: String(summary.bossName ?? '').trim() || null,
    bossGateName: String(summary.bossGateName ?? '').trim() || null,
    bossRaidName: String(summary.bossRaidName ?? '').trim() || null,
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

// ---------------------------------------------------------------------------
// LOA Logs-style PARTY BUFF tab: party-grouped tables where columns are the
// party-wide synergies grouped under the support (caster) that provides them,
// and cells are "% of this player's damage dealt while the buff was active".
// ---------------------------------------------------------------------------

export type OverlayPartyBuffColumn = {
  key: string
  label: string
  icon: string | null
  buffIds: string[]
  /** Debuff columns: caster names for hover tooltip (not shown in the grid). */
  providers?: string[]
  /** Full hover text; defaults to ``label`` when omitted. */
  tooltip?: string
  /**
   * Per-applier debuff columns: the casterSourceId this column is scoped to.
   * When set, cells read ``debuffedByCaster[effectId][casterId]`` instead of the
   * merged ``debuffedBy``.
   */
  casterId?: string
}

export type OverlayPartyBuffGroup = {
  key: string
  label: string | null
  classId: number | null
  columns: OverlayPartyBuffColumn[]
}

export type OverlayPartyBuffRow = {
  sourceId: string
  label: string
  classId: number | null
  damage: number
  share: number
  cells: Array<number | null>
}

export type OverlayPartyBuffParty = {
  key: string
  label: string | null
  groups: OverlayPartyBuffGroup[]
  columns: OverlayPartyBuffColumn[]
  rows: OverlayPartyBuffRow[]
}

export type OverlayPartyBuffTable = {
  parties: OverlayPartyBuffParty[]
}

function buffColumnLabel(name: string): string {
  return name.replace(/\s*\d+$/u, '') || name
}

// Overlay BUFF 列显示优先级：列在此数组中的图标按顺序优先排在最前，
// 其余图标按既有的伤害量降序排列。
const BUFF_ICON_PRIORITY: readonly string[] = [
  'buff_837.png',
  'buff_838.png',
  'buff_67.png',
  'buff_839.png',
  'bd_skill_01_31.png',
  'buff_20.png',
  'bd_skill_01_12.png',
  'ark_passive_evolution_19.png',
  'ark_passive_evolution_33.png',
  'buff_5.png'
]

function buffIconPriority(icon: string | null | undefined): number {
  if (!icon) return Number.MAX_SAFE_INTEGER
  const idx = BUFF_ICON_PRIORITY.indexOf(icon)
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
}

type PartyEffectCatalogEntry = {
  name: string
  icon: string
  category: string
  target: string
  uniqueGroup: number
  isBossDebuff?: boolean
}

function isPartyTargetBuff(entry: PartyEffectCatalogEntry | undefined): boolean {
  if (!entry || entry.category !== 'buff') return false
  return entry.target === 'self_party' || entry.target === 'party'
}

function isPartyDisplayDebuff(entry: PartyEffectCatalogEntry | undefined): boolean {
  if (!entry || entry.category !== 'debuff') return false
  if (entry.isBossDebuff) return true
  if (entry.target === 'self_party' || entry.target === 'party') return true
  return entry.target === 'enemy' || entry.target === 'self_enemy' || entry.target === 'none' || !entry.target
}

type PartyBuffColumnDraft = OverlayPartyBuffColumn & { totalDamage: number }

function buildPartyEffectColumns(
  buffIds: Iterable<string>,
  catalog: Map<string, PartyEffectCatalogEntry>,
  receivedDamageByBuff: Map<string, number>,
  maxColumns: number,
  isRelevant: (entry: PartyEffectCatalogEntry | undefined) => boolean
): OverlayPartyBuffColumn[] {
  const groups = new Map<string, PartyBuffColumnDraft>()
  for (const buffId of buffIds) {
    const entry = catalog.get(buffId)
    if (!isRelevant(entry)) continue
    const received = receivedDamageByBuff.get(buffId) ?? 0
    if (received <= 0) continue
    const info = entry!
    const key =
      info.uniqueGroup > 0 ? `g${info.uniqueGroup}` : `n${buffColumnLabel(info.name)}|${info.icon}`
    const existing = groups.get(key)
    if (existing) {
      if (!existing.buffIds.includes(buffId)) existing.buffIds.push(buffId)
      existing.totalDamage += received
      if (!existing.icon && info.icon) existing.icon = info.icon
    } else {
      groups.set(key, {
        key,
        label: buffColumnLabel(info.name),
        icon: info.icon || null,
        buffIds: [buffId],
        totalDamage: received
      })
    }
  }
  return [...groups.values()]
    .sort((a, b) => {
      const pa = buffIconPriority(a.icon)
      const pb = buffIconPriority(b.icon)
      if (pa !== pb) return pa - pb
      return b.totalDamage - a.totalDamage
    })
    .slice(0, Math.max(1, maxColumns))
    .map(({ key, label, icon, buffIds: ids }) => ({ key, label, icon, buffIds: ids }))
}

function resolveEffectProviders(
  column: OverlayPartyBuffColumn,
  casters: BuffCasterStats[],
  bucket: { partyInstanceId: number | null; members: SourceRow[] },
  casterField: 'partyBuffedBy' | 'partyDebuffedBy'
): string[] {
  const memberIds = new Set(bucket.members.map((row) => row.sourceId))
  const ranked: Array<{ name: string; damage: number }> = []

  for (const caster of casters) {
    const inParty =
      bucket.partyInstanceId == null ||
      caster.partyInstanceId === bucket.partyInstanceId ||
      memberIds.has(caster.casterSourceId)
    if (!inParty) continue

    const casterMap = caster[casterField]
    let damage = 0
    for (const effectId of column.buffIds) {
      damage += casterMap[effectId] ?? 0
    }
    if (damage <= 0) continue
    const name = caster.casterName.trim() || `Source ${caster.casterSourceId}`
    ranked.push({ name, damage })
  }

  ranked.sort((a, b) => b.damage - a.damage)
  const seen = new Set<string>()
  const providers: string[] = []
  for (const entry of ranked) {
    if (seen.has(entry.name)) continue
    seen.add(entry.name)
    providers.push(entry.name)
  }
  return providers
}

function formatEffectColumnTooltip(label: string, providers: string[]): string {
  if (!providers.length) return label
  return `${label}\n提供者：${providers.join('、')}`
}

type PartyEffectTableOptions = {
  damageField: 'buffedBy' | 'debuffedBy'
  isRelevant: (entry: PartyEffectCatalogEntry | undefined) => boolean
  maxColumnsPerParty?: number
  /** When set, column tooltips include the support/DPS player who applied the effect. */
  casterField?: 'partyBuffedBy' | 'partyDebuffedBy'
}

function parseOverlayPartyEffectTable(
  payload: Record<string, unknown>,
  playerRows: SourceRow[],
  options: PartyEffectTableOptions
): OverlayPartyBuffTable | null {
  const { damageField, isRelevant, maxColumnsPerParty = 40, casterField } = options
  const stats = parseBuffStats(payload)
  if (!stats) return null
  // Esthers (埃斯德) are allied summons, not players: never list them in the
  // BUFF/DEBUFF matrices (DPS tab only).
  playerRows = playerRows.filter((row) => !row.isEsther)
  const playerBySourceId = new Map(playerRows.map((row) => [row.sourceId, row]))

  // Party buckets: prefer backend party assignment, fallback to single table.
  type Bucket = { key: string; partyInstanceId: number | null; members: SourceRow[] }
  const buckets: Bucket[] = []
  const assigned = new Set<string>()
  const orderedParties = [...stats.parties].sort(
    (a, b) =>
      (a.partyGroupIndex ?? 99) - (b.partyGroupIndex ?? 99) ||
      a.partyInstanceId - b.partyInstanceId
  )
  for (const party of orderedParties) {
    const members = party.memberSourceIds
      .map((sourceId) => playerBySourceId.get(sourceId))
      .filter((row): row is SourceRow => Boolean(row))
    if (!members.length) continue
    for (const member of members) assigned.add(member.sourceId)
    buckets.push({ key: `p${party.partyInstanceId}`, partyInstanceId: party.partyInstanceId, members })
  }
  const leftovers = playerRows.filter((row) => !assigned.has(row.sourceId) && row.damage > 0)
  if (!buckets.length) {
    if (!leftovers.length) return null
    buckets.push({ key: 'all', partyInstanceId: null, members: leftovers })
  } else if (leftovers.length) {
    buckets.push({ key: 'rest', partyInstanceId: null, members: leftovers })
  }

  const topDamage = Math.max(...playerRows.map((row) => row.damage), 0)
  const singleParty = buckets.length <= 1

  const parties: OverlayPartyBuffParty[] = []
  for (const bucket of buckets) {
    const receivedDamageByEffect = new Map<string, number>()
    for (const member of bucket.members) {
      const source = stats.bySource.get(member.sourceId)
      if (!source) continue
      for (const [effectId, damage] of Object.entries(source[damageField])) {
        receivedDamageByEffect.set(effectId, (receivedDamageByEffect.get(effectId) ?? 0) + damage)
      }
    }

    const flatColumns = buildPartyEffectColumns(
      receivedDamageByEffect.keys(),
      stats.catalog,
      receivedDamageByEffect,
      maxColumnsPerParty,
      isRelevant
    )
    if (!flatColumns.length) continue
    if (casterField) {
      for (const column of flatColumns) {
        const providers = resolveEffectProviders(column, stats.byCaster, bucket, casterField)
        column.providers = providers
        column.tooltip = formatEffectColumnTooltip(column.label, providers)
      }
    }
    const groups: OverlayPartyBuffGroup[] = []

    const rows: OverlayPartyBuffRow[] = bucket.members
      .map((member) => {
        const source = stats.bySource.get(member.sourceId)
        const cells = flatColumns.map((column) => {
          if (!source || member.damage <= 0) return null
          let damage = 0
          for (const effectId of column.buffIds) {
            damage += source[damageField][effectId] ?? 0
          }
          if (damage <= 0) return null
          return Math.min(damage / member.damage, 1)
        })
        return {
          sourceId: member.sourceId,
          label: member.label,
          classId: member.classId,
          damage: member.damage,
          share: topDamage > 0 ? Math.min(member.damage / topDamage, 1) : 0,
          cells
        }
      })
      .sort((a, b) => b.damage - a.damage)

    parties.push({
      key: bucket.key,
      label: singleParty ? null : `小队 ${parties.length + 1}`,
      groups,
      columns: flatColumns,
      rows
    })
  }

  return parties.length ? { parties } : null
}

export function parseOverlayPartyBuffTable(
  payload: Record<string, unknown>,
  playerRows: SourceRow[],
  maxColumnsPerGroup = 3,
  // Overlay BUFF tab shows only the top 8 buff icons (left→right by icon
  // priority then damage); the layout stretches those 8 across the row width.
  maxColumnsPerParty = 8
): OverlayPartyBuffTable | null {
  void maxColumnsPerGroup
  return parseOverlayPartyEffectTable(payload, playerRows, {
    damageField: 'buffedBy',
    isRelevant: isPartyTargetBuff,
    maxColumnsPerParty
  })
}

// 破坏防御 battle items (32240 20s / 32246 25s): counted separately and kept as
// a merged effectiveness column with the current logic.
function isDefenseBreakItem(entry: BuffCatalogEntry | undefined): boolean {
  if (!entry) return false
  if (entry.buffId === '32240' || entry.buffId === '32246') return true
  return entry.name === '破坏防御' && entry.subCategory === 'battleitem'
}

// Debuffs the overlay no longer shows: 烧伤 / 电击 / 受虐(症) / 以太生成.
const HIDDEN_DEBUFF_NAME = /烧伤|电击|受虐|以太生成/u
function isHiddenDebuff(entry: BuffCatalogEntry | undefined): boolean {
  if (!entry) return false
  if (entry.buffType === 'burn') return true
  return HIDDEN_DEBUFF_NAME.test(entry.name)
}

/**
 * DEBUFF tab, reworked to mirror the BUFF tab:
 * - 破坏防御 (battle item) keeps the current merged effectiveness column.
 * - Every other debuff is split per applier (one column per debuff x caster),
 *   and only debuffs applied by *this party's* members are shown/counted;
 *   the applier shows up on hover.
 * - 烧伤 / 电击 / 受虐 / 以太生成 are filtered out entirely.
 */
export function parseOverlayPartyDebuffTable(
  payload: Record<string, unknown>,
  playerRows: SourceRow[],
  maxColumnsPerParty = 40
): OverlayPartyBuffTable | null {
  const stats = parseBuffStats(payload)
  if (!stats) return null
  // Esthers (埃斯德) are allied summons, not players: DPS tab only.
  playerRows = playerRows.filter((row) => !row.isEsther)
  const playerBySourceId = new Map(playerRows.map((row) => [row.sourceId, row]))
  const casterById = new Map(
    stats.byCaster.map((caster) => [caster.casterSourceId, caster])
  )
  const casterName = (casterId: string): string =>
    casterById.get(casterId)?.casterName ||
    playerBySourceId.get(casterId)?.label ||
    `Source ${casterId}`

  // Party buckets: prefer backend party assignment, fallback to single table.
  type Bucket = { key: string; members: SourceRow[] }
  const buckets: Bucket[] = []
  const assigned = new Set<string>()
  const orderedParties = [...stats.parties].sort(
    (a, b) =>
      (a.partyGroupIndex ?? 99) - (b.partyGroupIndex ?? 99) ||
      a.partyInstanceId - b.partyInstanceId
  )
  for (const party of orderedParties) {
    const members = party.memberSourceIds
      .map((sourceId) => playerBySourceId.get(sourceId))
      .filter((row): row is SourceRow => Boolean(row))
    if (!members.length) continue
    for (const member of members) assigned.add(member.sourceId)
    buckets.push({ key: `p${party.partyInstanceId}`, members })
  }
  const leftovers = playerRows.filter((row) => !assigned.has(row.sourceId) && row.damage > 0)
  if (!buckets.length) {
    if (!leftovers.length) return null
    buckets.push({ key: 'all', members: leftovers })
  } else if (leftovers.length) {
    buckets.push({ key: 'rest', members: leftovers })
  }

  const topDamage = Math.max(...playerRows.map((row) => row.damage), 0)
  const singleParty = buckets.length <= 1

  const parties: OverlayPartyBuffParty[] = []
  for (const bucket of buckets) {
    const memberIds = new Set(bucket.members.map((member) => member.sourceId))

    // 1) 破坏防御: merged effectiveness column(s) via the existing logic.
    const defReceived = new Map<string, number>()
    for (const member of bucket.members) {
      const source = stats.bySource.get(member.sourceId)
      if (!source) continue
      for (const [effectId, damage] of Object.entries(source.debuffedBy)) {
        if (!isDefenseBreakItem(stats.catalog.get(effectId))) continue
        defReceived.set(effectId, (defReceived.get(effectId) ?? 0) + damage)
      }
    }
    const defenseColumns = buildPartyEffectColumns(
      defReceived.keys(),
      stats.catalog,
      defReceived,
      maxColumnsPerParty,
      (entry) => isDefenseBreakItem(entry as BuffCatalogEntry | undefined)
    )

    // 2) Other debuffs: one column per (debuff x applier), applier in this party.
    type Draft = OverlayPartyBuffColumn & { totalDamage: number }
    const groups = new Map<string, Draft>()
    for (const member of bucket.members) {
      const source = stats.bySource.get(member.sourceId)
      if (!source) continue
      for (const [effectId, casters] of Object.entries(source.debuffedByCaster)) {
        const entry = stats.catalog.get(effectId)
        if (!entry || isDefenseBreakItem(entry) || isHiddenDebuff(entry)) continue
        for (const [casterId, damage] of Object.entries(casters)) {
          if (damage <= 0 || !memberIds.has(casterId)) continue
          const key = `${effectId}|${casterId}`
          const existing = groups.get(key)
          if (existing) {
            existing.totalDamage += damage
            continue
          }
          const label = buffColumnLabel(entry.name)
          const provider = casterName(casterId)
          groups.set(key, {
            key,
            label,
            icon: entry.icon || null,
            buffIds: [effectId],
            providers: [provider],
            tooltip: `${label}\n施加人：${provider}`,
            casterId,
            totalDamage: damage
          })
        }
      }
    }
    const otherColumns = [...groups.values()]
      .sort((a, b) => b.totalDamage - a.totalDamage)
      .map(({ totalDamage, ...column }) => {
        void totalDamage
        return column
      })

    const columns = [...defenseColumns, ...otherColumns].slice(
      0,
      Math.max(1, maxColumnsPerParty)
    )
    if (!columns.length) continue

    const rows: OverlayPartyBuffRow[] = bucket.members
      .map((member) => {
        const source = stats.bySource.get(member.sourceId)
        const cells = columns.map((column) => {
          if (!source || member.damage <= 0) return null
          let damage = 0
          if (column.casterId) {
            for (const effectId of column.buffIds) {
              damage += source.debuffedByCaster[effectId]?.[column.casterId] ?? 0
            }
          } else {
            for (const effectId of column.buffIds) {
              damage += source.debuffedBy[effectId] ?? 0
            }
          }
          if (damage <= 0) return null
          return Math.min(damage / member.damage, 1)
        })
        return {
          sourceId: member.sourceId,
          label: member.label,
          classId: member.classId,
          damage: member.damage,
          share: topDamage > 0 ? Math.min(member.damage / topDamage, 1) : 0,
          cells
        }
      })
      .sort((a, b) => b.damage - a.damage)

    parties.push({
      key: bucket.key,
      label: singleParty ? null : `小队 ${parties.length + 1}`,
      groups: [],
      columns,
      rows
    })
  }

  return parties.length ? { parties } : null
}

// ---------------------------------------------------------------------------
// 破坏防御 (battle item) per-player apply counts, grouped into 2 parties so the
// overlay can show 小队1 (left) / 小队2 (right) side by side.
// ---------------------------------------------------------------------------

export type OverlayDefenseBreakMember = {
  sourceId: string
  label: string
  classId: number | null
  count: number
}

export type OverlayDefenseBreakParty = {
  key: string
  label: string
  members: OverlayDefenseBreakMember[]
}

export type OverlayDefenseBreakCounts = {
  parties: OverlayDefenseBreakParty[]
  total: number
}

export function parseOverlayDefenseBreakCounts(
  payload: Record<string, unknown>,
  playerRows: SourceRow[]
): OverlayDefenseBreakCounts | null {
  const stats = parseBuffStats(payload)
  if (!stats) return null
  const countBySource = new Map<string, number>()
  for (const apply of stats.defenseBreakApplies) {
    countBySource.set(apply.sourceId, (countBySource.get(apply.sourceId) ?? 0) + apply.count)
  }
  const total = [...countBySource.values()].reduce((sum, value) => sum + value, 0)

  const playerBySourceId = new Map(playerRows.map((row) => [row.sourceId, row]))
  const orderedParties = [...stats.parties].sort(
    (a, b) =>
      (a.partyGroupIndex ?? 99) - (b.partyGroupIndex ?? 99) ||
      a.partyInstanceId - b.partyInstanceId
  )

  const parties: OverlayDefenseBreakParty[] = []
  const assigned = new Set<string>()
  for (const party of orderedParties) {
    const members: OverlayDefenseBreakMember[] = party.memberSourceIds
      .map((sourceId) => {
        const row = playerBySourceId.get(sourceId)
        if (!row) return null
        assigned.add(sourceId)
        return {
          sourceId,
          label: row.label,
          classId: row.classId,
          count: countBySource.get(sourceId) ?? 0
        }
      })
      .filter((member): member is OverlayDefenseBreakMember => Boolean(member))
      .sort((a, b) => b.count - a.count || b.label.localeCompare(a.label))
    if (!members.length) continue
    parties.push({
      key: `p${party.partyInstanceId}`,
      label: `小队 ${parties.length + 1}`,
      members
    })
  }

  const leftovers = playerRows.filter(
    (row) => !assigned.has(row.sourceId) && (countBySource.get(row.sourceId) ?? 0) > 0
  )
  if (leftovers.length) {
    parties.push({
      key: 'rest',
      label: parties.length ? `小队 ${parties.length + 1}` : '小队 1',
      members: leftovers
        .map((row) => ({
          sourceId: row.sourceId,
          label: row.label,
          classId: row.classId,
          count: countBySource.get(row.sourceId) ?? 0
        }))
        .sort((a, b) => b.count - a.count)
    })
  }

  return parties.length ? { parties, total } : null
}

// ---------------------------------------------------------------------------
// LOA Logs-style SHIELD tab (Given / Received / Total Blocked / Blocked
// Breakdown, party-grouped with per-buff icon columns).
// ---------------------------------------------------------------------------

export type ShieldTabId = 'given' | 'received' | 'eGiven' | 'eReceived'

export const OVERLAY_SHIELD_TABS: Array<{ id: ShieldTabId; label: string; title: string }> = [
  { id: 'given', label: '给予', title: '每个技能给予的护盾总量 (Shields Given)' },
  { id: 'received', label: '接收', title: '从每个技能获得的护盾总量 (Shields Received)' },
  { id: 'eGiven', label: '总格挡', title: '自己施放的护盾实际格挡的伤害 (Total Blocked)' },
  { id: 'eReceived', label: '格挡明细', title: '每个护盾在自己身上格挡的伤害 (Blocked Breakdown)' }
]

const SHIELD_METRIC_KEYS: Record<
  ShieldTabId,
  { total: keyof ShieldSourceStats; byBuff: keyof ShieldSourceStats }
> = {
  given: { total: 'shieldGiven', byBuff: 'shieldGivenBy' },
  received: { total: 'shieldReceived', byBuff: 'shieldReceivedBy' },
  eGiven: { total: 'effectiveShieldGiven', byBuff: 'effectiveShieldGivenBy' },
  eReceived: { total: 'effectiveShieldReceived', byBuff: 'effectiveShieldReceivedBy' }
}

export type OverlayShieldColumn = {
  key: string
  label: string
  icon: string | null
  buffIds: string[]
}

export type OverlayShieldTableRow = {
  sourceId: string
  label: string
  classId: number | null
  total: number
  share: number
  cells: Array<number | null>
}

export type OverlayShieldParty = {
  key: string
  label: string | null
  columns: OverlayShieldColumn[]
  rows: OverlayShieldTableRow[]
}

export type OverlayShieldTable = {
  parties: OverlayShieldParty[]
}

function shieldRowTotal(row: ShieldSourceStats, tab: ShieldTabId): number {
  return Number(row[SHIELD_METRIC_KEYS[tab].total] ?? 0)
}

function shieldRowBuffMap(row: ShieldSourceStats, tab: ShieldTabId): Record<string, number> {
  const value = row[SHIELD_METRIC_KEYS[tab].byBuff]
  return value && typeof value === 'object' ? (value as Record<string, number>) : {}
}

export function parseOverlayShieldTable(
  payload: Record<string, unknown>,
  playerRows: SourceRow[],
  tab: ShieldTabId,
  maxColumns = 6
): OverlayShieldTable | null {
  const stats = parseShieldStatsView(payload)
  if (!stats) return null
  const playerBySourceId = new Map(playerRows.map((row) => [row.sourceId, row]))
  // Esthers (埃斯德) are allied summons, not players: never list them in the
  // SHIELD matrix (DPS tab only).
  const estherSourceIds = new Set(
    playerRows.filter((row) => row.isEsther).map((row) => row.sourceId)
  )

  const enriched = stats.rows
    .map((row) => {
      const player = playerBySourceId.get(row.sourceId)
      return {
        row,
        sourceId: row.sourceId,
        label: row.playerName ?? player?.label ?? '',
        classId: row.classId ?? player?.classId ?? null
      }
    })
    .filter(
      (entry) =>
        entry.label && !entry.label.startsWith('Source ') && !estherSourceIds.has(entry.sourceId)
    )
  if (!enriched.length) return null

  const topValue = Math.max(...enriched.map((entry) => shieldRowTotal(entry.row, tab)), 0)

  // Party buckets ordered by partyGroupIndex (fallback: one bucket).
  const buckets = new Map<string, typeof enriched>()
  for (const entry of enriched) {
    const groupIndex = entry.row.partyGroupIndex
    const key = groupIndex != null ? `g${groupIndex}` : entry.row.partyInstanceId != null ? `p${entry.row.partyInstanceId}` : 'all'
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }
  const singleParty = buckets.size <= 1
  const orderedKeys = [...buckets.keys()].sort()

  const parties: OverlayShieldParty[] = []
  for (const key of orderedKeys) {
    const members = buckets.get(key) ?? []
    // Build buff columns present among this party's members, grouped LOA
    // Logs-style: uniqueGroup first, then name+icon, then raw buff id.
    const groups = new Map<string, OverlayShieldColumn & { totalValue: number }>()
    for (const entry of members) {
      const buffMap = shieldRowBuffMap(entry.row, tab)
      for (const [buffId, amount] of Object.entries(buffMap)) {
        if (!amount) continue
        const info = stats.catalog.get(buffId)
        const groupKey =
          info && info.uniqueGroup > 0
            ? `g${info.uniqueGroup}`
            : info && info.name
              ? `n${info.name}|${info.icon}`
              : `b${buffId}`
        const existing = groups.get(groupKey)
        if (existing) {
          if (!existing.buffIds.includes(buffId)) existing.buffIds.push(buffId)
          existing.totalValue += amount
        } else {
          groups.set(groupKey, {
            key: groupKey,
            label: info?.name || `#${buffId}`,
            icon: info?.icon || null,
            buffIds: [buffId],
            totalValue: amount
          })
        }
      }
    }
    const columns = [...groups.values()]
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, Math.max(1, maxColumns))
      .map(({ key: columnKey, label, icon, buffIds }) => ({ key: columnKey, label, icon, buffIds }))

    const rows: OverlayShieldTableRow[] = members
      .map((entry) => {
        const buffMap = shieldRowBuffMap(entry.row, tab)
        const total = shieldRowTotal(entry.row, tab)
        const cells = columns.map((column) => {
          let amount = 0
          for (const buffId of column.buffIds) {
            amount += buffMap[buffId] ?? 0
          }
          return amount > 0 ? amount : null
        })
        return {
          sourceId: entry.sourceId,
          label: entry.label,
          classId: entry.classId,
          total,
          share: topValue > 0 ? Math.min(total / topValue, 1) : 0,
          cells
        }
      })
      .sort((a, b) => b.total - a.total)

    parties.push({
      key,
      label: singleParty ? null : `小队 ${parties.length + 1}`,
      columns,
      rows
    })
  }

  return { parties }
}

export function stableColorSeed(text: string): number {
  let seed = 0
  for (const char of text) {
    seed = ((seed * 131) + char.charCodeAt(0)) >>> 0
  }
  return seed
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
  if (status === 'waiting_for_material') {
    return { tone: 'warning', label: '在线 · 等待会话密钥' }
  }
  if (status === 'waiting_for_packets') {
    return { tone: 'online', label: '在线 · 等待战斗' }
  }
  return { tone: 'online', label: '在线 · 等待战斗' }
}

export function compactDamageWarning(state: OverlayMeterState): string {
  const warning = String(state.damageWarning ?? '').trim()
  const status = String(state.status ?? '').trim()
  if (status === 'waiting_for_material' || warning.includes('会话密钥') || warning.toLowerCase().includes('material')) {
    return '等待会话密钥；进本前重启 meter'
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
  if (tab === 'debuff') return '等待减益归因数据…'
  if (tab === 'shields') return '等待护盾数据…'
  if (state.damageWarning) return compactDamageWarning(state)
  if (state.unresolvedCount > 0) return `D132 seen: ${state.unresolvedCount} unresolved damage rows`
  return 'waiting for damage'
}
