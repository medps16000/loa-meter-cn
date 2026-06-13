<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import BuffStatsPanel from '../components/BuffStatsPanel.vue'
import DpsTable from '../components/DpsTable.vue'
import PartyRosterPanel from '../components/PartyRosterPanel.vue'
import ShieldStatsPanel from '../components/ShieldStatsPanel.vue'
import SkillBreakdownPanel from '../components/SkillBreakdownPanel.vue'
import SummaryBar from '../components/SummaryBar.vue'
import { formatDamage, formatRecordDate } from '../lib/format'
import { parseBuffStats, parseShieldStats } from '../lib/meter-display'
import { useMeterStore } from '../stores/meter'

const meter = useMeterStore()
const selectedSourceId = ref<string>('')
const encounterSelectValue = ref<string>('live')
const panelTab = ref<'damage' | 'buffs' | 'shields'>('damage')

const buffStats = computed(() => {
  const raw = meter.activeRawState
  return raw ? parseBuffStats(raw) : null
})

const shieldRows = computed(() => {
  const raw = meter.activeRawState
  return raw ? parseShieldStats(raw) : []
})

let removeStateListener: (() => void) | null = null

const encounterOptions = computed(() => {
  const options = [{ value: 'live', label: '当前战斗' }]
  for (const row of meter.recentEncounters.slice(0, 5)) {
    const boss = row.bossName?.trim() || '未识别 Boss'
    const damage = formatDamage(row.totalDamage)
    const when = formatRecordDate(row.startedAt)
    options.push({
      value: String(row.id),
      label: `${when} · ${boss} · ${damage}`
    })
  }
  return options
})

async function onEncounterSelectChange(): Promise<void> {
  if (encounterSelectValue.value === 'live') {
    await meter.selectLiveView()
    return
  }
  const id = Number(encounterSelectValue.value)
  if (Number.isFinite(id) && id > 0) {
    await meter.selectHistoricalEncounter(id)
  }
}

const selectedRow = computed(() => {
  const rows = meter.display?.rows ?? []
  if (!rows.length) return null
  if (selectedSourceId.value) {
    return rows.find((row) => row.sourceId === selectedSourceId.value) ?? rows[0]
  }
  return rows[0]
})

const summonAttributionRelaxed = computed(() => {
  const raw = meter.rawState
  if (!raw || raw._offlineReplay === true) return null
  const value = raw.inferredSummonOwnerRowsRelaxed
  return typeof value === 'number' ? value : null
})

const offlineReplay = computed(() => {
  const raw = meter.rawState
  if (!raw || raw._offlineReplay !== true) return null
  return {
    label: String(raw._offlineReplayLabel ?? 'offline'),
    index: Number(raw._offlineReplayIndex ?? 0),
    total: Number(raw._offlineReplayTotal ?? 0),
    progress: Number(raw._offlineReplayProgress ?? 0)
  }
})

onMounted(async () => {
  await meter.loadRecentEncounters()
  await meter.refresh()
  removeStateListener = window.meterApi.onStateChange((state) => {
    meter.applyState(state)
  })
})

onUnmounted(() => {
  removeStateListener?.()
})
</script>

<template>
  <section class="live-view">
    <header class="toolbar">
      <div>
        <h2>实时战斗</h2>
        <p class="muted">
          状态：{{ meter.status }}
          <template v-if="offlineReplay">
            · 离线回放 {{ offlineReplay.label }}（{{ offlineReplay.index }}/{{ offlineReplay.total }}）
          </template>
          <template v-else>
            · SSE 推送，可手动刷新
            <template v-if="summonAttributionRelaxed != null">
              · 召唤归属 {{ summonAttributionRelaxed }}
            </template>
          </template>
        </p>
      </div>
      <div class="actions">
        <label class="encounter-select">
          <span class="muted">战斗</span>
          <select v-model="encounterSelectValue" @change="onEncounterSelectChange">
            <option v-for="option in encounterOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <button type="button" :disabled="meter.loading" @click="meter.refresh()">
          {{ meter.loading ? '刷新中…' : '刷新' }}
        </button>
        <button type="button" @click="meter.reset()">重置</button>
      </div>
    </header>

    <p v-if="meter.error" class="error">{{ meter.error }}</p>

    <template v-if="meter.display">
      <SummaryBar :display="meter.display" />
      <PartyRosterPanel :roster="meter.display.partyRoster" />

      <nav class="panel-tabs">
        <button type="button" :class="{ active: panelTab === 'damage' }" @click="panelTab = 'damage'">
          伤害
        </button>
        <button type="button" :class="{ active: panelTab === 'buffs' }" @click="panelTab = 'buffs'">
          增益
        </button>
        <button type="button" :class="{ active: panelTab === 'shields' }" @click="panelTab = 'shields'">
          护盾
        </button>
      </nav>

      <div v-if="panelTab === 'damage'" class="split">
        <DpsTable
          :rows="meter.display.rows"
          :selected-source-id="selectedSourceId"
          @select="selectedSourceId = $event"
        />
        <SkillBreakdownPanel :row="selectedRow" />
      </div>
      <BuffStatsPanel
        v-else-if="panelTab === 'buffs'"
        :rows="meter.display.rows"
        :buff-stats="buffStats"
      />
      <ShieldStatsPanel
        v-else
        :rows="meter.display.rows"
        :shield-rows="shieldRows"
      />
    </template>
    <p v-else class="muted empty-hint">暂无战斗数据，点击「刷新」从服务器拉取最新状态。</p>
  </section>
</template>

<style scoped>
.live-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toolbar h2 {
  margin: 0 0 4px;
}

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.encounter-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.encounter-select select {
  min-width: 220px;
  max-width: 360px;
}

.split {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 16px;
}

.panel-tabs {
  display: flex;
  gap: 8px;
}

.panel-tabs button {
  font-size: 13px;
  padding: 5px 14px;
}

.panel-tabs button.active {
  background: #3d4f78;
  border-color: #5b74ad;
}

.empty-hint {
  margin: 24px 0 0;
  text-align: center;
}
</style>
