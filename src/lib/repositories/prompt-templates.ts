import { DEFAULT_PROMPT_TEMPLATES, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoSyncStorage } from "@/lib/plasmo-global-storage"
import {
  flushSave,
  initSQLite,
  query,
  run,
  withTransaction
} from "@/lib/sqlite/db"
import type { PromptTemplate } from "@/types/ui-state"
import { PromptTemplateSchema } from "@/types/ui-state.schemas"

type RowValue = string | number | null | Uint8Array
type Row = Record<string, RowValue>

const MIGRATION_MARKER = "prompt_templates.storage_sync_migrated.v1"
const LEGACY_PROMPT_KEY = "ollama-prompt-templates"

const listeners = new Set<() => void>()
const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("page-assist-prompt-templates")

channel?.addEventListener("message", () => {
  for (const listener of listeners) listener()
})

const notify = () => {
  for (const listener of listeners) listener()
  channel?.postMessage("changed")
}

const normalize = (value: unknown): PromptTemplate | null => {
  const parsed = PromptTemplateSchema.safeParse(value)
  return parsed.success ? (parsed.data as PromptTemplate) : null
}

const fromRow = (row: Row): PromptTemplate | null => {
  let tags: unknown
  try {
    tags = typeof row.tags === "string" ? JSON.parse(row.tags) : undefined
  } catch {
    tags = undefined
  }
  return normalize({
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category ?? undefined,
    systemPrompt: row.systemPrompt ?? undefined,
    userPrompt: row.userPrompt,
    tags,
    createdAt: row.createdAt,
    usageCount: row.usageCount
  })
}

