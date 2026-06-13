<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { TransitionGroup } from 'vue'
import type { OverlaySettings } from '../../preload/index'
import ClassIcon from '../components/ClassIcon.vue'
import SkillIcon from '../components/SkillIcon.vue'
import { classBarColor } from '../lib/class-icons'
import { formatDamage, formatDuration, formatPercent } from '../lib/format'
import {
  compactDamageWarning,
  emptyTabMessage,
  OVERLAY_TABS,
  overlayPaletteColor,
  parseOverlayBuffTable,
  parseOverlayShieldRows,
  parseOverlayState,
  parsePlayerSkillRows,
  resolveOverlayStatusIndicator,
  rowsForTab,
  type OverlayMeterState,
  type OverlayTab,
  type SourceRow
} from '../lib/overlay-meter'
import {
  OVERLAY_DEFAULT_PARTY_ROWS,
  OVERLAY_MAX_HEIGHT,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_ROW_LIMIT,
  OVERLAY_SKILL_FIXED_ROWS,
  computeOverlayHeight,
  measureOverlayContentHeight
} from '../lib/overlay-layout'

const state = ref<OverlayMeterState | null>(null)
const rawPayload = ref<Record<string, unknown> | null>(null)
// Last payload that actually carried combat damage. Detail panels (skills /
// buffs / shields) read from this so that an encounter clear/restart (which
// blanks the live payload's skill rows) does not break per-player drilldown
// while the DPS table still shows the finished fight.
const combatPayload = ref<Record<string, unknown> | null>(null)
const error = ref<string | null>(null)
const refreshing = ref(false)
const activeTab = ref<OverlayTab>('dps')
const selectedPlayer = ref<SourceRow | null>(null)
const settings = ref<OverlaySettings>({
  opacity: 0.92,
  locked: false,
  clickThrough: false
})

let removeStateListener: (() => void) | null = null
let lastCombatState: OverlayMeterState | null = null
let opacityTimer: ReturnType<typeof setTimeout> | null = null
let removeSettingsListener: (() => void) | null = null
let lastOverlayHeight = 0
let resizeObserver: ResizeObserver | null = null
let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
let overlayDragging = false

const overlayRef = ref<HTMLElement | null>(null)
const rowsNeedScroll = ref(false)

const detailPayload = computed(() => combatPayload.value ?? rawPayload.value)

const visibleRows = computed(() => {
  if (!state.value) return []
  if (activeTab.value === 'skills' && selectedPlayer.value && detailPayload.value) {
    return parsePlayerSkillRows(
      detailPayload.value,
      {
        sourceId: selectedPlayer.value.sourceId,
        label: selectedPlayer.value.label,
        classId: selectedPlayer.value.classId,
        totalDamage: selectedPlayer.value.damage
      },
      32
    )
  }
  return rowsForTab(state.value, activeTab.value)
})

const isPlayerTab = computed(() => activeTab.value === 'dps' || activeTab.value === 'boss' || activeTab.value === 'self')

const isCustomTab = computed(() => activeTab.value === 'buffs' || activeTab.value === 'shields')

const buffTable = computed(() => {
  if (activeTab.value !== 'buffs' || !detailPayload.value || !state.value) return null
  return parseOverlayBuffTable(detailPayload.value, state.value.rows, 4)
})

const shieldRows = computed(() => {
  if (activeTab.value !== 'shields' || !detailPayload.value || !state.value) return []
  return parseOverlayShieldRows(detailPayload.value, state.value.rows, OVERLAY_ROW_LIMIT)
})

const nameColumnLabel = computed(() => (activeTab.value === 'skills' ? '技能' : '名称'))

const showSkillStatColumns = computed(
  () => activeTab.value === 'skills' && Boolean(selectedPlayer.value)
)

function formatOptionalPercent(value: number | null | undefined): string {
  return value == null ? '—' : formatPercent(value)
}

const offlineReplay = computed(() => {
  const raw = rawPayload.value
  if (!raw || raw._offlineReplay !== true) return null
  return {
    index: Number(raw._offlineReplayIndex ?? 0),
    total: Number(raw._offlineReplayTotal ?? 0)
  }
})

const bossTitle = computed(() => {
  if (!state.value) return '—'
  if (state.value.error) return '离线'
  if (state.value.damageWarning) return compactDamageWarning(state.value)
  if (state.value.bossKnown && state.value.bossName) return state.value.bossName
  return '未识别'
})

