import {
  SETTINGS_REGISTRY,
  type SettingsEntry,
  type SettingsTab
} from "@/features/settings/settings-registry"

export type SearchTranslate = (key: string) => unknown

export type SettingsSearchSourceType =
  | "label"
  | "description"
  | "field"
  | "alias"

export interface SettingsSearchRecord {
  entry: SettingsEntry
  entryId: string
  focusId: string
  tab: SettingsTab
  sectionId: string
  sourceKey?: string
  sourceText: string
  displayLabel: string
  displayContext?: string
  sourceType: SettingsSearchSourceType
  registryOrder: number
  sourceOrder: number
}

export interface RankedSettingsSearchRecord {
  record: SettingsSearchRecord
  score: number
}

const SOURCE_TYPE_ORDER: Record<SettingsSearchSourceType, number> = {
  label: 0,
  field: 1,
  description: 2,
  alias: 3
}

const MAX_RECORDS_PER_FOCUS_ID = 2

export const normalizeSettingsSearchText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

const isResolvedText = (key: string, value: unknown): value is string => {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed === key) return false
  if (trimmed.includes("{{")) return false
  return true
}

const resolveText = (key: string, translate?: SearchTranslate) => {
  if (!translate) return key
  const value = translate(key)
  return isResolvedText(key, value) ? value.trim() : undefined
}

const makeRecord = ({
  entry,
  registryOrder,
  sourceOrder,
  sourceType,
  sourceText,
  sourceKey,
  parentLabel
}: {
  entry: SettingsEntry
  registryOrder: number
  sourceOrder: number
  sourceType: SettingsSearchSourceType
  sourceText: string
  sourceKey?: string
  parentLabel: string
}): SettingsSearchRecord => {
  const displayLabel = sourceType === "alias" ? parentLabel : sourceText
  const displayContext = sourceType === "label" ? undefined : parentLabel
  return {
    entry,
    entryId: entry.id,
    focusId: entry.focusId ?? entry.id,
    tab: entry.tab,
    sectionId: entry.sectionId,
    sourceKey,
    sourceText,
    displayLabel,
    displayContext,
    sourceType,
    registryOrder,
    sourceOrder
  }
}

export const buildSettingsSearchRecords = (
  entries: SettingsEntry[] = SETTINGS_REGISTRY,
  translate?: SearchTranslate
): SettingsSearchRecord[] => {
  const records: SettingsSearchRecord[] = []

  entries.forEach((entry, registryOrder) => {
    const parentLabel = resolveText(entry.labelKey, translate) ?? entry.labelKey
    let sourceOrder = 0

    const addKey = (
      key: string | undefined,
      sourceType: SettingsSearchSourceType
    ) => {
      if (!key) return
      const sourceText = resolveText(key, translate)
      if (!sourceText) return
      records.push(
        makeRecord({
          entry,
          registryOrder,
          sourceOrder,
          sourceType,
          sourceText,
          sourceKey: key,
          parentLabel
        })
      )
      sourceOrder += 1
    }

    addKey(entry.labelKey, "label")
    addKey(entry.descriptionKey, "description")
    for (const key of entry.searchKeys ?? []) addKey(key, "field")

    const aliases = [...(entry.aliases ?? []), ...(entry.keywords ?? [])]
    for (const alias of aliases) {
      const sourceText = alias.trim()
      if (!sourceText || sourceText.includes("{{")) continue
      records.push(
        makeRecord({
          entry,
          registryOrder,
          sourceOrder,
          sourceType: "alias",
          sourceText,
          parentLabel
        })
      )
      sourceOrder += 1
    }
  })

  return records
}

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = Array.from({ length: b.length + 1 }, () => 0)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      )
    }
    ;[previous, current] = [current, previous]
  }

  return previous[b.length]
}

const fuzzyThreshold = (token: string): number => {
  if (token.length < 3) return 0
  if (token.length <= 5) return 1
  return 2
}

const scoreToken = (
  token: string,
  haystack: string,
  words: string[]
): number => {
  if (words.includes(token)) return 40
  if (words.some((word) => word.startsWith(token))) return 28
  if (haystack.includes(token)) return 20

  const threshold = fuzzyThreshold(token)
  if (threshold === 0) return 0

  const hasFuzzyWord = words.some(
    (word) =>
      Math.abs(word.length - token.length) <= threshold &&
      levenshteinDistance(token, word) <= threshold
  )

  return hasFuzzyWord ? 8 : 0
}

const getRecordHaystack = (record: SettingsSearchRecord) =>
  normalizeSettingsSearchText(
    [record.sourceText, record.displayLabel].join(" ")
  )

const rankRecord = (
  record: SettingsSearchRecord,
  normalizedQuery: string,
  tokens: string[],
  activeTab?: SettingsTab
) => {
  const haystack = getRecordHaystack(record)
  const words = haystack.split(/\s+/).filter(Boolean)
  const phraseScore = haystack.includes(normalizedQuery) ? 100 : 0
  const tokenScore = tokens.reduce(
    (total, token) => total + scoreToken(token, haystack, words),
    0
  )
  const activeTabScore = activeTab && activeTab === record.tab ? 3 : 0
  const aliasPenalty = record.sourceType === "alias" ? -2 : 0
  return phraseScore + tokenScore + activeTabScore + aliasPenalty
}

const capRecordsPerFocusId = (
  ranked: RankedSettingsSearchRecord[]
): RankedSettingsSearchRecord[] => {
  const counts = new Map<string, number>()
  const labels = new Map<string, Set<string>>()
  return ranked.filter(({ record }) => {
    const normalizedLabel = normalizeSettingsSearchText(record.displayLabel)
    const focusLabels = labels.get(record.focusId) ?? new Set<string>()
    if (focusLabels.has(normalizedLabel)) return false

    const count = counts.get(record.focusId) ?? 0
    if (count >= MAX_RECORDS_PER_FOCUS_ID) return false

    focusLabels.add(normalizedLabel)
    labels.set(record.focusId, focusLabels)
    counts.set(record.focusId, count + 1)
    return true
  })
}

export const rankSettingsSearchRecords = (
  query: string,
  records: SettingsSearchRecord[],
  activeTab?: SettingsTab
): RankedSettingsSearchRecord[] => {
  const normalizedQuery = normalizeSettingsSearchText(query)
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  const ranked = records
    .map((record) => ({
      record,
      score: rankRecord(record, normalizedQuery, tokens, activeTab)
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        SOURCE_TYPE_ORDER[a.record.sourceType] -
          SOURCE_TYPE_ORDER[b.record.sourceType] ||
        a.record.registryOrder - b.record.registryOrder ||
        a.record.sourceOrder - b.record.sourceOrder
    )

  return capRecordsPerFocusId(ranked)
}
