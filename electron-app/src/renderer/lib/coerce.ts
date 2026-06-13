export function coerceInt(value: unknown, fallback = 0): number {
  if (value == null) return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return Math.trunc(value)
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return fallback
    const parsed = Number.parseInt(text, text.startsWith('0x') ? 16 : 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

export function coerceFloat(value: unknown, fallback = 0): number {
  if (value == null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function coerceBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase())
  }
  return fallback
}
