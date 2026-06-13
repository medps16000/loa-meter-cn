import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { parseHistoricalPayload, parseMeterPayload, type DisplayState } from '../lib/meter-display'

type EncounterSummary = {
  id: number
  startedAt: string
  bossName: string
  totalDamage: number
  dps: number
  durationSeconds: number
  status: string
}

export const useMeterStore = defineStore('meter', () => {
  const rawState = ref<Record<string, unknown> | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  const viewMode = ref<'live' | 'historical'>('live')
  const selectedEncounterId = ref<number | null>(null)
  const historicalDisplay = ref<DisplayState | null>(null)
  const historicalRawState = ref<Record<string, unknown> | null>(null)
  const recentEncounters = ref<EncounterSummary[]>([])

  // Raw payload backing the active view (live or historical) so secondary
  // panels (buff contribution / shield stats) can parse extra fields.
  const activeRawState = computed<Record<string, unknown> | null>(() => {
    if (viewMode.value === 'historical') return historicalRawState.value
    return rawState.value
  })

  const display = computed<DisplayState | null>(() => {
    if (viewMode.value === 'historical' && historicalDisplay.value) {
      if (error.value) {
        return { ...historicalDisplay.value, error: error.value }
      }
      return historicalDisplay.value
    }
    if (!rawState.value) return null
    const parsed = parseMeterPayload(rawState.value, { limit: 12, bossOnly: true })
    if (error.value) {
      return { ...parsed, error: error.value }
    }
    return parsed
  })

  const status = computed(() => display.value?.status ?? 'unknown')

  function applyState(state: Record<string, unknown>): void {
    if (viewMode.value === 'historical') return
    rawState.value = state
    error.value = null
    loading.value = false
    if (state.encounterComplete === true || state.status === 'encounter_complete') {
      void loadRecentEncounters()
    }
  }

  async function refresh(): Promise<void> {
    if (viewMode.value === 'historical' && selectedEncounterId.value != null) {
      await selectHistoricalEncounter(selectedEncounterId.value)
      return
    }
    loading.value = true
    try {
      rawState.value = await window.meterApi.fetchState()
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadRecentEncounters(): Promise<void> {
    try {
      recentEncounters.value = (await window.encountersApi.list(5)) as EncounterSummary[]
    } catch {
      // keep live recentEncounters from meter state when db is unavailable
    }
  }

  async function selectLiveView(): Promise<void> {
    viewMode.value = 'live'
    selectedEncounterId.value = null
    historicalDisplay.value = null
    historicalRawState.value = null
    await refresh()
  }

  async function selectHistoricalEncounter(id: number): Promise<void> {
    viewMode.value = 'historical'
    selectedEncounterId.value = id
    loading.value = true
    try {
      const payload = (await window.encountersApi.get(id)) as {
        startedAt?: string
        closedAt?: string | null
        finalState?: Record<string, unknown> | null
      } | null
      if (payload?.finalState) {
        historicalRawState.value = payload.finalState
        historicalDisplay.value = parseHistoricalPayload(
          {
            startedAt: payload.startedAt,
            closedAt: payload.closedAt,
            finalState: payload.finalState,
            bossOnly: true
          },
          { limit: 12 }
        )
        error.value = null
      } else {
        historicalDisplay.value = null
        historicalRawState.value = null
        error.value = '该战斗记录没有可用的明细数据'
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      historicalDisplay.value = null
      historicalRawState.value = null
    } finally {
      loading.value = false
    }
  }

  async function reset(): Promise<void> {
    await window.meterApi.reset()
    await selectLiveView()
  }

  return {
    rawState,
    activeRawState,
    display,
    error,
    loading,
    status,
    viewMode,
    selectedEncounterId,
    recentEncounters,
    applyState,
    refresh,
    reset,
    loadRecentEncounters,
    selectLiveView,
    selectHistoricalEncounter
  }
})
