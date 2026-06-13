export function compactLogSnapshot(
  payload: Record<string, unknown>,
  metrics: {
    totalDamage: number
    dps: number
    hitCount: number
    critRate: number
    bossOnly: boolean
    bossKnown: boolean
    bossName: string
    rowCount: number
  }
): Record<string, unknown> {
  const summary =
    payload.summary && typeof payload.summary === 'object'
      ? (payload.summary as Record<string, unknown>)
      : {}

  return {
    time: new Date().toISOString(),
    encounterId: payload.encounterId,
    status: payload.status,
    serverBuild: payload.serverBuild,
    startedAt: payload.startedAt,
    updatedAt: payload.updatedAt,
    elapsedSeconds: payload.elapsedSeconds,
    lastResetAt: payload.lastResetAt,
    lastResetReason: payload.lastResetReason,
    summary: payload.summary,
    uiRows: payload.uiRows,
    selfSummary: payload.selfSummary,
    selfRows: payload.selfRows,
    allDamageSummary: payload.allDamageSummary,
    partyRoster: payload.partyRoster,
    display: {
      totalDamage: metrics.totalDamage,
      dps: metrics.dps,
      hitCount: metrics.hitCount,
      critRate: metrics.critRate,
      bossOnly: metrics.bossOnly,
      bossKnown: metrics.bossKnown,
      bossName: metrics.bossName,
      bossTargetIds: Array.isArray(summary.bossTargetIds) ? summary.bossTargetIds : [],
      rowCount: metrics.rowCount,
      skillRowCount: Array.isArray(payload.displaySkillTotals) ? payload.displaySkillTotals.length : 0
    },
    selfSkillTotals: payload.selfSkillTotals,
    selfSourceSkillRows: payload.selfSourceSkillRows,
    sourceTotals: payload.sourceTotals,
    skillTotals: payload.skillTotals,
    sourceSkillRows: payload.sourceSkillRows,
    displaySkillTotals: payload.displaySkillTotals,
    displaySourceTotals: payload.displaySourceTotals,
    displaySourceSkillRows: payload.displaySourceSkillRows
  }
}
