<script setup lang="ts">
import { bossTitleText, type DisplayState } from '../lib/meter-display'
import { formatDamage, formatDuration, formatPercent } from '../lib/format'

defineProps<{
  display: DisplayState
}>()
</script>

<template>
  <section class="summary-bar" :class="{ historical: display.historicalFromRecord, warning: !display.bossKnown && display.bossOnly }">
    <div class="title">
      <template v-if="display.historicalFromRecord">历史记录</template>
      <template v-else>当前战斗</template>
      · {{ bossTitleText(display) }}<span v-if="display.bossGateName" class="gate"> · {{ display.bossGateName }}</span><span v-if="display.bossDifficulty" class="gate"> · {{ display.bossDifficulty }}</span>
    </div>
    <div class="metrics">
      <div><span class="muted">总伤害</span><strong>{{ formatDamage(display.totalDamage) }}</strong></div>
      <div><span class="muted">DPS</span><strong>{{ formatDamage(display.dps) }}/秒</strong></div>
      <div><span class="muted">时长</span><strong>{{ formatDuration(display.durationSeconds) }}</strong></div>
      <div><span class="muted">命中</span><strong>{{ display.hitCount }}</strong></div>
      <div><span class="muted">暴击</span><strong>{{ formatPercent(display.critRate) }}</strong></div>
      <div><span class="muted">队员</span><strong>{{ display.rows.length }}</strong></div>
    </div>
    <p v-if="display.warning" class="warning-text">{{ display.warning }}</p>
    <p v-if="display.selfSummary?.localPlayerName" class="self-line">
      本机：{{ display.selfSummary.localPlayerName }}
    </p>
  </section>
</template>

<style scoped>
.summary-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #1a2030;
  border: 1px solid #2d3648;
}

.summary-bar.warning {
  border-color: #8f3d24;
}

.summary-bar.historical {
  border-color: #27496d;
}

.title {
  font-size: 15px;
  font-weight: 600;
}


.metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.metrics div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warning-text,
.self-line {
  margin: 0;
  font-size: 13px;
}

.warning-text {
  color: #ffb27a;
}
</style>
