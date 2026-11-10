import { z } from "zod"
import { browser } from "@/lib/browser-api"
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { compactModelConfig, ModelConfigSchema } from "@/lib/model-config-utils"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import type { SqlExecutor } from "@/lib/sqlite/db"
import { flushSave, query, run, withTransaction } from "@/lib/sqlite/db"
import { withModelPreferenceImportLock } from "@/lib/storage/model-preference-import-lock"
import {
  ModelCapabilityOverrideSchema,
  ToolFamilyOverrideSchema
} from "@/lib/storage/policy-setting-schemas"
import { decodeRows } from "./row-decoder"

/**
 * Per-model preferences in SQLite, one row per kind and
 * `${providerId}::${model}` key (or a bare model name, for configs written
 * before keys were provider-scoped).
 *
 * All three lived in storage.sync as one JSON map each. Those maps grow with
 * every model a user touches, and the model-config map hit the 8 KB per-item
 * quota — after which every write was refused and the UI rolled back. A row
 * per model has no such ceiling, and a write touches one row rather than
 * rewriting everyone's.
 */
export type ModelPreferenceKind = "config" | "capabilities" | "tools"

const TABLE = "model_preferences" as const

interface PreferenceSource {
  schema: z.ZodType
  /** Sync keys this kind is imported from, newest first. */
  syncKeys: readonly string[]
  /** Normalize a value before it is stored. */
  compact?: (value: never) => unknown
}

const SOURCES: Record<ModelPreferenceKind, PreferenceSource> = {
  config: {
    schema: ModelConfigSchema,
    syncKeys: [
      STORAGE_KEYS.PROVIDER.MODEL_CONFIGS,
      LEGACY_STORAGE_KEYS.OLLAMA.MODEL_CONFIGS
    ],
    compact: compactModelConfig
  },
  capabilities: {
    schema: ModelCapabilityOverrideSchema,
    syncKeys: [STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES]
  },
  tools: {
    schema: ToolFamilyOverrideSchema,
    syncKeys: [STORAGE_KEYS.TOOLS.MODEL_OVERRIDES]
  }
}

const RowSchema = z.object({ key: z.string().min(1), value: z.string() })

const compact = (kind: ModelPreferenceKind, value: unknown): unknown => {
  const fn = SOURCES[kind].compact as ((value: unknown) => unknown) | undefined
  return fn ? fn(value) : value
}

const parseValue = <T>(kind: ModelPreferenceKind, raw: string): T | null => {
  try {
    const parsed = SOURCES[kind].schema.safeParse(JSON.parse(raw))
    return parsed.success ? (parsed.data as T) : null
  } catch {
    return null
  }
}

const upsert = (
  executor: Pick<SqlExecutor, "run">,
  kind: ModelPreferenceKind,
  key: string,
  value: unknown,
  orIgnore = false
) =>
  executor.run(
    `INSERT OR ${orIgnore ? "IGNORE" : "REPLACE"} INTO model_preferences (kind, key, value, updatedAt) VALUES (?, ?, ?, ?)`,
    [kind, key, JSON.stringify(compact(kind, value)), Date.now()]
  )

/** Change notification, within this context and across extension pages. */
type Listener = (kind: ModelPreferenceKind) => void
const listeners = new Set<Listener>()
const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("model-preferences")

channel?.addEventListener("message", (event: MessageEvent) => {
  const kind = event.data as ModelPreferenceKind
  if (!(kind in SOURCES)) return
  for (const listener of listeners) listener(kind)
})

const notify = (kind: ModelPreferenceKind) => {
  for (const listener of listeners) listener(kind)
  channel?.postMessage(kind)
}

export const subscribeModelPreferences = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Legacy sync maps remain available to other devices and restored backups. */
let syncWatcherRegistered = false

const watchSyncSources = (): void => {
  if (syncWatcherRegistered) return
  syncWatcherRegistered = true
  try {
    const onChanged = browser.storage?.onChanged
    if (!onChanged?.addListener) return
    onChanged.addListener((changes, area) => {
      if (area !== "sync") return
      for (const kind of Object.keys(SOURCES) as ModelPreferenceKind[]) {
        const written = SOURCES[kind].syncKeys.some(
          (key) => changes[key]?.newValue !== undefined
        )
        if (!written) continue
        for (const listener of listeners) listener(kind)
      }
    })
  } catch {
    /** No storage API in this context. */
  }
}

