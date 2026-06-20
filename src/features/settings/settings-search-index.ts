import {
  SETTINGS_REGISTRY,
  type SettingsEntry,
  type SettingsTab
} from "@/features/settings/settings-registry"
import {
  normalizeSettingsSearchText,
  scoreSettingsSearchToken
} from "@/features/settings/settings-search-scoring"

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
    (total, token) => total + scoreSettingsSearchToken(token, haystack, words),
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