const statusIndicator = computed(() =>
  resolveOverlayStatusIndicator({
    status: String(state.value?.status ?? rawPayload.value?.status ?? 'unknown'),
    error: error.value,
    totalDamage: state.value?.totalDamage ?? 0,
    encounterComplete:
      rawPayload.value?.encounterComplete === true ||
      state.value?.status === 'encounter_complete'
  })
)


const emptyMessage = computed(() => {
  if (!state.value) return '等待伤害数据…'
  if (activeTab.value === 'skills' && selectedPlayer.value) {
    return `${selectedPlayer.value.label} 暂无技能数据`
  }
  if (activeTab.value === 'skills' && !selectedPlayer.value) {
    return '点击 DPS 列表中的玩家查看技能统计'
  }
  return emptyTabMessage(state.value, activeTab.value)
})

const opacityPercent = computed({
  get: () => Math.round(settings.value.opacity * 100),
  set: (value: number) => {
    void applyOpacity(value / 100)
  }
})

function hasDamage(value: OverlayMeterState): boolean {
  return value.totalDamage > 0 || value.rows.some((row) => row.damage > 0)
}

function applyPayload(payload: Record<string, unknown>): void {
  rawPayload.value = payload
  const parsed = parseOverlayState(payload, OVERLAY_ROW_LIMIT)
  if (hasDamage(parsed)) {
    lastCombatState = parsed
    combatPayload.value = payload
    state.value = parsed
  } else if (error.value && lastCombatState) {
    state.value = { ...lastCombatState, error: error.value }
  } else if (lastCombatState) {
    state.value = { ...lastCombatState, status: parsed.status }
  } else {
    state.value = parsed
  }
  error.value = null
}

async function refresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    applyPayload(await window.meterApi.fetchState())
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    if (lastCombatState) {
      state.value = { ...lastCombatState, error: error.value }
    }
  } finally {
    refreshing.value = false
  }
}

function setTab(tab: OverlayTab): void {
  if (settings.value.clickThrough) return
  activeTab.value = tab
  if (tab !== 'skills') {
    selectedPlayer.value = null
  }
}

function onPlayerRowClick(row: SourceRow): void {
  if (settings.value.clickThrough || !isPlayerTab.value) return
  selectedPlayer.value = row
  activeTab.value = 'skills'
}

async function loadSettings(): Promise<void> {
  settings.value = await window.overlayApi.getSettings()
}

async function applyOpacity(opacity: number): Promise<void> {
  settings.value = await window.overlayApi.setOpacity(opacity)
}

function onOpacityInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (opacityTimer) clearTimeout(opacityTimer)
  opacityTimer = setTimeout(() => {
    void applyOpacity(value / 100)
  }, 60)
}

async function toggleLocked(): Promise<void> {
  settings.value = await window.overlayApi.toggleLocked()
}

async function toggleClickThrough(): Promise<void> {
  settings.value = await window.overlayApi.toggleClickThrough()
}

async function closeOverlay(): Promise<void> {
  window.overlayApi.setPointerPassthrough(false)
  await window.overlayApi.closeWindow()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    void closeOverlay()
    return
  }
  if (settings.value.clickThrough) return
  if (event.key === '1') setTab('dps')
  if (event.key === '2') setTab('skills')
  if (event.key === '3') setTab('self')
  if (event.key === '4') setTab('boss')
  if (event.key === '5') setTab('buffs')
  if (event.key === '6') setTab('shields')
  if (event.key === 'F5') void refresh()
  if (event.key.toLowerCase() === 'l') void toggleLocked()
}

function rowStyle(row: SourceRow, index: number): Record<string, string> {
  const color =
    activeTab.value === 'skills'
      ? overlayPaletteColor(row, index)
      : classBarColor(row.classId) ?? overlayPaletteColor(row, index)
  const width = `${Math.max(3, Math.round(Math.max(0, Math.min(1, row.share)) * 100))}%`
  return {
    '--row-color': color,
    '--share-width': width
  }
}

function formatShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function rowKey(row: SourceRow): string {
  if (activeTab.value === 'skills') return `skill-${row.sourceId}-${row.label}`
  return `player-${row.sourceId}`
}

function scheduleSyncOverlayHeight(): void {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer)
  resizeDebounceTimer = setTimeout(() => {
    resizeDebounceTimer = null
    void syncOverlayHeight()
  }, 150)
}

