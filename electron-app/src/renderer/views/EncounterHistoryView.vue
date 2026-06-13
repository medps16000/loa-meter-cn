<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DpsTable from '../components/DpsTable.vue'
import PartyRosterPanel from '../components/PartyRosterPanel.vue'
import SkillBreakdownPanel from '../components/SkillBreakdownPanel.vue'
import SummaryBar from '../components/SummaryBar.vue'
import { formatDamage, formatDuration, formatPercent, formatRecordDate } from '../lib/format'
import { parseHistoricalPayload, type DisplayState } from '../lib/meter-display'

type EncounterSummary = {
  id: number
  startedAt: string
  bossName: string
  totalDamage: number
  dps: number
  durationSeconds: number
  status: string
}

type EncounterDetail = {
  id: number
  startedAt: string
  closedAt: string | null
  finalState: Record<string, unknown> | null
}

const rows = ref<EncounterSummary[]>([])
const selectedId = ref<number | null>(null)
const detail = ref<EncounterDetail | null>(null)
const display = ref<DisplayState | null>(null)
const selectedSourceId = ref('')
const error = ref<string | null>(null)
const importMessage = ref<string | null>(null)
const loadingDetail = ref(false)

const selectedRow = computed(() => {
  const list = display.value?.rows ?? []
  if (!list.length) return null
  if (selectedSourceId.value) {
    return list.find((row) => row.sourceId === selectedSourceId.value) ?? list[0]
  }
  return list[0]
})

async function loadList(): Promise<void> {
  try {
    rows.value = (await window.encountersApi.list(50)) as EncounterSummary[]
    error.value = null
    if (!selectedId.value && rows.value.length) {
      await selectEncounter(rows.value[0].id)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function selectEncounter(id: number): Promise<void> {
  selectedId.value = id
  loadingDetail.value = true
  try {
    const payload = (await window.encountersApi.get(id)) as EncounterDetail | null
    detail.value = payload
    if (payload?.finalState) {
      display.value = parseHistoricalPayload(
        {
          startedAt: payload.startedAt,
          closedAt: payload.closedAt,
          finalState: payload.finalState,
          bossOnly: true
        },
        { limit: 12 }
      )
      selectedSourceId.value = display.value.rows[0]?.sourceId ?? ''
    } else {
      display.value = null
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loadingDetail.value = false
  }
}

async function importJson(): Promise<void> {
  const result = await window.encountersApi.importJsonDir()
  if (result.cancelled) return
  importMessage.value = result.ok
    ? `已导入 ${result.imported} 条记录${result.path ? `（${result.path}）` : ''}`
    : '导入失败'
  await loadList()
}

onMounted(() => {
  void loadList()
})
</script>

<template>
  <section class="history-view">
    <header class="toolbar">
      <div>
        <h2>战斗历史</h2>
        <p class="muted">SQLite 持久化 · 点击列表查看详情</p>
      </div>
      <div class="actions">
        <button type="button" @click="importJson()">导入 JSON 历史</button>
        <button type="button" @click="loadList()">刷新列表</button>
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="importMessage" class="muted">{{ importMessage }}</p>

    <div class="layout">
      <aside class="list-panel">
        <table>
          <thead>
            <tr>
              <th>Boss</th>
              <th>伤害</th>
              <th>DPS</th>
              <th>时长</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              :class="{ selected: row.id === selectedId }"
              @click="selectEncounter(row.id)"
            >
              <td>{{ row.bossName }}</td>
              <td>{{ formatDamage(row.totalDamage) }}</td>
              <td>{{ formatDamage(row.dps) }}</td>
              <td>{{ formatDuration(row.durationSeconds) }}</td>
              <td>{{ formatRecordDate(row.startedAt) }}</td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="5" class="muted">暂无记录。完成战斗后会自动写入，或点击「导入 JSON 历史」。</td>
            </tr>
          </tbody>
        </table>
      </aside>

      <section class="detail-panel">
        <p v-if="loadingDetail" class="muted">加载详情…</p>
        <template v-else-if="display">
          <SummaryBar :display="display" />
          <PartyRosterPanel :roster="display.partyRoster" />
          <div class="split">
            <DpsTable
              :rows="display.rows"
              :selected-source-id="selectedSourceId"
              @select="selectedSourceId = $event"
            />
            <SkillBreakdownPanel :row="selectedRow" />
          </div>
        </template>
        <p v-else class="muted">选择左侧一场战斗查看 DPS 与技能分解。</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.history-view {
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
}

.layout {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 16px;
  min-height: 480px;
}

.list-panel,
.detail-panel {
  border: 1px solid #2a3140;
  border-radius: 10px;
  background: #151922;
  padding: 12px;
  overflow: auto;
}

.list-panel tr {
  cursor: pointer;
}

.list-panel tr.selected td {
  background: #24304a;
}

.detail-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.split {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 16px;
}
</style>
