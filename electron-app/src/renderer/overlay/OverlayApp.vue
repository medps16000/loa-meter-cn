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
  OVERLAY_SHIELD_TABS,
  OVERLAY_TABS,
  overlayPaletteColor,
  parseOverlayDefenseBreakCounts,
  parseOverlayPartyBuffTable,
  parseOverlayPartyDebuffTable,
  parseOverlayShieldTable,
  parseOverlayState,
  parsePlayerSkillRows,
  resolveOverlayStatusIndicator,
  rowsForTab,
  type OverlayMeterState,
  type OverlayTab,
  type ShieldTabId,
  type SourceRow
} from '../lib/overlay-meter'
import {
  OVERLAY_COMPACT_MIN_HEIGHT,
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
// True while a stored encounter from SQLite is projected onto the overlay
// (query-tool mode); live updates are suppressed by the main process.
const projectionActive = ref(false)
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
  clickThrough: false,
  compact: false
})

const compact = computed(() => settings.value.compact)

let removeStateListener: (() => void) | null = null
let lastCombatState: OverlayMeterState | null = null
let opacityTimer: ReturnType<typeof setTimeout> | null = null
let removeSettingsListener: (() => void) | null = null
let lastOverlayHeight = 0
let resizeObserver: ResizeObserver | null = null
let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
let overlayDragging = false

const overlayRef = ref<HTMLElement | null>(null)
const titleRightRef = ref<HTMLElement | null>(null)
const rowsNeedScroll = ref(false)
let reportRectsFrame: number | null = null
let titleRightResizeObserver: ResizeObserver | null = null

const detailPayload = computed(() =>
  projectionActive.value ? rawPayload.value : (combatPayload.value ?? rawPayload.value)
)

const projectedEncounter = computed(() => {
  const raw = rawPayload.value
  if (!projectionActive.value || !raw) return null
  const info = raw._projectedEncounter
  if (!info || typeof info !== 'object') return null
  return info as {
    id: number
    bossName: string
    raidName: string | null
    gateName: string | null
    startedAt: string
  }
})

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

const isPlayerTab = computed(() => activeTab.value === 'dps')

const isCustomTab = computed(
  () => activeTab.value === 'buffs' || activeTab.value === 'debuff' || activeTab.value === 'shields'
)

const buffTable = computed(() => {
  if (activeTab.value !== 'buffs' || !detailPayload.value || !state.value) return null
  return parseOverlayPartyBuffTable(detailPayload.value, state.value.rows)
})

const debuffTable = computed(() => {
  if (activeTab.value !== 'debuff' || !detailPayload.value || !state.value) return null
  return parseOverlayPartyDebuffTable(detailPayload.value, state.value.rows)
})

const defenseBreakCounts = computed(() => {
  if (activeTab.value !== 'debuff' || !detailPayload.value || !state.value) return null
  return parseOverlayDefenseBreakCounts(detailPayload.value, state.value.rows)
})

function buffCellText(cell: number | null): string {
  if (cell == null) return '–'
  const percent = cell * 100
  return percent >= 99.95 ? '100%' : `${percent.toFixed(1)}%`
}

const shieldTab = ref<ShieldTabId>('given')

const shieldTable = computed(() => {
  if (activeTab.value !== 'shields' || !detailPayload.value || !state.value) return null
  return parseOverlayShieldTable(detailPayload.value, state.value.rows, shieldTab.value, 6)
})

function setShieldTab(tab: ShieldTabId): void {
  if (settings.value.clickThrough) return
  shieldTab.value = tab
}

function shieldRowStyle(row: { classId: number | null; share: number }): Record<string, string> {
  const color = classBarColor(row.classId) ?? '#4f7f2f'
  const width = `${Math.max(2, Math.round(Math.max(0, Math.min(1, row.share)) * 100))}%`
  return {
    '--row-color': color,
    '--share-width': width
  }
}

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