async function syncOverlayHeight(): Promise<void> {
  if (settings.value.locked || overlayDragging) return
  await nextTick()

  let height: number
  if (activeTab.value === 'dps') {
    const measured = measureOverlayContentHeight(overlayRef.value)
    const fallback = computeOverlayHeight(visibleRows.value.length || 1, {
      maxRows: OVERLAY_ROW_LIMIT
    })
    const contentHeight = measured ?? fallback
    rowsNeedScroll.value = contentHeight > OVERLAY_MAX_HEIGHT
    height = Math.min(OVERLAY_MAX_HEIGHT, Math.max(contentHeight, fallback))
  } else {
    rowsNeedScroll.value = activeTab.value === 'skills'
    const fallback = computeOverlayHeight(
      activeTab.value === 'skills' ? OVERLAY_SKILL_FIXED_ROWS : OVERLAY_DEFAULT_PARTY_ROWS,
      {
        skillContext: activeTab.value === 'skills' && Boolean(selectedPlayer.value)
      }
    )
    height = Math.min(OVERLAY_MAX_HEIGHT, Math.max(fallback, OVERLAY_MIN_HEIGHT))
  }

  if (height === lastOverlayHeight) return
  lastOverlayHeight = height
  await window.overlayApi.resizeToHeight(height)
}

function onOverlayDragStart(event: MouseEvent): void {
  if (settings.value.locked || settings.value.clickThrough) return
  if ((event.target as HTMLElement | null)?.closest('.no-drag')) return
  overlayDragging = true
}

function onOverlayDragEnd(): void {
  if (!overlayDragging) return
  overlayDragging = false
  scheduleSyncOverlayHeight()
}

watch(
  () => settings.value.clickThrough,
  (enabled) => {
    document.body.classList.toggle('overlay-click-through', enabled)
    if (!enabled) {
      window.overlayApi.setPointerPassthrough(false)
    }
  },
  { immediate: true }
)

watch(
  [visibleRows, activeTab, selectedPlayer, () => settings.value.locked],
  () => {
    scheduleSyncOverlayHeight()
  },
  { immediate: true, deep: true }
)

onMounted(async () => {
  await loadSettings()
  removeSettingsListener = window.overlayApi.onSettingsChanged((next) => {
    settings.value = next
  })
  resizeObserver = new ResizeObserver(() => {
    if (activeTab.value !== 'dps') return
    scheduleSyncOverlayHeight()
  })
  await refresh()
  removeStateListener = window.meterApi.onStateChange((payload) => {
    applyPayload(payload)
  })
  await nextTick()
  if (overlayRef.value && resizeObserver) {
    resizeObserver.observe(overlayRef.value)
    const rowsEl = overlayRef.value.querySelector('.rows')
    if (rowsEl) resizeObserver.observe(rowsEl)
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mouseup', onOverlayDragEnd)
})

onUnmounted(() => {
  removeStateListener?.()
  if (opacityTimer) clearTimeout(opacityTimer)
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer)
  resizeObserver?.disconnect()
  removeSettingsListener?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mouseup', onOverlayDragEnd)
})
</script>

