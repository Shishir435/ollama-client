import type { ModelPreferenceKind } from "@/lib/repositories/model-preferences"

/**
 * In-memory stand-in for `@/lib/repositories/model-preferences`, for unit
 * tests that exercise a reader or writer rather than SQLite itself:
 *
 *   vi.mock("@/lib/repositories/model-preferences", () =>
 *     import("@/test/model-preferences-fake")
 *   )
 *
 * Seed with `seedModelPreferences("config", { "ollama::m": {...} })` and reset
 * with `resetModelPreferences()` in `beforeEach`.
 */
const store = new Map<ModelPreferenceKind, Map<string, unknown>>()
type Listener = (kind: ModelPreferenceKind) => void
const listeners = new Set<Listener>()

const table = (kind: ModelPreferenceKind) => {
  let rows = store.get(kind)
  if (!rows) {
    rows = new Map()
    store.set(kind, rows)
  }
  return rows
}

const notify = (kind: ModelPreferenceKind) => {
  for (const listener of listeners) listener(kind)
}

export const resetModelPreferences = (): void => {
  store.clear()
  listeners.clear()
}

export const seedModelPreferences = (
  kind: ModelPreferenceKind,
  entries: Record<string, unknown>
): void => {
  const rows = table(kind)
  rows.clear()
  for (const [key, value] of Object.entries(entries)) {
    rows.set(key, structuredClone(value))
  }
}

export const readModelPreferencesSnapshot = (
  kind: ModelPreferenceKind
): Record<string, unknown> => Object.fromEntries(table(kind))

export const subscribeModelPreferences = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const listModelPreferences = async <T>(
  kind: ModelPreferenceKind
): Promise<Record<string, T>> =>
  structuredClone(Object.fromEntries(table(kind))) as Record<string, T>

export const getModelPreferences = async <T>(
  kind: ModelPreferenceKind,
  keys: readonly string[]
): Promise<Record<string, T>> => {
  const rows = table(kind)
  const result: Record<string, T> = {}
  for (const key of keys) {
    if (rows.has(key)) result[key] = structuredClone(rows.get(key)) as T
  }
  return result
}

export const updateModelPreference = async <T>(
  kind: ModelPreferenceKind,
  key: string,
  update: (current: T | undefined) => T | null | undefined
): Promise<void> => {
  const rows = table(kind)
  const next = update(structuredClone(rows.get(key)) as T | undefined)
  if (next === undefined) return
  if (next === null) {
    if (!rows.delete(key)) return
  } else {
    rows.set(key, structuredClone(next))
  }
  notify(kind)
}

export const deleteModelPreferencesWithPrefix = async (
  kind: ModelPreferenceKind,
  prefix: string
): Promise<void> => {
  const rows = table(kind)
  for (const key of Array.from(rows.keys())) {
    if (key.startsWith(prefix)) rows.delete(key)
  }
  notify(kind)
}