// 副本名称 + 关卡, e.g. "终幕：终结之日 第一关"
const raidTitle = computed(() => {
  const raid = state.value?.bossRaidName ?? null
  const gate = state.value?.bossGateName ?? null
  if (!raid) return null
  return gate ? `${raid} ${gate}` : raid
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
  if (payload._projectedEncounter && typeof payload._projectedEncounter === 'object') {
    // Projected history is rendered as-is and must not pollute the live
    // combat fallback (lastCombatState) used between pulls.
    projectionActive.value = true
    rawPayload.value = payload
    state.value = parseOverlayState(payload, OVERLAY_ROW_LIMIT)
    error.value = null
    return
  }
  projectionActive.value = false
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

async function exitProjection(): Promise<void> {
  await window.overlayApi.clearProjection()
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

async function toggleCompact(): Promise<void> {
  settings.value = await window.overlayApi.toggleCompact()
}

async function expandFromCompact(): Promise<void> {
  if (!settings.value.compact) return
  settings.value = await window.overlayApi.setCompact(false)
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
  if (event.key === '3') setTab('buffs')
  if (event.key === '4') setTab('debuff')
  if (event.key === '5') setTab('shields')
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
  if (compact.value) {
    // Thumbnail mode hides tabs + footer; size strictly to the measured content
    // (titlebar + grid head + DPS rows) so the window stays as short as possible.
    const measured = measureOverlayContentHeight(overlayRef.value)
    const contentHeight = measured ?? OVERLAY_COMPACT_MIN_HEIGHT
    rowsNeedScroll.value = contentHeight > OVERLAY_MAX_HEIGHT
    height = Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_COMPACT_MIN_HEIGHT, contentHeight))
  } else if (
    activeTab.value === 'dps' ||
    activeTab.value === 'shields' ||
    activeTab.value === 'buffs' ||
    activeTab.value === 'debuff'
  ) {
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

// In click-through mode only the top-right button group should capture the
// cursor; report its live rect to the main process (which polls the cursor and
// toggles pointer pass-through). Everything else — combat info, footer hint —
// stays pass-through so the player can't select it by accident.
function reportInteractiveRects(): void {
  if (!settings.value.clickThrough) {
    window.overlayApi.setInteractiveRects([])
    return
  }
  const el = titleRightRef.value
  if (!el) {
    window.overlayApi.setInteractiveRects([])
    return
  }
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    window.overlayApi.setInteractiveRects([])
    return
  }
  const pad = 4
  window.overlayApi.setInteractiveRects([
    {
      x: Math.max(0, Math.floor(rect.left - pad)),
      y: Math.max(0, Math.floor(rect.top - pad)),
      width: Math.ceil(rect.width + pad * 2),
      height: Math.ceil(rect.height + pad * 2)
    }
  ])
}

function scheduleReportInteractiveRects(): void {
  if (reportRectsFrame != null) return
  reportRectsFrame = requestAnimationFrame(() => {
    reportRectsFrame = null
    reportInteractiveRects()
  })
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
    scheduleReportInteractiveRects()
  },
  { immediate: true }
)

// Compact mode is DPS-only: drop any drilldown/other tab when it turns on.
watch(
  compact,
  (enabled) => {
    if (enabled) {
      activeTab.value = 'dps'
      selectedPlayer.value = null
    }
    scheduleSyncOverlayHeight()
  },
  { immediate: true }
)

watch(
  [visibleRows, activeTab, shieldTab, shieldTable, buffTable, debuffTable, selectedPlayer, () => settings.value.locked, compact],
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
    if (
      activeTab.value !== 'dps' &&
      activeTab.value !== 'shields' &&
      activeTab.value !== 'buffs' &&
      activeTab.value !== 'debuff'
    ) {
      return
    }
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
  // The button group's size (timer text, projection chip) and position (window
  // width) both shift the interactive rect; re-report on either change.
  titleRightResizeObserver = new ResizeObserver(() => scheduleReportInteractiveRects())
  if (titleRightRef.value) titleRightResizeObserver.observe(titleRightRef.value)
  window.addEventListener('resize', scheduleReportInteractiveRects)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mouseup', onOverlayDragEnd)
  scheduleReportInteractiveRects()
})