<template>
  <div
    ref="overlayRef"
    class="meter-overlay"
    :class="{
      locked: settings.locked,
      'click-through': settings.clickThrough,
      'rows-scroll': rowsNeedScroll
    }"
  >
    <header
      class="titlebar interactive"
      :class="{ 'drag-handle': !settings.locked && !settings.clickThrough }"
      @mousedown="onOverlayDragStart"
    >
      <div class="title-left">
        <div class="brand-line">
          <span
            class="status-light"
            :class="[`tone-${statusIndicator.tone}`, { pulse: statusIndicator.tone === 'combat' || statusIndicator.tone === 'instance' }]"
            :title="statusIndicator.label"
            :aria-label="statusIndicator.label"
          />
          <span class="brand">LOA METER</span>
        </div>
        <span class="boss-line">
          <span class="boss">{{ bossTitle }}</span>
          <span v-if="state?.bossGateName" class="gate"> · {{ state.bossGateName }}</span>
          <span v-if="state?.bossDifficulty" class="gate"> · {{ state.bossDifficulty }}</span>
        </span>
        <span v-if="state && state.totalDamage > 0" class="summary">
          总伤 {{ formatDamage(state.totalDamage) }} · DPS {{ formatDamage(Math.round(state.dps)) }}/秒
        </span>
      </div>
      <div class="title-right no-drag">
        <span class="timer">{{ state ? formatDuration(state.elapsedSeconds) : '00:00' }}</span>
        <button
          type="button"
          class="icon-btn"
          :class="{ active: refreshing }"
          title="手动刷新 (F5)"
          :disabled="refreshing"
          @mousedown.stop
          @click.stop="refresh()"
        >
          ↻
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ active: settings.locked }"
          :title="settings.locked ? '已锁定（不可拖动/缩放）' : '锁定位置'"
          @mousedown.stop
          @click.stop="toggleLocked()"
        >
          {{ settings.locked ? '🔒' : '🔓' }}
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ active: settings.clickThrough }"
          title="点击穿透（Ctrl+Shift+M）"
          @mousedown.stop
          @click.stop="toggleClickThrough()"
        >
          ◌
        </button>
        <button
          type="button"
          class="icon-btn danger"
          title="关闭悬浮窗（Esc）"
          @mousedown.stop
          @click.stop="closeOverlay()"
        >
          ✕
        </button>
      </div>
    </header>

    <nav class="tabs no-drag interactive">
      <button
        v-for="tab in OVERLAY_TABS"
        :key="tab.id"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @mousedown.stop
        @click.stop="setTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <section v-if="activeTab === 'skills' && selectedPlayer" class="skill-context no-drag interactive">
      <ClassIcon :class-id="selectedPlayer.classId" :size="18" :title="selectedPlayer.label" />
      <span class="skill-context-name">{{ selectedPlayer.label }}</span>
      <span class="skill-context-hint">技能明细</span>
    </section>

    <section v-if="!isCustomTab" class="grid-head" :class="{ 'grid-head--skills': showSkillStatColumns }">
      <span>{{ nameColumnLabel }}</span>
      <span>伤害</span>
      <span v-if="showSkillStatColumns">占比</span>
      <span v-else>DPS</span>
      <span v-if="showSkillStatColumns">暴击</span>
      <span v-else>占比</span>
      <template v-if="showSkillStatColumns">
        <span>命中</span>
        <span>背击</span>
        <span>头击</span>
      </template>
    </section>

    <template v-if="activeTab === 'buffs'">
      <section v-if="buffTable" class="grid-head grid-head--buffs" :style="{ '--buff-cols': buffTable.columns.length }">
        <span>玩家</span>
        <span v-for="column in buffTable.columns" :key="column.key" class="buff-col" :title="column.label">
          {{ column.label }}
        </span>
      </section>
      <section class="rows">
        <p v-if="!buffTable || !buffTable.rows.length" class="empty">{{ emptyMessage }}</p>
        <div v-else class="row-list">
          <article
            v-for="row in buffTable.rows"
            :key="`buff-${row.sourceId}`"
            class="row"
          >
            <div class="cells cells--buffs" :style="{ '--buff-cols': buffTable.columns.length }">
              <span class="identity" :title="row.label">
                <ClassIcon :class-id="row.classId" :size="20" :title="row.label" />
                <span class="name">{{ row.label }}</span>
              </span>
              <span
                v-for="(cell, index) in row.cells"
                :key="buffTable.columns[index].key"
                class="num"
                :class="cell != null && cell >= 0.85 ? 'buff-high' : cell != null && cell >= 0.5 ? 'buff-mid' : ''"
              >
                {{ cell != null ? `${Math.round(cell * 100)}%` : '–' }}
              </span>
            </div>
          </article>
        </div>
      </section>
    </template>

    <template v-else-if="activeTab === 'shields'">
      <section class="grid-head grid-head--shields">
        <span>玩家</span>
        <span title="施放的护盾总量">给予</span>
        <span title="获得的护盾总量">获得</span>
        <span title="施放护盾实际吸收">有效给予</span>
        <span title="自身护盾实际吸收">有效吸收</span>
      </section>
      <section class="rows">
        <p v-if="!shieldRows.length" class="empty">{{ emptyMessage }}</p>
        <div v-else class="row-list">
          <article
            v-for="row in shieldRows"
            :key="`shield-${row.sourceId}`"
            class="row"
          >
            <div class="cells cells--shields">
              <span class="identity" :title="row.label">
                <ClassIcon :class-id="row.classId" :size="20" :title="row.label" />
                <span class="name">{{ row.label }}</span>
              </span>
              <span class="num">{{ formatDamage(row.shieldGiven) }}</span>
              <span class="num">{{ formatDamage(row.shieldReceived) }}</span>
              <span class="num buff-high">{{ formatDamage(row.effectiveShieldGiven) }}</span>
              <span class="num">{{ formatDamage(row.effectiveShieldReceived) }}</span>
            </div>
          </article>
        </div>
      </section>
    </template>

    <section v-if="!isCustomTab" class="rows" :class="{ 'rows-scrollable': rowsNeedScroll }">
      <p v-if="!visibleRows.length" class="empty">{{ emptyMessage }}</p>
      <TransitionGroup v-else name="rank" tag="div" class="row-list">
        <article
          v-for="(row, index) in visibleRows"
          :key="rowKey(row)"
          class="row"
          :class="{ clickable: isPlayerTab }"
          :style="rowStyle(row, index)"
          @click="onPlayerRowClick(row)"
        >
          <div class="bar" />
          <div class="cells" :class="{ 'cells--skills': showSkillStatColumns }">
            <span class="identity" :title="row.label">
              <SkillIcon
                v-if="activeTab === 'skills'"
                :skill-icon="row.skillIcon"
                :size="22"
                :title="row.label"
              />
              <ClassIcon
                v-else
                :class-id="row.classId"
                :size="22"
                :title="row.label"
              />
              <span class="name">{{ row.label }}</span>
            </span>
            <span class="num">{{ formatDamage(row.damage) }}</span>
            <template v-if="showSkillStatColumns">
              <span class="num share">{{ formatShare(row.share) }}</span>
              <span class="num">{{ formatPercent(row.critRate) }}</span>
              <span class="num">{{ formatOptionalPercent(row.hitRate) }}</span>
              <span class="num">{{ formatOptionalPercent(row.backAttackRate) }}</span>
              <span class="num">{{ formatOptionalPercent(row.headAttackRate) }}</span>
            </template>
            <template v-else>
              <span class="num">{{ formatDamage(Math.round(row.dps)) }}</span>
              <span class="num share">{{ formatShare(row.share) }}</span>
            </template>
          </div>
        </article>
      </TransitionGroup>
    </section>

    <footer class="footer no-drag interactive">
      <label class="opacity-control" title="窗口透明度">
        <span>透明度</span>
        <input
          type="range"
          min="35"
          max="100"
          step="1"
          :value="opacityPercent"
          @input="onOpacityInput"
        />
        <span class="opacity-value">{{ opacityPercent }}%</span>
      </label>
      <span class="hint">
        <template v-if="offlineReplay">离线回放 {{ offlineReplay.index }}/{{ offlineReplay.total }} ·</template>
        点击玩家看技能 · L 锁定 · 1-6 切页 · Ctrl+Shift+M 穿透
      </span>
    </footer>
  </div>