const ensureImported = (kind: ModelPreferenceKind): Promise<void> =>
  withModelPreferenceImportLock(async () => {
    watchSyncSources()
    const source = SOURCES[kind]
    for (const syncKey of source.syncKeys) {
      const raw = await getPlasmoStoredValue<unknown>(syncKey)
      if (raw === undefined || raw === null) continue
      const decoded = typeof raw === "string" ? safeJson(raw) : raw
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
        logger.warn(
          "Kept unreadable model preference map",
          "ModelPreferences",
          {
            kind
          }
        )
        continue
      }
      const entries = Object.entries(decoded as Record<string, unknown>)
      const receiptKey = `model-preferences:import:${syncKey}`
      const receipt = JSON.stringify(decoded)
      const receiptMatches = async (executor: Pick<SqlExecutor, "query">) =>
        (
          await executor.query(
            "SELECT 1 FROM kv_store WHERE key = ? AND value = ?",
            [receiptKey, receipt]
          )
        ).length > 0
      if (await receiptMatches({ query })) continue
      let dropped = 0
      let changed = false
      await withTransaction(async (transaction) => {
        if (await receiptMatches(transaction)) return
        changed = true
        for (const [key, value] of entries) {
          const parsed = source.schema.safeParse(value)
          if (!key || !parsed.success) {
            dropped += 1
            continue
          }
          await upsert(transaction, kind, key, parsed.data, true)
        }
        /** Commit the device-local receipt with its rows; a replaced DB reimports. */
        await transaction.run(
          "INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)",
          [receiptKey, receipt]
        )
      })
      if (changed) await flushSave()
      if (dropped > 0) {
        logger.warn(
          "Kept sync model preferences: some entries failed validation",
          "ModelPreferences",
          { kind, dropped, migrated: entries.length - dropped }
        )
      }
    }
  })

const safeJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Every stored entry of a kind. Rows that no longer validate are skipped. */
export const listModelPreferences = async <T>(
  kind: ModelPreferenceKind
): Promise<Record<string, T>> => {
  await ensureImported(kind)
  const rows = decodeRows(
    RowSchema,
    await query("SELECT key, value FROM model_preferences WHERE kind = ?", [
      kind
    ]),
    { table: TABLE, operation: "list" }
  )
  const result: Record<string, T> = {}
  for (const row of rows) {
    const value = parseValue<T>(kind, row.value)
    if (value) result[row.key] = value
  }
  return result
}

/** The entries for these keys only; absent keys are absent from the result. */
export const getModelPreferences = async <T>(
  kind: ModelPreferenceKind,
  keys: readonly string[]
): Promise<Record<string, T>> => {
  await ensureImported(kind)
  if (keys.length === 0) return {}
  const rows = decodeRows(
    RowSchema,
    await query(
      `SELECT key, value FROM model_preferences WHERE kind = ? AND key IN (${keys.map(() => "?").join(", ")})`,
      [kind, ...keys]
    ),
    { table: TABLE, operation: "get" }
  )
  const result: Record<string, T> = {}
  for (const row of rows) {
    const value = parseValue<T>(kind, row.value)
    if (value) result[row.key] = value
  }
  return result
}

/**
 * Read-modify-write one entry in a transaction, so two contexts editing the
 * same model compose instead of clobbering. `update` returns the next value,
 * `null` to delete the entry, or `undefined` to leave it as it is.
 */
export const updateModelPreference = async <T>(
  kind: ModelPreferenceKind,
  key: string,
  update: (current: T | undefined) => T | null | undefined
): Promise<void> => {
  await ensureImported(kind)
  let changed = false
  await withTransaction(async (transaction) => {
    const rows = decodeRows(
      RowSchema,
      await transaction.query(
        "SELECT key, value FROM model_preferences WHERE kind = ? AND key = ?",
        [kind, key]
      ),
      { table: TABLE, operation: "update" }
    )
    const current = rows[0]
      ? (parseValue<T>(kind, rows[0].value) ?? undefined)
      : undefined
    const next = update(current)
    if (next === undefined) return
    if (next === null) {
      if (!rows[0]) return
      await transaction.run(
        "DELETE FROM model_preferences WHERE kind = ? AND key = ?",
        [kind, key]
      )
    } else {
      const parsed = SOURCES[kind].schema.safeParse(next)
      if (!parsed.success) {
        throw new Error(`Invalid ${kind} model preference`)
      }
      await upsert(transaction, kind, key, parsed.data)
    }
    changed = true
  })
  if (!changed) return
  await flushSave()
  notify(kind)
}

/** Drop every entry whose key starts with `prefix` (a removed provider). */
export const deleteModelPreferencesWithPrefix = async (
  kind: ModelPreferenceKind,
  prefix: string
): Promise<void> => {
  await ensureImported(kind)
  const escaped = prefix.replace(/[\\%_]/g, (match) => `\\${match}`)
  await run(
    "DELETE FROM model_preferences WHERE kind = ? AND key LIKE ? ESCAPE '\\'",
    [kind, `${escaped}%`]
  )
  await flushSave()
  notify(kind)
}

const KINDS = Object.keys(SOURCES) as ModelPreferenceKind[]

/**
 * Drop every entry of these kinds (a module reset). Does not import from sync
 * first: the reset removes the sync keys too, and must do so before calling
 * this, or another page's import could put the rows straight back.
 */
export const clearModelPreferences = async (
  kinds: readonly ModelPreferenceKind[] = KINDS
): Promise<void> => {
  if (kinds.length === 0) return
  await withTransaction(async (transaction) => {
    await transaction.run(
      `DELETE FROM model_preferences WHERE kind IN (${kinds.map(() => "?").join(", ")})`,
      [...kinds]
    )
    const receipts = kinds.flatMap((kind) =>
      SOURCES[kind].syncKeys.map((key) => `model-preferences:import:${key}`)
    )
    await transaction.run(
      `DELETE FROM kv_store WHERE key IN (${receipts.map(() => "?").join(", ")})`,
      receipts
    )
  })
  await flushSave()
  for (const kind of kinds) notify(kind)
}