onUnmounted(() => {
  removeStateListener?.()
  if (opacityTimer) clearTimeout(opacityTimer)
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer)
  if (reportRectsFrame != null) cancelAnimationFrame(reportRectsFrame)
  resizeObserver?.disconnect()
  titleRightResizeObserver?.disconnect()
  removeSettingsListener?.()
  window.removeEventListener('resize', scheduleReportInteractiveRects)
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
      'rows-scroll': rowsNeedScroll,
      compact: compact
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
          <span v-if="!compact" class="brand">LOA METER</span>
          <span v-if="projectedEncounter" class="projection-chip" title="正在投射历史战斗记录">历史投射</span>
        </div>
        <span v-if="raidTitle" class="raid-line" :title="raidTitle">{{ raidTitle }}</span>
        <span class="boss-line">
          <span class="boss">{{ bossTitle }}</span>
          <span v-if="!raidTitle && state?.bossGateName" class="gate"> · {{ state.bossGateName }}</span>
          <span v-if="state?.bossDifficulty" class="gate"> · {{ state.bossDifficulty }}</span>
        </span>
        <span v-if="state && state.totalDamage > 0" class="summary">
          总伤 {{ formatDamage(state.totalDamage) }} · DPS {{ formatDamage(Math.round(state.dps)) }}/秒<span
            v-if="state.shieldDamage > 0"
            class="shield-summary"
            title="对 Boss 护盾造成的伤害 (已计入总伤)"
          > · 盾伤 {{ formatDamage(state.shieldDamage) }}</span>
        </span>
      </div>
      <div ref="titleRightRef" class="title-right no-drag">
        <span class="timer">{{ state ? formatDuration(state.elapsedSeconds) : '00:00' }}</span>
        <button
          v-if="projectedEncounter"
          type="button"
          class="icon-btn projection-exit"
          title="退出历史投射，恢复实时数据"
          @mousedown.stop
          @click.stop="exitProjection()"
        >
          ↩
        </button>
        <template v-if="!compact">
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
            class="icon-btn"
            title="缩略：只保留关卡/时长 + 紧凑 DPS 列表的小窗口"
            @mousedown.stop
            @click.stop="toggleCompact()"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 4v5H4" />
              <path d="M15 20v-5h5" />
              <path d="M20 9h-5V4" />
              <path d="M4 15h5v5" />
            </svg>
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
        </template>
        <template v-else>
          <button
            type="button"
            class="icon-btn compact-control"
            title="展开完整悬浮窗，查看技能/增益/护盾等详情"
            @mousedown.stop
            @click.stop="expandFromCompact()"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 9V4h5" />
              <path d="M20 15v5h-5" />
              <path d="M15 4h5v5" />
              <path d="M9 20H4v-5" />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn danger compact-control"
            title="关闭悬浮窗（Esc）"
            @mousedown.stop
            @click.stop="closeOverlay()"
          >
            ✕
          </button>
        </template>
      </div>
    </header>

    <nav v-if="!compact" class="tabs no-drag interactive">
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
      <span title="对 Boss 护盾造成的伤害 (已计入伤害)">盾伤</span>
      <span title="对 Boss 造成的瘫痪值 (record+0x3c)">瘫痪</span>
      <template v-if="showSkillStatColumns">
        <span>占比</span>
        <span>暴击</span>
        <span>背击</span>
        <span>头击</span>
      </template>
      <template v-else>
        <span>DPS</span>
        <span>占比</span>
      </template>
    </section>

    <template v-if="activeTab === 'buffs'">
      <section class="rows shield-rows">
        <p v-if="!buffTable || !buffTable.parties.length" class="empty">{{ emptyMessage }}</p>
        <template v-else>
          <div
            v-for="party in buffTable.parties"
            :key="`buff-party-${party.key}`"
            class="shield-party"
          >
            <header v-if="party.label" class="shield-party-head">{{ party.label }}</header>
            <div class="buff-matrix-scroll">
              <div
                class="grid-head grid-head--buff-matrix"
                :style="{ '--buff-cols': party.columns.length }"
              >
                <span>玩家</span>
                <span
                  v-for="column in party.columns"
                  :key="`col-${party.key}-${column.key}`"
                  class="shield-col"
                  :title="column.label"
                >
                  <SkillIcon :skill-icon="column.icon" :size="16" :title="column.label" />
                </span>
              </div>
              <div class="row-list">
                <article
                  v-for="row in party.rows"
                  :key="`buff-${party.key}-${row.sourceId}`"
                  class="row"
                  :style="shieldRowStyle(row)"
                >
                  <div class="bar" />
                  <div
                    class="cells cells--buff-matrix"
                    :style="{ '--buff-cols': party.columns.length }"
                  >
                    <span class="identity" :title="row.label">
                      <ClassIcon :class-id="row.classId" :size="18" :title="row.label" />
                      <span class="name">{{ row.label }}</span>
                    </span>
                    <span
                      v-for="(cell, index) in row.cells"
                      :key="`cell-${party.columns[index].key}`"
                      class="num"
                      :class="cell != null && cell >= 0.85 ? 'buff-high' : cell != null && cell >= 0.5 ? 'buff-mid' : ''"
                    >
                      {{ buffCellText(cell) }}
                    </span>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </template>
      </section>
    </template>

    <template v-else-if="activeTab === 'debuff'">
      <section class="rows shield-rows">
        <div
          v-if="defenseBreakCounts && defenseBreakCounts.parties.length"
          class="defbreak-panel"
        >
          <header class="defbreak-title">破坏防御 · 施加次数</header>
          <div class="defbreak-parties">
            <div
              v-for="party in defenseBreakCounts.parties"
              :key="`defbreak-${party.key}`"
              class="defbreak-party"
            >
              <header class="defbreak-party-head">{{ party.label }}</header>
              <div class="defbreak-members">
                <span
                  v-for="member in party.members"
                  :key="`defbreak-${party.key}-${member.sourceId}`"
                  class="defbreak-member"
                  :title="`${member.label} × ${member.count}`"
                >
                  <ClassIcon :class-id="member.classId" :size="18" :title="member.label" />
                  <span class="defbreak-count">×{{ member.count }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
        <p v-if="!debuffTable || !debuffTable.parties.length" class="empty">{{ emptyMessage }}</p>
        <template v-else>
          <div
            v-for="party in debuffTable.parties"
            :key="`debuff-party-${party.key}`"
            class="shield-party"
          >
            <header v-if="party.label" class="shield-party-head">{{ party.label }}</header>
            <div class="buff-matrix-scroll">
              <div
                class="grid-head grid-head--buff-matrix"
                :style="{ '--buff-cols': party.columns.length }"
              >
                <span>玩家</span>
                <span
                  v-for="column in party.columns"
                  :key="`col-${party.key}-${column.key}`"
                  class="shield-col"
                  :title="column.tooltip ?? column.label"
                >
                  <SkillIcon :skill-icon="column.icon" :size="16" :title="column.tooltip ?? column.label" />
                </span>
              </div>
              <div class="row-list">
                <article
                  v-for="row in party.rows"
                  :key="`debuff-${party.key}-${row.sourceId}`"
                  class="row"
                  :style="shieldRowStyle(row)"
                >
                  <div class="bar" />
                  <div
                    class="cells cells--buff-matrix"
                    :style="{ '--buff-cols': party.columns.length }"
                  >
                    <span class="identity" :title="row.label">
                      <ClassIcon :class-id="row.classId" :size="18" :title="row.label" />
                      <span class="name">{{ row.label }}</span>
                    </span>
                    <span
                      v-for="(cell, index) in row.cells"
                      :key="`cell-${party.columns[index].key}`"
                      class="num"
                      :class="cell != null && cell >= 0.85 ? 'buff-high' : cell != null && cell >= 0.5 ? 'buff-mid' : ''"
                    >
                      {{ buffCellText(cell) }}
                    </span>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </template>
      </section>
    </template>

    <template v-else-if="activeTab === 'shields'">
      <nav class="shield-subtabs no-drag interactive">
        <button
          v-for="tab in OVERLAY_SHIELD_TABS"
          :key="tab.id"
          type="button"
          class="shield-subtab"
          :class="{ active: shieldTab === tab.id }"
          :title="tab.title"
          @mousedown.stop
          @click.stop="setShieldTab(tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>
      <section class="rows shield-rows">
        <p v-if="!shieldTable || !shieldTable.parties.length" class="empty">{{ emptyMessage }}</p>
        <template v-else>
          <div
            v-for="party in shieldTable.parties"
            :key="`shield-party-${party.key}`"
            class="shield-party"
          >
            <header v-if="party.label" class="shield-party-head">{{ party.label }}</header>
            <div
              class="grid-head grid-head--shield-matrix"
              :style="{ '--shield-cols': party.columns.length }"
            >
              <span>玩家</span>
              <span class="num">合计</span>
              <span
                v-for="column in party.columns"
                :key="column.key"
                class="shield-col"
                :title="column.label"
              >
                <SkillIcon :skill-icon="column.icon" :size="18" :title="column.label" />
              </span>
            </div>
            <div class="row-list">
              <article
                v-for="row in party.rows"
                :key="`shield-${party.key}-${row.sourceId}`"
                class="row"
                :style="shieldRowStyle(row)"
              >
                <div class="bar" />
                <div
                  class="cells cells--shield-matrix"
                  :style="{ '--shield-cols': party.columns.length }"
                >
                  <span class="identity" :title="row.label">
                    <ClassIcon :class-id="row.classId" :size="20" :title="row.label" />
                    <span class="name">{{ row.label }}</span>
                  </span>
                  <span class="num shield-total">{{ row.total > 0 ? formatDamage(row.total) : '–' }}</span>
                  <span
                    v-for="(cell, index) in row.cells"
                    :key="party.columns[index].key"
                    class="num"
                  >
                    {{ cell != null ? formatDamage(cell) : '–' }}
                  </span>
                </div>
              </article>
            </div>
          </div>
        </template>
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
              <SkillIcon
                v-else-if="row.isEsther"
                :skill-icon="row.estherIcon"
                :size="compact ? 16 : 22"
                :title="row.label"
              />
              <ClassIcon
                v-else
                :class-id="row.classId"
                :size="compact ? 16 : 22"
                :title="row.label"
              />
              <span class="name">{{ row.label }}</span>
            </span>
            <span class="num">{{ formatDamage(row.damage) }}</span>
            <span class="num shield">{{ row.shieldDamage > 0 ? formatDamage(row.shieldDamage) : '–' }}</span>
            <span class="num stagger">{{ row.stagger > 0 ? formatDamage(row.stagger) : '–' }}</span>
            <template v-if="showSkillStatColumns">
              <span class="num share">{{ formatShare(row.share) }}</span>
              <span class="num">{{ formatPercent(row.critRate) }}</span>
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

    <footer v-if="!compact" class="footer no-drag interactive">
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

.projection-chip {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.55);
  border-radius: 4px;
  padding: 1px 5px;
  line-height: 1.3;
}

.icon-btn.projection-exit {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.45);
}

