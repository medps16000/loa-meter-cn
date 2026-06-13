import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let launcherProcess: ChildProcess | null = null

function localAppDataRoot(): string {
  const base = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? app.getPath('home')
  return join(base, 'LOA_METER_CN')
}

function backendRoot(): string {
  return join(process.resourcesPath, 'backend')
}

export function defaultMeterBaseUrl(): string {
  return process.env.METER_BASE_URL ?? 'http://127.0.0.1:8765'
}

export function configurePackagedMeterEnvironment(): void {
  const baseUrl = defaultMeterBaseUrl()
  process.env.METER_BASE_URL = baseUrl
  process.env.METER_STATE_URL = process.env.METER_STATE_URL ?? `${baseUrl}/state.json`
  process.env.METER_STREAM_URL = process.env.METER_STREAM_URL ?? `${baseUrl}/state/stream`
  process.env.METER_RESET_URL = process.env.METER_RESET_URL ?? `${baseUrl}/reset`
  process.env.METER_SHUTDOWN_URL = process.env.METER_SHUTDOWN_URL ?? `${baseUrl}/shutdown`
  process.env.METER_DB_PATH = process.env.METER_DB_PATH ?? join(localAppDataRoot(), 'encounters.db')
  process.env.METER_RUN_DIR = process.env.METER_RUN_DIR ?? join(localAppDataRoot(), 'runs')
}

export function startPackagedBackend(): void {
  if (!app.isPackaged || process.env.LOA_METER_EXTERNAL_BACKEND === '1') return

  const root = backendRoot()
  const launcher = process.env.LOA_METER_BACKEND_EXE ?? join(root, 'dist', 'LOA_METER_BACKEND.exe')
  if (!existsSync(launcher)) {
    console.error(`[backend-runtime] launcher missing: ${launcher}`)
    return
  }

  const args = [
    '--root',
    root,
    '--no-player-ui',
    '--meter-port',
    '8765',
    '--run-root',
    join(localAppDataRoot(), 'runs')
  ]

  launcherProcess = spawn(launcher, args, {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1'
    }
  })
  launcherProcess.unref()
}

export function forgetPackagedBackendProcess(): void {
  launcherProcess = null
}
