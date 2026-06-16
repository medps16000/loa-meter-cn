<script setup lang="ts">
import { computed } from 'vue'
import ClassIcon from './ClassIcon.vue'
import type { DisplayRow, ShieldSourceStats } from '../lib/meter-display'
import { formatDamage } from '../lib/format'

const props = defineProps<{
  rows: DisplayRow[]
  shieldRows: ShieldSourceStats[]
}>()

type ShieldDisplayRow = ShieldSourceStats & {
  name: string
  classId: number | null
}

const displayRows = computed<ShieldDisplayRow[]>(() => {
  const playerBySourceId = new Map(props.rows.map((row) => [row.sourceId, row]))
  return props.shieldRows
    .map((entry) => {
      const player = playerBySourceId.get(entry.sourceId)
      return {
        ...entry,
        name: entry.playerName ?? player?.name ?? '',
        classId: entry.classId ?? player?.classId ?? null
      }
    })
    .filter((entry) => entry.name && !entry.name.startsWith('Source '))
    .sort(
      (a, b) =>
        b.effectiveShieldGiven - a.effectiveShieldGiven ||
        b.shieldGiven - a.shieldGiven ||
        b.effectiveShieldReceived - a.effectiveShieldReceived
    )
})
</script>

<template>
  <section class="shield-panel">
    <header class="panel-head">
      <h3>护盾统计</h3>
    </header>
    <p v-if="!displayRows.length" class="muted">暂无护盾数据（需要 0xDCBF 护盾同步包）。</p>
    <table v-else>
      <thead>
        <tr>
          <th class="player-col">玩家</th>
          <th title="施放的护盾总量">给予护盾</th>
          <th title="获得的护盾总量">获得护盾</th>
          <th title="施放的护盾实际吸收的伤害">有效给予</th>
          <th title="自身护盾实际吸收的伤害">有效吸收</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in displayRows" :key="row.sourceId">
          <td class="player-col">
            <ClassIcon :class-id="row.classId" :size="18" :title="row.name" />
            <span class="player-name">{{ row.name }}</span>
          </td>
          <td>{{ formatDamage(row.shieldGiven) }}</td>
          <td>{{ formatDamage(row.shieldReceived) }}</td>
          <td class="emph">{{ formatDamage(row.effectiveShieldGiven) }}</td>
          <td>{{ formatDamage(row.effectiveShieldReceived) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="muted hint">
      四维口径对齐 LOA Logs SHIELD 页签：给予/获得为上盾总量，有效值为护盾实际吸收的伤害。
    </p>
  </section>
</template>

<style scoped>
.shield-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-head h3 {
  margin: 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 6px 8px;
  text-align: right;
  white-space: nowrap;
}

th {
  color: #8b93a7;
  font-weight: 500;
}

.player-col {
  text-align: left;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
}

.player-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

tbody tr:nth-child(odd) td {
  background: rgba(255, 255, 255, 0.02);
}

.emph {
  color: #7ddf8f;
}

.hint {
  font-size: 11px;
  margin: 0;
}
</style>