.raid-line {
  font-size: 10px;
  font-weight: 600;
  color: #93c5fd;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.shield-summary {
  color: #7dd3fc;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
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

.icon-btn svg {
  display: block;
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
  grid-template-columns: minmax(0, 1.45fr) 0.78fr 0.68fr 0.6fr 0.7fr 0.46fr;
  gap: 8px;
  align-items: center;
}

.grid-head--skills,
.row .cells--skills {
  grid-template-columns: minmax(0, 1.3fr) 0.66fr 0.6fr 0.5fr 0.42fr 0.42fr 0.42fr 0.42fr;
  gap: 5px;
  font-size: 9px;
}

.row .num.shield {
  color: #7dd3fc;
}

.row .num.stagger {
  color: #f0b860;
}

.grid-head--skills {
  font-size: 9px;
}

/* Buff matrix: the name column stays put while the (capped) synergy columns
   stretch to share the remaining row width evenly. The BUFF tab is limited to
   the top 8 icons, so `minmax(30px, 1fr)` spreads them left→right across the
   full width instead of clustering at the left with dead space. The 30px floor
   keeps the percentage values legible; if the overlay is too narrow to fit the
   floors, `min-width: max-content` forces the natural width and
   .buff-matrix-scroll scrolls horizontally.

   The name column is a FIXED width (not a flexible fr track) so the header grid
   and every row grid share identical column geometry — a long player label is
   clipped with an ellipsis (.name has overflow/ellipsis) and shown in full on
   hover via the cell's `title`, rather than widening one row out of alignment.
   With `width: 100%` every grid (header + each row) resolves to the same
   containing width, so the `1fr` tracks line up. */
.grid-head--buff-matrix,
.row .cells--buff-matrix {
  grid-template-columns: var(--buff-name-col, 160px) repeat(var(--buff-cols, 4), minmax(30px, 1fr));
  gap: 2px;
  width: 100%;
  min-width: max-content;
}

.buff-matrix-scroll {
  overflow-x: auto;
  overflow-y: hidden;
}

.buff-matrix-scroll .row-list {
  width: 100%;
  min-width: max-content;
}

.grid-head--buff-matrix {
  font-size: 9px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.45);
}

