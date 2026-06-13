type SourceTotalRow = Record<string, unknown>

function coerceInt(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.trunc(parsed)
}

function firstNonempty(row: SourceTotalRow, keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] ?? '').trim()
    if (value) return value
  }
  return ''
}

export function isLikelyPlayerName(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2 || trimmed.length > 20) return false

  let hasCjk = false
  let hasAlnum = false
  const allowedPunctuation = new Set(['·', '・'])

  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x4e00 && code <= 0x9fff) {
      hasCjk = true
      continue
    }
    if (allowedPunctuation.has(char)) continue
    if (/[A-Za-z0-9_\- ]/.test(char)) {
      if (/[A-Za-z0-9]/.test(char)) hasAlnum = true
      continue
    }
    return false
  }

  if (hasCjk) return true
  const compact = trimmed.replace(/[_\- ]/g, '')
  return hasAlnum && /[A-Za-z]/.test(compact) && !/^\d+$/.test(compact)
}

function isPlausibleCharacterId(value: number | null): boolean {
  if (value == null || value <= 0) return false
  return value >= 1_000_000_000_000
}

function playerIdentityMergeKey(row: SourceTotalRow): { kind: 'character' | 'name'; value: number | string } | null {
  let characterId = coerceInt(row.characterIdDec)
  if (characterId == null) {
    const characterIdHex = String(row.characterId ?? '').trim()
    if (characterIdHex.toLowerCase().startsWith('0x')) {
      characterId = coerceInt(parseInt(characterIdHex, 16))
    }
  }
  if (isPlausibleCharacterId(characterId)) {
    return { kind: 'character', value: characterId as number }
  }

  const playerName = firstNonempty(row, ['playerName', 'sourceName', 'characterName', 'sourceLabel'])
  if (playerName && isLikelyPlayerName(playerName)) {
    return { kind: 'name', value: playerName }
  }
  return null
}

function mergeSkillBreakdownRows(skillRows: SourceTotalRow[]): SourceTotalRow[] {
  const grouped = new Map<string, SourceTotalRow[]>()
  for (const row of skillRows) {
    const skillId = coerceInt(row.skillId) ?? 0
    const sourceId = coerceInt(row.sourceId) ?? 0
    const key = `${skillId}:${sourceId}`
    const bucket = grouped.get(key)
    if (bucket) bucket.push(row)
    else grouped.set(key, [row])
  }

  const merged: SourceTotalRow[] = []
  for (const rows of grouped.values()) {
    const base = { ...rows[0] }
    base.totalDamage = rows.reduce((sum, row) => sum + (coerceInt(row.totalDamage) ?? 0), 0)
    base.hitCount = rows.reduce((sum, row) => sum + (coerceInt(row.hitCount) ?? 0), 0)
    base.critCount = rows.reduce((sum, row) => sum + (coerceInt(row.critCount) ?? 0), 0)
    const hitCount = coerceInt(base.hitCount) ?? 0
    const critCount = coerceInt(base.critCount) ?? 0
    base.critRate = hitCount > 0 ? Math.round((critCount / hitCount) * 1_000_000) / 1_000_000 : 0
    const backAttackCount = rows.reduce(
      (sum, row) => sum + (coerceInt(row.backAttackCount) ?? 0),
      0
    )
    const headAttackCount = rows.reduce(
      (sum, row) => sum + (coerceInt(row.headAttackCount) ?? 0),
      0
    )
    const frontAttackCount = rows.reduce(
      (sum, row) => sum + (coerceInt(row.frontAttackCount) ?? 0),
      0
    )
    const modifierHitCount = backAttackCount + headAttackCount + frontAttackCount
    base.backAttackCount = backAttackCount
    base.headAttackCount = headAttackCount
    base.frontAttackCount = frontAttackCount
    base.modifierHitCount = modifierHitCount
    const modifierDenom = hitCount > 0 ? hitCount : modifierHitCount
    base.backAttackRate =
      modifierDenom > 0 ? Math.round((backAttackCount / modifierDenom) * 1_000_000) / 1_000_000 : null
    base.headAttackRate =
      modifierDenom > 0 ? Math.round((headAttackCount / modifierDenom) * 1_000_000) / 1_000_000 : null
    base.frontAttackRate =
      modifierDenom > 0 ? Math.round((frontAttackCount / modifierDenom) * 1_000_000) / 1_000_000 : null
    base.rowCount = rows.reduce((sum, row) => sum + (coerceInt(row.rowCount) ?? 0), 0)
    base.unresolvedRowCount = rows.reduce(
      (sum, row) => sum + (coerceInt(row.unresolvedRowCount) ?? 0),
      0
    )
    const sourceIds = [
      ...new Set(
        rows
          .map((row) => coerceInt(row.sourceId))
          .filter((value): value is number => value != null)
      )
    ].sort((a, b) => a - b)
    if (sourceIds.length > 1) base.sourceIds = sourceIds
    merged.push(base)
  }

  merged.sort((a, b) => {
    const damageDiff = (coerceInt(b.totalDamage) ?? 0) - (coerceInt(a.totalDamage) ?? 0)
    if (damageDiff !== 0) return damageDiff
    return (coerceInt(a.skillId) ?? 0) - (coerceInt(b.skillId) ?? 0)
  })
  return merged
}

