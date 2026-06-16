<script setup lang="ts">
import { computed, ref } from 'vue'
import ClassIcon from './ClassIcon.vue'
import type { BuffCasterStats, BuffCatalogEntry, BuffStatsView, DisplayRow } from '../lib/meter-display'
import { formatPercent } from '../lib/format'

const props = defineProps<{
  rows: DisplayRow[]
  buffStats: BuffStatsView | null
}>()

/** support/debuff = LOA Logs party effectiveness; coverage = per-DPS buff share */
type Mode = 'support' | 'debuff' | 'coverage' | 'self'
const mode = ref<Mode>('support')
const MAX_COLUMNS = 8

type BuffColumn = {
  key: string
  label: string
  buffIds: string[]
  totalDamage: number
  category: 'buff' | 'debuff'
}

function columnLabel(name: string): string {
  return name.replace(/\s*\d+$/u, '') || name
}

function isSupportPartyBuffEntry(entry: BuffCatalogEntry | undefined): boolean {
  if (!entry || entry.category !== 'buff') return false
  return Boolean(entry.isSupportPartyBuff)
}

function isBossDebuffEntry(entry: BuffCatalogEntry | undefined): boolean {
  if (!entry || entry.category !== 'debuff') return false
  if (entry.isBossDebuff) return true
  return true
}

