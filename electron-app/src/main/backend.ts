import { app } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Optional bundled backend. Public builds do not include the backend binary;
// full release packages can place a compatible launcher under
// resources/backend/dist and expose state on 127.0.0.1:8765.

let started = false

function dataDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || app.getPath('home')
  return join(base, 'LOA_METER_CN')
}

function log(message: string): void {
  try {
    const file = join(dataDir(), 'electron-backend.log')
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // never let logging break startup
  }
}

export function backendRoot(): string {
  return join(process.resourcesPath, 'backend')
}

function launcherExe(): string {
  return process.env.LOA_METER_BACKEND_EXE ?? join(backendRoot(), 'dist', 'LOA_METER_BACKEND.exe')
}

function launcherArgs(): string[] {
  const raw = process.env.LOA_METER_BACKEND_ARGS
  if (!raw) return []
  return raw
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function startBackend(): void {
  if (started) return
  if (!app.isPackaged) {
    log('skip startBackend: not packaged (dev — backend started by Python launcher)')
    return
  }
  if (process.platform !== 'win32') {
    log(`skip startBackend: platform=${process.platform}`)
    return
  }
  const root = backendRoot()
  const exe = launcherExe()
  log(`startBackend: resourcesPath=${process.resourcesPath} exe=${exe} exists=${existsSync(exe)}`)
  if (!existsSync(exe)) {
    log('ERROR: backend launcher not found; capture cannot start')
    return
  }
  started = true
  log(`spawning launcher (self-elevating): ${exe}`)
  try {
    const child = spawn(exe, launcherArgs(), {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', (err) => {
      log(`spawn error: ${String(err)}`)
      started = false
    })
    child.unref()
  } catch (err) {
    log(`spawn threw: ${String(err)}`)
    started = false
  }
}

export async function stopBackend(): Promise<void> {
  if (!app.isPackaged) return
  // The backend can run as a separate elevated process, so request a graceful
  // shutdown over HTTP rather than assuming it is a direct child.
  const base = process.env.METER_BASE_URL ?? 'http://127.0.0.1:8765'
  try {
    await fetch(`${base}/shutdown`, { method: 'POST' })
    log('stopBackend: sent /shutdown')
  } catch {
    log('stopBackend: /shutdown failed (backend already stopped?)')
  }
}
