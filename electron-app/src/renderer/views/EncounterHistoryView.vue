<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { formatDamage, formatDuration, formatRecordDate } from '../lib/format'

type EncounterSummary = {
  id: number
  startedAt: string
  bossName: string
  bossDifficulty: string | null
  raidName: string | null
  gateName: string | null
  totalDamage: number
  dps: number
  durationSeconds: number
  status: string
}

const rows = ref<EncounterSummary[]>([])
const raidNames = ref<string[]>([])
const raidFilter = ref<string>('')
const selectedId = ref<number | null>(null)
const projectedId = ref<number | null>(null)
const projectingId = ref<number | null>(null)
const listLoading = ref(false)
const error = ref<string | null>(null)
const importMessage = ref<string | null>(null)
const busy = ref(false)

let refreshTimer: ReturnType<typeof setInterval> | null = null

const selectedRow = computed(
  () => rows.value.find((row) => row.id === selectedId.value) ?? null
)

function raidLabel(row: EncounterSummary): string {
  if (!row.raidName) return row.gateName ?? '—'
  return row.gateName ? `${row.raidName} ${row.gateName}` : row.raidName
}

async function loadList(preserveSelection = true, silent = false): Promise<void> {
  if (!silent) listLoading.value = true
  try {
    const filters = raidFilter.value ? { raidName: raidFilter.value } : undefined
    rows.value = (await window.encountersApi.list(100, filters)) as EncounterSummary[]
    raidNames.value = await window.encountersApi.listRaidNames()
    error.value = null
    if (!preserveSelection || !rows.value.some((row) => row.id === selectedId.value)) {
      selectedId.value = rows.value[0]?.id ?? null
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (!silent) listLoading.value = false
  }
}

async function projectEncounter(id: number): Promise<void> {
  if (projectingId.value != null) return
  selectedId.value = id
  projectingId.value = id
  try {
    const result = await window.overlayApi.projectEncounter(id)
    if (result.ok) {
      projectedId.value = id
      error.value = null
    } else {
      error.value = '投射失败：该记录缺少最终状态数据'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    projectingId.value = null
  }
}

async function clearProjection(): Promise<void> {
  await window.overlayApi.clearProjection()
  projectedId.value = null
}

async function deleteEncounter(id: number): Promise<void> {
  const row = rows.value.find((item) => item.id === id)
  const label = row ? `${raidLabel(row)} · ${row.bossName}` : `#${id}`
  if (!window.confirm(`确定删除这场战斗记录？\n${label}\n该操作不可恢复。`)) return
  busy.value = true
  try {
    const result = await window.encountersApi.delete(id)
    if (!result.ok) {
      error.value = '删除失败：记录不存在或已被移除'
      return
    }
    if (projectedId.value === id) projectedId.value = null
    if (selectedId.value === id) selectedId.value = null
    await loadList()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
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

onMounted(async () => {
  const projection = await window.overlayApi.getProjection()
  projectedId.value = projection?.id ?? null
  await loadList(false)
  // Encounters are written by the capture backend into the shared SQLite, so
  // poll the (cheap) list query to surface newly finished fights without
  // subscribing to the heavy per-tick live state.
  refreshTimer = setInterval(() => {
    void loadList(true, true)
  }, 5000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <section class="query-view">
    <header class="toolbar">
      <div>
        <h2>战斗查询</h2>
        <p class="muted">点击记录投射到战斗悬浮窗查看伤害与技能详情 · 列表每 5 秒自动刷新</p>
      </div>
      <div class="actions">
        <label class="raid-filter">
          <span class="muted">副本</span>
          <select v-model="raidFilter" @change="loadList(false)">
            <option value="">全部副本</option>
            <option v-for="name in raidNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <button type="button" @click="importJson()">导入 JSON 历史</button>
        <button type="button" :disabled="listLoading" @click="loadList(false)">
          {{ listLoading ? '刷新中…' : '刷新列表' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="importMessage" class="muted">{{ importMessage }}</p>

    <div v-if="projectedId != null" class="projection-banner">
      <span class="dot" />
      <span class="text">
        悬浮窗正在显示
        <strong v-if="selectedRow && selectedRow.id === projectedId">
          {{ raidLabel(selectedRow) }} · {{ selectedRow.bossName }}
        </strong>
        <strong v-else>#{{ projectedId }}</strong>
        的战斗结果
      </span>
      <button type="button" class="ghost" @click="clearProjection()">取消投射（恢复实时）</button>
    </div>

    <div class="list-panel">
      <div v-if="listLoading && !rows.length" class="loading-overlay">
        <span class="spinner" /> 正在加载战斗记录…
      </div>
      <table>
        <thead>
          <tr>
            <th>副本 / 关卡</th>
            <th>Boss</th>
            <th class="num">伤害</th>
            <th class="num">DPS</th>
            <th class="num">时长</th>
            <th>时间</th>
            <th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            :class="{
              selected: row.id === selectedId,
              projected: row.id === projectedId,
              projecting: row.id === projectingId
            }"
            @click="projectEncounter(row.id)"
          >
            <td class="raid-cell" :title="raidLabel(row)">
              {{ raidLabel(row) }}
              <span v-if="row.bossDifficulty" class="difficulty">{{ row.bossDifficulty }}</span>
            </td>
            <td class="boss-cell" :title="row.bossName">{{ row.bossName }}</td>
            <td class="num">{{ formatDamage(row.totalDamage) }}</td>
            <td class="num">{{ formatDamage(Math.round(row.dps)) }}</td>
            <td class="num">{{ formatDuration(row.durationSeconds) }}</td>
            <td>{{ formatRecordDate(row.startedAt) }}</td>
            <td class="ops">
              <button
                type="button"
                class="op project"
                title="投射到战斗悬浮窗"
                :disabled="projectingId === row.id"
                @click.stop="projectEncounter(row.id)"
              >
                {{ projectingId === row.id ? '投射中…' : '投射' }}
              </button>
              <button
                type="button"
                class="op danger"
                title="删除该战斗记录"
                :disabled="busy"
                @click.stop="deleteEncounter(row.id)"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="7" class="muted empty">
              暂无记录。完成战斗后会自动写入，或点击「导入 JSON 历史」。
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.query-view {
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

.raid-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.raid-filter select {
  max-width: 220px;
}

.projection-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid #5b5021;
  background: #2a2614;
  border-radius: 8px;
  font-size: 13px;
}

.projection-banner .dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #d8a23c;
  box-shadow: 0 0 6px rgba(216, 162, 60, 0.8);
}

.projection-banner .text {
  flex: 1;
  color: #e8d9b0;
}

.projection-banner strong {
  color: #f4e3b6;
}

.list-panel {
  position: relative;
  border: 1px solid #2a3140;
  border-radius: 10px;
  background: #151922;
  padding: 4px;
  overflow: auto;
  max-height: calc(100vh - 220px);
}

.loading-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 0;
  color: #8d97ad;
  font-size: 13px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #2a3140;
  border-top-color: #5b74ad;
  border-radius: 999px;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead th {
  position: sticky;
  top: 0;
  background: #1b2030;
  z-index: 1;
  text-align: left;
  padding: 8px 10px;
  font-size: 12px;
  color: #8d97ad;
  border-bottom: 1px solid #2a3140;
}

tbody td {
  padding: 8px 10px;
  border-bottom: 1px solid #1f2531;
  font-size: 13px;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover td {
  background: #1c2433;
}

tbody tr.selected td {
  background: #24304a;
}

tbody tr.projected td {
  box-shadow: inset 2px 0 0 #d8a23c;
}

tbody tr.projecting td {
  opacity: 0.6;
}

.op:disabled {
  opacity: 0.6;
  cursor: wait;
}

.raid-cell,
.boss-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.difficulty {
  margin-left: 4px;
  font-size: 11px;
  color: #d8a23c;
}

.ops {
  white-space: nowrap;
  text-align: right;
}

.op {
  font-size: 12px;
  padding: 3px 10px;
  margin-left: 6px;
}

.op.project {
  background: #3d4f78;
  border-color: #5b74ad;
}

.op.danger {
  background: #5a2530;
  border-color: #8a3a47;
}

.op.danger:hover:not(:disabled) {
  background: #74303c;
}

.empty {
  text-align: center;
  padding: 24px;
}
</style>
