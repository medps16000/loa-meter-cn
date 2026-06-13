import { OfflineMeterReplay, type OfflineReplayInfo } from './offline-meter-replay'

export type MeterState = Record<string, unknown>
export type MeterStateListener = (state: MeterState) => void

function streamUrlFromStateUrl(stateUrl: string): string {
  if (stateUrl.endsWith('/state.json')) {
    return `${stateUrl.slice(0, -'/state.json'.length)}/state/stream`
  }
  const base = stateUrl.replace(/\/$/, '')
  return `${base}/state/stream`
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (!dataLines.length) return null
  return { event, data: dataLines.join('\n') }
}

export class MeterClient {
  readonly #stateUrl: string
  readonly #streamUrl: string
  readonly #resetUrl: string
  readonly #shutdownUrl: string
  readonly #offline: OfflineMeterReplay | null
  readonly #listeners = new Set<MeterStateListener>()

  #latestState: MeterState | null = null
  #streamAbort: AbortController | null = null
  #streamGeneration = 0
  #offlineTimer: ReturnType<typeof setInterval> | null = null
  #started = false

  constructor(options?: {
    stateUrl?: string
    streamUrl?: string
    resetUrl?: string
    shutdownUrl?: string
    offline?: OfflineMeterReplay | null
  }) {
    const base = process.env.METER_BASE_URL ?? 'http://127.0.0.1:8765'
    this.#stateUrl = options?.stateUrl ?? process.env.METER_STATE_URL ?? `${base}/state.json`
    this.#streamUrl =
      options?.streamUrl ??
      process.env.METER_STREAM_URL ??
      streamUrlFromStateUrl(this.#stateUrl)
    this.#resetUrl = options?.resetUrl ?? process.env.METER_RESET_URL ?? `${base}/reset`
    this.#shutdownUrl =
      options?.shutdownUrl ?? process.env.METER_SHUTDOWN_URL ?? `${base}/shutdown`
    this.#offline = options?.offline ?? OfflineMeterReplay.tryCreate()
  }

  get offlineInfo(): OfflineReplayInfo | null {
    return this.#offline?.info ?? null
  }

  get isOffline(): boolean {
    return this.#offline != null
  }

  get latestState(): MeterState | null {
    return this.#latestState
  }

  onStateChange(listener: MeterStateListener): () => void {
    this.#listeners.add(listener)
    if (this.#latestState) {
      listener(this.#latestState)
    }
    return () => {
      this.#listeners.delete(listener)
    }
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    if (this.#offline) {
      this.#startOfflinePolling()
      return
    }
    void this.#consumeSseLoop()
    void this.fetchState()
      .then((state) => this.#emit(state))
      .catch(() => {
        // SSE or a later fetch will recover.
      })
  }

  stop(): void {
    this.#started = false
    this.#streamGeneration += 1
    this.#streamAbort?.abort()
    this.#streamAbort = null
    if (this.#offlineTimer) {
      clearInterval(this.#offlineTimer)
      this.#offlineTimer = null
    }
  }

  async fetchState(): Promise<MeterState> {
    if (this.#offline) {
      return this.#offline.fetchState()
    }
    const response = await fetch(this.#stateUrl, {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) {
      throw new Error(`state.json ${response.status}`)
    }
    const state = (await response.json()) as MeterState
    this.#emit(state)
    return state
  }

  async reset(): Promise<void> {
    if (this.#offline) {
      this.#offline.reset()
      this.#emit(this.#offline.fetchState())
      return
    }
    const response = await fetch(this.#resetUrl, { method: 'POST' })
    if (!response.ok) {
      throw new Error(`reset ${response.status}`)
    }
    await this.fetchState()
  }

  async shutdown(): Promise<void> {
    if (this.#offline) {
      this.#offline.shutdown()
      return
    }
    const response = await fetch(this.#shutdownUrl, { method: 'POST' })
    if (!response.ok) {
      throw new Error(`shutdown ${response.status}`)
    }
  }

  #emit(state: MeterState): void {
    this.#latestState = state
    for (const listener of this.#listeners) {
      listener(state)
    }
  }

  #startOfflinePolling(): void {
    const poll = (): void => {
      if (!this.#offline) return
      this.#emit(this.#offline.fetchState())
    }
    poll()
    this.#offlineTimer = setInterval(poll, 500)
  }

  async #consumeSseLoop(): Promise<void> {
    const generation = this.#streamGeneration
    while (this.#started && generation === this.#streamGeneration) {
      try {
        await this.#consumeSseOnce(generation)
      } catch {
        if (!this.#started || generation !== this.#streamGeneration) return
        await this.#sleep(1000)
      }
    }
  }

  async #consumeSseOnce(generation: number): Promise<void> {
    const abort = new AbortController()
    this.#streamAbort?.abort()
    this.#streamAbort = abort

    const response = await fetch(this.#streamUrl, {
      headers: { Accept: 'text/event-stream' },
      signal: abort.signal
    })
    if (!response.ok || !response.body) {
      throw new Error(`state/stream ${response.status}`)
    }

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ''

    while (this.#started && generation === this.#streamGeneration) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let splitAt = buffer.indexOf('\n\n')
      while (splitAt >= 0) {
        const block = buffer.slice(0, splitAt)
        buffer = buffer.slice(splitAt + 2)
        const parsed = parseSseBlock(block)
        if (parsed?.event === 'state' && parsed.data) {
          try {
            this.#emit(JSON.parse(parsed.data) as MeterState)
          } catch {
            // Ignore malformed payloads.
          }
        }
        splitAt = buffer.indexOf('\n\n')
      }
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