export function mergeSourceTotalRowsByPlayerIdentity(rows: SourceTotalRow[]): SourceTotalRow[] {
  if (!Array.isArray(rows) || rows.length <= 1) return rows

  const grouped = new Map<string, SourceTotalRow[]>()
  const ungrouped: SourceTotalRow[] = []

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const mergeKey = playerIdentityMergeKey(row)
    if (!mergeKey) {
      ungrouped.push(row)
      continue
    }
    const key = `${mergeKey.kind}:${mergeKey.value}`
    const bucket = grouped.get(key)
    if (bucket) bucket.push(row)
    else grouped.set(key, [row])
  }

  const mergedRows: SourceTotalRow[] = []
  for (const [key, group] of grouped.entries()) {
    if (group.length === 1) {
      mergedRows.push(group[0])
      continue
    }

    if (key.startsWith('name:')) {
      const characterIds = new Set(
        group
          .map((row) => coerceInt(row.characterIdDec))
          .filter((value): value is number => isPlausibleCharacterId(value))
      )
      if (characterIds.size > 1) {
        mergedRows.push(...group)
        continue
      }
    }

    const canonical = group.reduce((best, row) => {
      const bestDamage = coerceInt(best.totalDamage) ?? 0
      const rowDamage = coerceInt(row.totalDamage) ?? 0
      if (rowDamage !== bestDamage) return rowDamage > bestDamage ? row : best
      const bestSourceId = coerceInt(best.sourceId) ?? Number.MAX_SAFE_INTEGER
      const rowSourceId = coerceInt(row.sourceId) ?? Number.MAX_SAFE_INTEGER
      return rowSourceId < bestSourceId ? row : best
    }, group[0])

    const combined: SourceTotalRow = { ...canonical }
    combined.totalDamage = group.reduce((sum, row) => sum + (coerceInt(row.totalDamage) ?? 0), 0)
    combined.hitCount = group.reduce((sum, row) => sum + (coerceInt(row.hitCount) ?? 0), 0)
    combined.critCount = group.reduce((sum, row) => sum + (coerceInt(row.critCount) ?? 0), 0)
    const hitCount = coerceInt(combined.hitCount) ?? 0
    const critCount = coerceInt(combined.critCount) ?? 0
    combined.critRate = hitCount > 0 ? Math.round((critCount / hitCount) * 1_000_000) / 1_000_000 : 0

    const skillBreakdown = group.flatMap((row) =>
      Array.isArray(row.skillBreakdown)
        ? row.skillBreakdown.filter((item) => item && typeof item === 'object')
        : []
    ) as SourceTotalRow[]
    if (skillBreakdown.length) {
      const mergedSkillBreakdown = mergeSkillBreakdownRows(skillBreakdown)
      const playerTotalDamage = coerceInt(combined.totalDamage) ?? 0
      if (playerTotalDamage > 0) {
        for (const skillRow of mergedSkillBreakdown) {
          const skillDamage = coerceInt(skillRow.totalDamage) ?? 0
          skillRow.damageShare =
            Math.round((skillDamage / playerTotalDamage) * 1_000_000) / 1_000_000
        }
      }
      combined.skillBreakdown = mergedSkillBreakdown
      combined.skillCount = new Set(
        mergedSkillBreakdown
          .map((skillRow: SourceTotalRow) => coerceInt(skillRow.skillId))
          .filter((value: number | null): value is number => value != null)
      ).size
      const topSkill = mergedSkillBreakdown[0]
      combined.topSkillId = topSkill?.skillId ?? null
      combined.topSkillDamage = topSkill?.totalDamage ?? 0
    }

    const sourceIds = [
      ...new Set(
        group
          .map((row) => coerceInt(row.sourceId))
          .filter((value): value is number => value != null)
      )
    ].sort((a, b) => a - b)
    const originalSourceIds = new Set(sourceIds)
    for (const row of group) {
      if (!Array.isArray(row.originalSourceIds)) continue
      for (const originalSourceId of row.originalSourceIds) {
        const parsed = coerceInt(originalSourceId)
        if (parsed != null) originalSourceIds.add(parsed)
      }
    }
    if (sourceIds.length > 1) combined.sourceIds = sourceIds
    if (originalSourceIds.size > 1) {
      combined.originalSourceIds = [...originalSourceIds].sort((a, b) => a - b)
    }
    combined.playerIdentityMerged = true
    combined.mergedSourceCount = group.length
    mergedRows.push(combined)
  }

  mergedRows.push(...ungrouped)
  mergedRows.sort((a, b) => {
    const damageDiff = (coerceInt(b.totalDamage) ?? 0) - (coerceInt(a.totalDamage) ?? 0)
    if (damageDiff !== 0) return damageDiff
    return (coerceInt(a.sourceId) ?? 0) - (coerceInt(b.sourceId) ?? 0)
  })
  return mergedRows
}