.grid-head--buff-matrix .shield-col {
  display: flex;
  justify-content: center;
}

.cells--buff-matrix .num {
  font-size: 9px;
  text-align: center;
  padding: 0;
}

.shield-subtabs {
  display: flex;
  gap: 3px;
  padding: 4px 8px;
  background: rgba(24, 24, 27, 0.85);
  border-bottom: 1px solid rgba(63, 63, 70, 0.55);
}

.shield-subtab {
  border: 0;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  color: #71717a;
  background: transparent;
  cursor: pointer;
}

.shield-subtab:hover {
  color: #d4d4d8;
  background: rgba(63, 63, 70, 0.55);
}

.shield-subtab.active {
  color: #fafafa;
  background: rgba(82, 82, 91, 0.95);
}

.shield-party {
  margin-bottom: 6px;
}

.shield-party-head {
  padding: 3px 10px 2px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #93c5fd;
}

.defbreak-panel {
  margin: 2px 6px 8px;
  padding: 4px 6px 6px;
  border: 1px solid rgba(248, 180, 95, 0.28);
  border-radius: 6px;
  background: rgba(120, 72, 20, 0.16);
}

.defbreak-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #f8b45f;
  margin-bottom: 4px;
}

.defbreak-parties {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.defbreak-party {
  flex: 1 1 0;
  min-width: 0;
}

.defbreak-party-head {
  font-size: 9px;
  font-weight: 700;
  color: #93c5fd;
  margin-bottom: 3px;
}

.defbreak-members {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
}

.defbreak-member {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.defbreak-count {
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fde6c4;
}

.grid-head--shield-matrix,
.row .cells--shield-matrix {
  grid-template-columns:
    minmax(0, 1.35fr) 0.68fr repeat(var(--shield-cols, 4), minmax(0, 0.58fr));
  gap: 4px;
}

.grid-head--shield-matrix {
  font-size: 9px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.45);
}

.grid-head--shield-matrix .shield-col {
  display: flex;
  justify-content: center;
}

.shield-total {
  font-weight: 600;
  color: #7ddf8f;
}

.cells--shield-matrix .num {
  font-size: 10px;
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
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* Keep the data columns visually centered: icon header cells and the value
   cells share the same centered alignment so columns no longer look ragged. */
.grid-head .shield-col,
.cells .shield-col {
  display: flex;
  align-items: center;
  justify-content: center;
}

.row .cells .num {
  display: flex;
  align-items: center;
  justify-content: center;
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

/* 缩略模式：收窄高度、缩小字体，仅保留标题栏 + 紧凑 DPS 列表 */
.meter-overlay.compact {
  border-radius: 6px;
}

.meter-overlay.compact .titlebar {
  padding: 4px 8px 3px;
  gap: 6px;
}

.meter-overlay.compact .title-left {
  gap: 1px;
}

.meter-overlay.compact .raid-line {
  font-size: 9px;
}

.meter-overlay.compact .boss,
.meter-overlay.compact .gate {
  font-size: 10px;
}

.meter-overlay.compact .summary {
  font-size: 8px;
}

.meter-overlay.compact .timer {
  font-size: 9px;
  margin-right: 2px;
}

.meter-overlay.compact .title-right {
  gap: 2px;
}

.meter-overlay.compact .icon-btn {
  width: 20px;
  height: 18px;
  border-radius: 5px;
}

.meter-overlay.compact .icon-btn svg {
  width: 11px;
  height: 11px;
}

.meter-overlay.compact .grid-head {
  padding: 2px 8px 3px;
  font-size: 8px;
}

.meter-overlay.compact .rows {
  padding: 2px 6px 4px;
}

.meter-overlay.compact .row {
  margin-bottom: 2px;
  min-height: 19px;
}

.meter-overlay.compact .row .cells {
  padding: 2px 8px;
  font-size: 9px;
}

.meter-overlay.compact .identity {
  gap: 4px;
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