</template>

<style scoped>
.meter-overlay {
  --panel-alpha: 0.96;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #d4d4d8;
  background: rgba(39, 39, 42, var(--panel-alpha));
  border: 1px solid rgba(82, 82, 91, 0.75);
  border-radius: 8px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

.titlebar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px 6px;
  background: rgba(24, 24, 27, 0.98);
  border-bottom: 1px solid rgba(63, 63, 70, 0.85);
}

.drag-handle {
  -webkit-app-region: drag;
  cursor: move;
}

.title-left {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-light {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

.status-light.tone-offline {
  background: #71717a;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
}

.status-light.tone-online {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.75);
}

.status-light.tone-instance {
  background: #a855f7;
  box-shadow: 0 0 6px rgba(168, 85, 247, 0.8);
}

.status-light.tone-combat {
  background: #06b6d4;
  box-shadow: 0 0 6px rgba(6, 182, 212, 0.8);
}

.status-light.tone-complete {
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.75);
}

.status-light.tone-warning {
  background: #eab308;
  box-shadow: 0 0 6px rgba(234, 179, 8, 0.75);
}

.status-light.pulse {
  animation: status-pulse 1.8s ease-in-out infinite;
}

@keyframes status-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.72;
    transform: scale(0.92);
  }
}

.brand {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #f4f4f5;
}

.boss-line {
  display: flex;
  align-items: baseline;
  gap: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.boss,
.gate {
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e7;
}

.boss {
  flex-shrink: 0;
}

.gate {
  overflow: hidden;
  text-overflow: ellipsis;
}

.summary {
  font-size: 10px;
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
}

.title-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
  -webkit-app-region: no-drag;
}