function buildColumns(kind: 'buff' | 'debuff', partyOnly: boolean): BuffColumn[] {
  const stats = props.buffStats
  if (!stats) return []
  const groups = new Map<string, BuffColumn>()
  for (const { buffId, damage } of stats.totals) {
    const entry = stats.catalog.get(buffId)
    if (!entry) continue
    if (mode.value === 'support') {
      if (!isSupportPartyBuffEntry(entry)) continue
    } else if (mode.value === 'debuff') {
      if (!isBossDebuffEntry(entry)) continue
    } else if (entry.category !== kind) {
      continue
    }
    const isParty = entry.target === 'self_party' || entry.target === 'party'
    if (partyOnly && !isParty && kind === 'buff') continue
    if (mode.value === 'self' && isParty) continue
    const key = entry.uniqueGroup > 0 ? `g${entry.uniqueGroup}` : `b${buffId}`
    const existing = groups.get(key)
    if (existing) {
      existing.buffIds.push(buffId)
      existing.totalDamage += damage
    } else {
      groups.set(key, {
        key,
        label: columnLabel(entry.name),
        buffIds: [buffId],
        totalDamage: damage,
        category: kind
      })
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.totalDamage - a.totalDamage)
    .slice(0, MAX_COLUMNS)
}

const columns = computed<BuffColumn[]>(() => {
  if (mode.value === 'support') return buildColumns('buff', true)
  if (mode.value === 'debuff') return buildColumns('debuff', false)
  if (mode.value === 'coverage') return buildColumns('buff', true)
  return buildColumns('buff', false)
})

const casterRows = computed<BuffCasterStats[]>(() => {
  const stats = props.buffStats
  if (!stats) return []
  if (mode.value === 'support') {
    return stats.byCaster.filter((caster) =>
      Object.keys(caster.partyBuffedBy).some((buffId) =>
        isSupportPartyBuffEntry(stats.catalog.get(buffId))
      )
    )
  }
  if (mode.value === 'debuff') {
    return stats.byCaster.filter((caster) =>
      Object.keys(caster.partyDebuffedBy).some((buffId) =>
        isBossDebuffEntry(stats.catalog.get(buffId))
      )
    )
  }
  return []
})

function casterCellShare(caster: BuffCasterStats, column: BuffColumn): number | null {
  const denom =
    mode.value === 'debuff'
      ? caster.partyDebuffTotalDamage
      : caster.partyBuffTotalDamage
  const fallback = props.buffStats?.raidTotalDamage ?? 0
  const base = denom > 0 ? denom : fallback
  if (base <= 0) return null
  const map = mode.value === 'debuff' ? caster.partyDebuffedBy : caster.partyBuffedBy
  let damage = 0
  for (const buffId of column.buffIds) {
    damage += map[buffId] ?? 0
  }
  if (damage <= 0) return null
  return Math.min(damage / base, 1)
}

function coverageCellShare(row: DisplayRow, column: BuffColumn): number | null {
  const stats = props.buffStats
  if (!stats || row.totalDamage <= 0) return null
  const source = stats.bySource.get(row.sourceId)
  if (!source) return null
  let damage = 0
  for (const buffId of column.buffIds) {
    damage += source.buffedBy[buffId] ?? 0
  }
  if (damage <= 0) return null
  return Math.min(damage / row.totalDamage, 1)
}

function selfCellShare(row: DisplayRow, column: BuffColumn): number | null {
  const stats = props.buffStats
  if (!stats || row.totalDamage <= 0) return null
  const source = stats.bySource.get(row.sourceId)
  if (!source) return null
  let damage = 0
  for (const buffId of column.buffIds) {
    damage += source.buffedBySelf[buffId] ?? source.buffedBy[buffId] ?? 0
  }
  if (damage <= 0) return null
  return Math.min(damage / row.totalDamage, 1)
}

function cellClass(share: number | null): string {
  if (share == null) return 'cell-empty'
  if (share >= 0.85) return 'cell-high'
  if (share >= 0.5) return 'cell-mid'
  return 'cell-low'
}

const hintText = computed(() => {
  switch (mode.value) {
    case 'support':
      return '有效率 = 增益持续期间小队对 BOSS(含盾)造成的伤害 / 小队对 BOSS(含盾)总伤害（与 DPS 同口径，仅统计 BOSS 伤害与 BOSS 盾伤）。'
    case 'debuff':
      return '有效率 = 减益持续期间对 BOSS(含盾)造成的伤害 / 小队对 BOSS(含盾)总伤害（与 DPS 同口径，仅统计 BOSS 伤害与 BOSS 盾伤）。'
    case 'coverage':
      return '覆盖率 = 该输出对 BOSS(含盾)伤害中，处于队伍增益状态下的占比（仅统计 BOSS 伤害与 BOSS 盾伤）。'
    default:
      return '百分比 = 该输出对 BOSS(含盾)伤害中，处于自身增益状态下的占比（仅统计 BOSS 伤害与 BOSS 盾伤）。'
  }
})
</script>

<template>
  <section class="buff-panel">
    <header class="panel-head">
      <h3>增益贡献</h3>
      <div class="mode-switch">
        <button type="button" :class="{ active: mode === 'support' }" @click="mode = 'support'">
          支援有效率
        </button>
        <button type="button" :class="{ active: mode === 'debuff' }" @click="mode = 'debuff'">
          减益有效率
        </button>
        <button type="button" :class="{ active: mode === 'coverage' }" @click="mode = 'coverage'">
          增益覆盖率
        </button>
        <button type="button" :class="{ active: mode === 'self' }" @click="mode = 'self'">
          自身增益
        </button>
      </div>
    </header>

    <p v-if="!buffStats || !columns.length" class="muted">
      暂无{{ mode === 'debuff' ? '减益' : '增益' }}归因数据（需要状态效果包与伤害包同窗口）。
    </p>

    <div v-else-if="mode === 'support' || mode === 'debuff'" class="table-wrap">
      <p v-if="!casterRows.length" class="muted">暂无{{ mode === 'debuff' ? '减益' : '支援' }}施法者归因。</p>
      <table v-else>
        <thead>
          <tr>
            <th class="player-col">{{ mode === 'debuff' ? '减益来源' : '支援' }}</th>
            <th v-for="column in columns" :key="column.key" :title="column.label">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="caster in casterRows" :key="caster.casterSourceId">
            <td class="player-col">
              <ClassIcon :class-id="caster.classId" :size="18" :title="caster.casterName" />
              <span class="player-name">{{ caster.casterName }}</span>
            </td>
            <td
              v-for="column in columns"
              :key="column.key"
              :class="cellClass(casterCellShare(caster, column))"
            >
              {{
                casterCellShare(caster, column) != null
                  ? formatPercent(casterCellShare(caster, column)!)
                  : '–'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="player-col">玩家</th>
            <th v-for="column in columns" :key="column.key" :title="column.label">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.sourceId || row.name">
            <td class="player-col">
              <ClassIcon :class-id="row.classId" :size="18" :title="row.name" />
              <span class="player-name">{{ row.name }}</span>
            </td>
            <td
              v-for="column in columns"
              :key="column.key"
              :class="
                cellClass(
                  mode === 'self' ? selfCellShare(row, column) : coverageCellShare(row, column)
                )
              "
            >
              {{
                (mode === 'self' ? selfCellShare(row, column) : coverageCellShare(row, column)) !=
                null
                  ? formatPercent(
                      (mode === 'self'
                        ? selfCellShare(row, column)
                        : coverageCellShare(row, column))!
                    )
                  : '–'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="buffStats && columns.length" class="muted hint">{{ hintText }}</p>
  </section>
</template>

<style scoped>
.buff-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-head h3 {
  margin: 0;
}

.mode-switch {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mode-switch button {
  font-size: 12px;
  padding: 4px 10px;
}

.mode-switch button.active {
  background: #3d4f78;
  border-color: #5b74ad;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  padding: 6px 8px;
  text-align: center;
  white-space: nowrap;
}

th {
  color: #8b93a7;
  font-weight: 500;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-col {
  text-align: left;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 170px;
}

.player-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

tbody tr:nth-child(odd) td {
  background: rgba(255, 255, 255, 0.02);
}

.cell-high {
  color: #7ddf8f;
}

.cell-mid {
  color: #e8d178;
}

.cell-low {
  color: #c98a8a;
}

.cell-empty {
  color: #4a5164;
}

.hint {
  font-size: 11px;
  margin: 0;
}
</style>
