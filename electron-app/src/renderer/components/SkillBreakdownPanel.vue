<script setup lang="ts">
import type { DisplayRow } from '../lib/meter-display'
import { formatDamage, formatPercent } from '../lib/format'

const props = defineProps<{
  row: DisplayRow | null
}>()
</script>

<template>
  <section class="skill-panel">
    <header>
      <h3>技能分解</h3>
      <p class="muted" v-if="props.row">{{ props.row.name }}</p>
      <p class="muted" v-else>点击上方玩家行查看技能</p>
    </header>

    <table v-if="props.row?.skillBreakdown.length">
      <thead>
        <tr>
          <th>技能</th>
          <th>伤害</th>
          <th title="该技能对 Boss 造成的瘫痪值（record+0x3c）">瘫痪</th>
          <th>占比</th>
          <th>DPS</th>
          <th>暴击</th>
          <th>命中</th>
          <th>背击</th>
          <th>头击</th>
          <th>详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="skill in props.row.skillBreakdown" :key="`${skill.skillId}-${skill.name}`">
          <td>{{ skill.name }}</td>
          <td>{{ formatDamage(skill.totalDamage) }}</td>
          <td class="stagger-cell">{{ skill.stagger > 0 ? formatDamage(skill.stagger) : '–' }}</td>
          <td>{{ formatPercent(skill.damageShare) }}</td>
          <td>{{ formatDamage(skill.dps) }}</td>
          <td>{{ formatPercent(skill.critRate) }}</td>
          <td>{{ skill.hitRate == null ? '—' : formatPercent(skill.hitRate) }}</td>
          <td>{{ skill.backAttackRate == null ? '—' : formatPercent(skill.backAttackRate) }}</td>
          <td>{{ skill.headAttackRate == null ? '—' : formatPercent(skill.headAttackRate) }}</td>
          <td class="muted">{{ skill.effectSummary || '—' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="props.row" class="muted">该玩家暂无技能分解数据</p>
  </section>
</template>

<style scoped>
.skill-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

header h3 {
  margin: 0;
  font-size: 14px;
}

header p {
  margin: 4px 0 0;
}

.stagger-cell {
  color: #f0b860;
}
</style>
