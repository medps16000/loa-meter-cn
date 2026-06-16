<script setup lang="ts">
import { computed } from 'vue'
import ClassIcon from './ClassIcon.vue'
import type { DisplayRow } from '../lib/meter-display'
import { formatDamage, formatPercent } from '../lib/format'

const props = defineProps<{
  rows: DisplayRow[]
  selectedSourceId?: string
}>()

const emit = defineEmits<{
  select: [sourceId: string]
}>()

// 仅在出现 Boss 盾伤时显示盾伤列, 避免普通战斗多一列空数据.
const showShield = computed(() => props.rows.some((row) => row.shieldDamage > 0))
// 瘫痪值 (record+0x3c) 同理: 有数据时才显示, 避免空列.
const showStagger = computed(() => props.rows.some((row) => row.stagger > 0))
const columnCount = computed(() => 5 + (showShield.value ? 1 : 0) + (showStagger.value ? 1 : 0))
</script>

<template>
  <table>
    <thead>
      <tr>
        <th>玩家</th>
        <th>伤害</th>
        <th v-if="showShield" title="对 Boss 护盾造成的伤害（已计入伤害）">盾伤</th>
        <th v-if="showStagger" title="对 Boss 造成的瘫痪值（record+0x3c）">瘫痪</th>
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
        <td v-if="showShield" class="shield-cell">{{ row.shieldDamage > 0 ? formatDamage(row.shieldDamage) : '–' }}</td>
        <td v-if="showStagger" class="stagger-cell">{{ row.stagger > 0 ? formatDamage(row.stagger) : '–' }}</td>
        <td>{{ formatPercent(row.damageShare) }}</td>
        <td>{{ formatDamage(row.dps) }}</td>
        <td>{{ formatPercent(row.critRate) }}</td>
      </tr>
      <tr v-if="!rows.length">
        <td :colspan="columnCount" class="muted">等待伤害数据…</td>
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

.shield-cell {
  color: #7dd3fc;
}

.stagger-cell {
  color: #f0b860;
}
</style>