const insert = async (template: PromptTemplate, sortOrder: number) => {
  const valid = normalize(template)
  if (!valid) throw new Error("Invalid prompt template")
  await run(
    `INSERT OR REPLACE INTO prompt_templates
     (id, title, description, category, systemPrompt, userPrompt, tags, createdAt, usageCount, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      valid.id,
      valid.title,
      valid.description ?? null,
      valid.category ?? null,
      valid.systemPrompt ?? null,
      valid.userPrompt,
      valid.tags?.length ? JSON.stringify(valid.tags) : null,
      valid.createdAt?.getTime() ?? Date.now(),
      valid.usageCount ?? 0,
      sortOrder
    ]
  )
}

interface LegacyTemplates {
  templates: PromptTemplate[]
  /** Entries the schema rejected. Never silently discarded — see below. */
  dropped: number
}

const readLegacyTemplates = async (): Promise<LegacyTemplates | null> => {
  const current = await plasmoSyncStorage.get<unknown>(
    STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES
  )
  const legacy =
    current === undefined
      ? await plasmoSyncStorage.get<unknown>(LEGACY_PROMPT_KEY)
      : undefined
  const raw = current ?? legacy
  if (!Array.isArray(raw)) return null
  const templates = raw
    .map(normalize)
    .filter((template): template is PromptTemplate => template !== null)
  return { templates, dropped: raw.length - templates.length }
}

let migrationPromise: Promise<void> | null = null

export const ensurePromptTemplatesMigrated = async (): Promise<void> => {
  if (migrationPromise) return migrationPromise
  migrationPromise = (async () => {
    await initSQLite()
    const existingMarker = await query(
      "SELECT value FROM kv_store WHERE key = ? LIMIT 1",
      [MIGRATION_MARKER]
    )
    if (existingMarker.length > 0) return

    const legacy = await readLegacyTemplates()
    let migrated = false

    await withTransaction(async () => {
      const marker = await query(
        "SELECT value FROM kv_store WHERE key = ? LIMIT 1",
        [MIGRATION_MARKER]
      )
      if (marker.length > 0) return

      const existing = await query(
        "SELECT COUNT(*) AS count FROM prompt_templates"
      )
      if (Number(existing[0]?.count ?? 0) === 0) {
        const seed =
          legacy && legacy.templates.length > 0
            ? legacy.templates
            : DEFAULT_PROMPT_TEMPLATES
        for (const [index, template] of seed.entries()) {
          await insert(template, index)
        }
      }
      await run("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)", [
        MIGRATION_MARKER,
        "complete"
      ])
      migrated = true
    })

    await flushSave()
    if (!migrated) return

    /*
     * Removing the legacy keys destroys the only other copy, so it is gated on
     * having carried everything across. A template the schema rejected is not
     * a template the user agreed to lose, so the source is retained as a
     * recovery artifact and the count is logged. The marker still commits —
     * re-importing on the next read would duplicate what did migrate — so this
     * is a deliberate trade: a stale sync key keeps consuming quota (the thing
     * this migration exists to reclaim) in exchange for the data remaining
     * recoverable.
     *
     * The all-invalid case is why the gate matters: `templates.length === 0`
     * seeds the built-in defaults above, so deleting here would silently
     * replace the user's library with stock content and leave nothing behind.
     */
    if (legacy && legacy.dropped > 0) {
      logger.warn(
        "Kept legacy prompt-template storage: some entries failed validation",
        "PromptTemplates",
        { dropped: legacy.dropped, migrated: legacy.templates.length }
      )
      return
    }

    await Promise.allSettled([
      plasmoSyncStorage.remove(STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES),
      plasmoSyncStorage.remove(LEGACY_PROMPT_KEY)
    ])
  })().catch((error) => {
    migrationPromise = null
    throw error
  })
  return migrationPromise
}

export const listPromptTemplates = async (): Promise<PromptTemplate[]> => {
  await ensurePromptTemplatesMigrated()
  const rows = await query(
    "SELECT * FROM prompt_templates ORDER BY sortOrder ASC, createdAt ASC"
  )
  return rows
    .map(fromRow)
    .filter((template): template is PromptTemplate => template !== null)
}

export const addPromptTemplate = async (
  template: PromptTemplate
): Promise<void> => {
  await ensurePromptTemplatesMigrated()
  await withTransaction(async () => {
    const rows = await query(
      "SELECT COALESCE(MAX(sortOrder), -1) + 1 AS nextOrder FROM prompt_templates"
    )
    await insert(template, Number(rows[0]?.nextOrder ?? 0))
  })
  await flushSave()
  notify()
}

export const updatePromptTemplate = async (
  id: string,
  updated: Partial<PromptTemplate>
): Promise<void> => {
  await ensurePromptTemplatesMigrated()
  let changed = false
  await withTransaction(async () => {
    const rows = await query(
      "SELECT * FROM prompt_templates WHERE id = ? LIMIT 1",
      [id]
    )
    const current = rows[0] ? fromRow(rows[0]) : null
    if (!current) return

    const next = normalize({ ...current, ...updated, id })
    if (!next) throw new Error("Invalid prompt template update")
    await run(
      `UPDATE prompt_templates
       SET title = ?, description = ?, category = ?, systemPrompt = ?,
           userPrompt = ?, tags = ?, createdAt = ?, usageCount = ?
       WHERE id = ?`,
      [
        next.title,
        next.description ?? null,
        next.category ?? null,
        next.systemPrompt ?? null,
        next.userPrompt,
        next.tags?.length ? JSON.stringify(next.tags) : null,
        next.createdAt?.getTime() ?? Date.now(),
        next.usageCount ?? 0,
        id
      ]
    )
    changed = true
  })
  if (!changed) return
  await flushSave()
  notify()
}

export const deletePromptTemplate = async (id: string): Promise<void> => {
  await ensurePromptTemplatesMigrated()
  await run("DELETE FROM prompt_templates WHERE id = ?", [id])
  await flushSave()
  notify()
}

export const incrementPromptTemplateUsage = async (
  id: string
): Promise<void> => {
  await ensurePromptTemplatesMigrated()
  await run(
    "UPDATE prompt_templates SET usageCount = usageCount + 1 WHERE id = ?",
    [id]
  )
  await flushSave()
  notify()
}

export const importPromptTemplates = async (
  templates: PromptTemplate[]
): Promise<void> => {
  await ensurePromptTemplatesMigrated()
  await withTransaction(async () => {
    const rows = await query(
      "SELECT COALESCE(MAX(sortOrder), -1) + 1 AS nextOrder FROM prompt_templates"
    )
    let order = Number(rows[0]?.nextOrder ?? 0)
    for (const template of templates) {
      await insert(template, order++)
    }
  })
  await flushSave()
  notify()
}

export const replacePromptTemplates = async (
  templates: PromptTemplate[]
): Promise<void> => {
  await ensurePromptTemplatesMigrated()
  await withTransaction(async () => {
    await run("DELETE FROM prompt_templates")
    for (const [index, template] of templates.entries()) {
      await insert(template, index)
    }
  })
  await flushSave()
  notify()
}

export const subscribePromptTemplates = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const logPromptTemplateError = (error: unknown) => {
  logger.error("Prompt template persistence failed", "PromptTemplates", {
    error
  })
}