.timer {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #a1a1aa;
  margin-right: 4px;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.icon-btn {
  width: 26px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: rgba(39, 39, 42, 0.8);
  color: #e4e4e7;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(63, 63, 70, 0.95);
  border-color: rgba(113, 113, 122, 0.5);
}

.icon-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.icon-btn.active {
  background: rgba(29, 78, 216, 0.35);
  border-color: rgba(59, 130, 246, 0.65);
  color: #dbeafe;
}

.icon-btn.danger:hover {
  background: rgba(127, 29, 29, 0.55);
  border-color: rgba(248, 113, 113, 0.55);
  color: #fecaca;
}

.tabs {
  display: flex;
  gap: 3px;
  padding: 5px 8px;
  background: rgba(24, 24, 27, 0.95);
  border-bottom: 1px solid rgba(63, 63, 70, 0.6);
}

.tab {
  border: 0;
  border-radius: 4px;
  padding: 3px 9px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #71717a;
  background: transparent;
  cursor: pointer;
}

.tab:hover {
  color: #d4d4d8;
  background: rgba(63, 63, 70, 0.55);
}

.tab.active {
  color: #fafafa;
  background: rgba(82, 82, 91, 0.95);
}

.grid-head,
.row .cells {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) 0.82fr 0.72fr 0.48fr;
  gap: 8px;
  align-items: center;
}

.grid-head--skills,
.row .cells--skills {
  grid-template-columns: minmax(0, 1.35fr) 0.72fr 0.42fr 0.42fr 0.42fr 0.42fr 0.42fr;
  gap: 5px;
  font-size: 9px;
}

.grid-head--skills {
  font-size: 9px;
}

.grid-head--buffs,
.row .cells--buffs {
  grid-template-columns: minmax(0, 1.4fr) repeat(var(--buff-cols, 4), minmax(0, 0.62fr));
  gap: 5px;
}

.grid-head--buffs {
  font-size: 9px;
}

.grid-head--buffs .buff-col {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-head--shields,
.row .cells--shields {
  grid-template-columns: minmax(0, 1.4fr) 0.62fr 0.62fr 0.72fr 0.72fr;
  gap: 5px;
}

.buff-high {
  color: #7ddf8f;
}

.buff-mid {
  color: #e8d178;
}

.grid-head {
  padding: 3px 10px 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #71717a;
  border-bottom: 1px solid rgba(63, 63, 70, 0.55);
}

.grid-head span:not(:first-child),
.row .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.rows {
  flex: 0 0 auto;
  overflow: visible;
  padding: 4px 6px 6px;
  position: relative;
}

.meter-overlay.rows-scroll .rows.rows-scrollable {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.row-list {
  position: relative;
}

.empty {
  margin: 14px 8px;
  color: #a1a1aa;
  font-size: 12px;
}

.skill-context {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  color: #d4d4d8;
  background: rgba(39, 39, 42, 0.9);
  border-bottom: 1px solid rgba(63, 63, 70, 0.55);
}

.skill-context-name {
  font-weight: 600;
  color: #fafafa;
}

.skill-context-hint {
  color: #71717a;
  font-size: 10px;
}

.row {
  position: relative;
  margin-bottom: 3px;
  min-height: 28px;
  border-radius: 3px;
  overflow: hidden;
}

.row.clickable {
  cursor: pointer;
}

.row.clickable:hover .cells {
  background: rgba(255, 255, 255, 0.04);
}

.row .bar {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--share-width);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--row-color) 52%, transparent),
    color-mix(in srgb, var(--row-color) 22%, transparent)
  );
  transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.rank-move {
  transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.rank-enter-active {
  transition:
    opacity 0.28s ease,
    transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}

.rank-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.28s ease;
  position: absolute;
  left: 0;
  right: 0;
}

.rank-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.rank-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.row .cells {
  position: relative;
  z-index: 1;
  padding: 3px 8px;
  font-size: 11px;
  line-height: 1.2;
}

.identity {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #fafafa;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.row .num {
  color: #e4e4e7;
  transition: color 0.2s ease;
}

.row .num.share {
  color: #a1a1aa;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px 8px;
  border-top: 1px solid rgba(63, 63, 70, 0.7);
  background: rgba(24, 24, 27, 0.96);
}

.opacity-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #a1a1aa;
}

.opacity-control input[type='range'] {
  width: 96px;
  accent-color: var(--accent);
}

.opacity-value {
  width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.hint {
  font-size: 10px;
  color: #71717a;
  white-space: nowrap;
}

.meter-overlay.locked,
.meter-overlay.locked * {
  -webkit-app-region: no-drag !important;
}

.meter-overlay.locked .drag-handle {
  cursor: default;
}

.meter-overlay.click-through .rows,
.meter-overlay.click-through .grid-head {
  pointer-events: none;
}
</style>
