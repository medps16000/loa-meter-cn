<script setup lang="ts">
import ClassIcon from './ClassIcon.vue'
import type { DisplayRow } from '../lib/meter-display'
import { formatDamage, formatPercent } from '../lib/format'

defineProps<{
  rows: DisplayRow[]
  selectedSourceId?: string
}>()

const emit = defineEmits<{
  select: [sourceId: string]
}>()
</script>

<template>
  <table>
    <thead>
      <tr>
        <th>玩家</th>
        <th>伤害</th>
        <th>占比</th>
        <th>DPS</th>
        <th>暴击</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.sourceId || row.name"
        :class="{ selected: row.sourceId && row.sourceId === selectedSourceId }"
        @click="emit('select', row.sourceId)"
      >
        <td class="player-cell">
          <ClassIcon :class-id="row.classId" :size="22" :title="row.name" />
          <span class="player-name">
            {{ row.name }}
            <span v-if="row.reliability !== 'ok'" class="muted">({{ row.reliability }})</span>
            <span v-if="row.itemLevel || row.combatPower" class="gear-line">
              <template v-if="row.itemLevel">装等 {{ row.itemLevel.toFixed(1) }}</template>
              <template v-if="row.itemLevel && row.combatPower"> · </template>
              <template v-if="row.combatPower">战力 {{ row.combatPower.toFixed(1) }}</template>
            </span>
          </span>
        </td>
        <td>{{ formatDamage(row.totalDamage) }}</td>
        <td>{{ formatPercent(row.damageShare) }}</td>
        <td>{{ formatDamage(row.dps) }}</td>
        <td>{{ formatPercent(row.critRate) }}</td>
      </tr>
      <tr v-if="!rows.length">
        <td colspan="5" class="muted">等待伤害数据…</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
tr {
  cursor: pointer;
}

tr.selected td {
  background: #24304a;
}

.player-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.player-name {
  min-width: 0;
}

td .muted {
  font-size: 12px;
}

.gear-line {
  display: block;
  font-size: 11px;
  color: #8b93a7;
  line-height: 1.2;
}
</style>
