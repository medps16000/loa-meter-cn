const skillModules = import.meta.glob('../assets/skills/*.png', {
  eager: true,
  import: 'default'
}) as Record<string, string>

const ICON_BY_FILENAME = new Map<string, string>()
for (const [path, url] of Object.entries(skillModules)) {
  const match = path.match(/\/([^/]+\.png)$/)
  if (!match) continue
  ICON_BY_FILENAME.set(match[1], url)
}

export function normalizeSkillIconName(value: unknown): string | null {
  const name = String(value ?? '').trim()
  if (!name || name === 'unknown.png') return null
  return name
}

export function skillIconSrc(skillIcon: string | null | undefined): string | null {
  const name = normalizeSkillIconName(skillIcon)
  if (!name) return ICON_BY_FILENAME.get('unknown.png') ?? null
  return ICON_BY_FILENAME.get(name) ?? ICON_BY_FILENAME.get('unknown.png') ?? null
}
