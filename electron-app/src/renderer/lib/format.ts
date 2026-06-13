export function formatDamage(value: number): string {
  const number = Number(value)
  const abs = Math.abs(number)
  if (abs >= 100_000_000) {
    const amount = number / 100_000_000
    const digits = Math.abs(amount) >= 100 ? 1 : 2
    return `${amount.toFixed(digits).replace(/\.?0+$/, '')}亿`
  }
  if (abs >= 10_000) {
    const amount = number / 10_000
    const digits = Math.abs(amount) >= 100 ? 1 : 2
    return `${amount.toFixed(digits).replace(/\.?0+$/, '')}万`
  }
  return Math.round(number).toLocaleString('en-US')
}

export function formatRate(value: number): string {
  return `${formatDamage(value)}/秒`
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.trunc(seconds))
  const minutes = Math.floor(total / 60)
  const remaining = total % 60
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
  }
  return `${String(mins).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

export function formatRecordDate(startedAt: string): string {
  if (!startedAt) return '—'
  if (startedAt.length >= 16) {
    return startedAt.slice(5, 16).replace('T', ' ')
  }
  return startedAt
}
