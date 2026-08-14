import { exportDB, importInto, peakImportFile } from "dexie-export-import"
import JSZip from "jszip"
import { z } from "zod"
import { browser } from "@/lib/browser-api"
import { PromptTemplateSchema, ThemeSchema } from "@/types/ui-state.schemas"
import { MESSAGE_KEYS, STORAGE_KEYS } from "./constants"
import { vectorDb } from "./embeddings/db"
import { createAppError, getErrorMessage } from "./error-utils"
import {
  KnowledgeFileRecordSchema,
  KnowledgeSetRecordSchema,
  knowledgeDb
} from "./knowledge/knowledge-sets"
import { logger } from "./logger"
import { ModelConfigMapSchema } from "./model-config-utils"
import { validateProviderConfigs } from "./providers/provider-config-schema"
import { type ProviderConfig, ProviderStorageKey } from "./providers/types"
import { safeJsonParse } from "./safe-json-parse"
import {
  exportPersistedDatabaseBytes,
  flushSave,
  importDatabaseBytes
} from "./sqlite/db"
import { importPortableStorageTransaction } from "./storage/backup-import-transaction"
import {
  BACKUP_MANIFEST_VERSION,
  SUPPORTED_BACKUP_MANIFEST_VERSIONS,
  selectPortableStorageData
} from "./storage/backup-storage-policy"
import { KNOWLEDGE_SETTINGS } from "./storage/knowledge-settings"
import { LegacyPromptTemplatesSchema } from "./storage/legacy-prompt-templates"
import { getSettingDescriptor } from "./storage/setting-registry"

const BackupManifestSchema = z.object({
  version: z.number().int().positive(),
  timestamp: z.string().optional(),
  appVersion: z.string().optional()
})

const StorageObjectSchema = z.record(z.string(), z.unknown())
const DexieTableDataSchema = z.object({
  tableName: z.string().min(1),
  inbound: z.boolean(),
  rows: z.array(z.unknown())
})
const DexieExportSchema = z.object({
  formatName: z.literal("dexie"),
  formatVersion: z.literal(1),
  data: z.object({
    databaseName: z.string().min(1),
    databaseVersion: z.number().positive().finite(),
    tables: z.array(
      z.object({
        name: z.string().min(1),
        schema: z.string(),
        rowCount: z.number().int().nonnegative()
      })
    ),
    data: z.array(DexieTableDataSchema)
  })
})
const ProviderMappingsSchema = z.record(z.string().min(1), z.string().min(1))
const ZustandThemeSchema = z.object({
  state: z.object({ theme: ThemeSchema }).passthrough()
})
const ShortcutSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    description: z.string(),
    category: z.enum(["navigation", "actions", "toggles"]),
    defaultKey: z.string(),
    key: z.string()
  })
  .passthrough()
const ZustandShortcutsSchema = z.object({
  state: z
    .object({ shortcuts: z.record(z.string().min(1), ShortcutSchema) })
    .passthrough()
})
const LegacySettingSchemas = new Map<string, z.ZodType>([
  ["selected-ollama-model", z.string().min(1)],
  ["ollama-prompt-templates", LegacyPromptTemplatesSchema],
  ["ollama-model-config", ModelConfigMapSchema],
  ["ollama-base-url", z.string().min(1)]
])
const PortableSettingSchemas = new Map<string, z.ZodType>([
  [STORAGE_KEYS.PROVIDER.BASE_URL, z.string()],
  [STORAGE_KEYS.LANGUAGE, z.string().min(1)],
  [STORAGE_KEYS.PROVIDER.SELECTED_MODEL, z.string()],
  [STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL, z.string().nullable()],
  [STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES, z.array(PromptTemplateSchema)],
  [STORAGE_KEYS.PROVIDER.FAVICON_LOOKUP, z.boolean()],
  [STORAGE_KEYS.PROVIDER.CATALOG_REFRESH_MS, z.number().finite().nonnegative()],
  [STORAGE_KEYS.THEME.PREFERENCE, z.union([ThemeSchema, ZustandThemeSchema])],
  [STORAGE_KEYS.SHORTCUTS, ZustandShortcutsSchema],
  [STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS, z.array(z.string())],
  [STORAGE_KEYS.TTS.AUTO_PLAY, z.boolean()],
  [STORAGE_KEYS.TTS.RATE, z.number().finite()],
  [STORAGE_KEYS.TTS.PITCH, z.number().finite()],
  [STORAGE_KEYS.TTS.VOICE_URI, z.string()],
  [STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL, z.string().min(1)],
  [STORAGE_KEYS.EMBEDDINGS.GLOBAL_AUTO_EMBED, z.boolean()],
  [STORAGE_KEYS.EMBEDDINGS.AUTO_EMBED_CHAT, z.boolean()],
  [STORAGE_KEYS.IMAGES.MAX_SIZE_MB, z.number().finite().positive()],
  [STORAGE_KEYS.CHAT.SHOW_SESSION_METRICS, z.boolean()],
  [STORAGE_KEYS.CHAT.MAX_TAB_CONTEXT_CHARS, z.number().int().positive()],
  [STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS, z.number().int().positive()],
  [STORAGE_KEYS.CHAT.MAX_TOOL_RESULT_CHARS, z.number().int().positive()],
  [STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE, z.boolean()],
  [STORAGE_KEYS.CHAT.AUTO_REFRESH_TAB_CONTEXT, z.boolean()],
  [STORAGE_KEYS.CHAT.AUTO_SCREENSHOT_ON_VISION, z.boolean()],
  [STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES, z.boolean()],
  [
    STORAGE_KEYS.TOOLS.FAMILIES,
    z.object({
      enabled: z.boolean(),
      families: z.record(z.string().min(1), z.boolean())
    })
  ]
])
const KnowledgeSettingSchemas = new Map(
  Object.values(KNOWLEDGE_SETTINGS).flatMap((descriptor) =>
    descriptor.parser ? [[descriptor.key, descriptor.parser]] : []
  )
)

const decodeStoredValue = (
  value: unknown
): { decoded: unknown; encoded: boolean } => {
  if (typeof value !== "string") return { decoded: value, encoded: false }
  try {
    return { decoded: JSON.parse(value), encoded: true }
  } catch {
    return { decoded: value, encoded: false }
  }
}

const validateDexieExport = async (
  blob: Blob,
  databaseName: string,
  rowSchemas?: Record<string, z.ZodType>
): Promise<void> => {
  let value: unknown
  try {
    value = JSON.parse(await blob.text())
  } catch {
    throw createAppError(`Invalid ${databaseName} backup`, {
      kind: "validation"
    })
  }
  const parsed = DexieExportSchema.safeParse(value)
  if (!parsed.success || parsed.data.data.databaseName !== databaseName) {
    throw createAppError(`Invalid ${databaseName} backup`, {
      kind: "validation"
    })
  }
  if (!rowSchemas) return
  for (const table of parsed.data.data.data) {
    const rowSchema = rowSchemas[table.tableName]
    if (
      !rowSchema ||
      table.rows.some((row) => !rowSchema.safeParse(row).success)
    ) {
      throw createAppError(`Invalid ${databaseName} backup rows`, {
        kind: "validation"
      })
    }
  }
}

const validateDexieMetadata = async (
  blob: Blob,
  databaseName: string
): Promise<void> => {
  const metadata = await peakImportFile(blob)
  if (metadata.data.databaseName !== databaseName) {
    throw createAppError(`Invalid ${databaseName} backup`, {
      kind: "validation"
    })
  }
}

const validatePortableSetting = (key: string, value: unknown): unknown => {
  const { decoded, encoded } = decodeStoredValue(value)
  const parser =
    getSettingDescriptor(key)?.parser ??
    KnowledgeSettingSchemas.get(key) ??
    PortableSettingSchemas.get(key) ??
    (key === ProviderStorageKey.MODEL_MAPPINGS ||
    key === ProviderStorageKey.MODEL_MAPPINGS_V2
      ? ProviderMappingsSchema
      : LegacySettingSchemas.get(key))
  if (!parser) return value
  const parsed = parser.safeParse(decoded)
  if (!parsed.success) {
    throw createAppError(`Invalid persisted value for backup key ${key}`, {
      kind: "validation"
    })
  }
  return encoded ? JSON.stringify(parsed.data) : parsed.data
}

/**
 * One restored section's outcome. `error` carries technical detail from an
 * exception; `errorKey` names displayable copy for a state this module
 * recognizes and the user can act on, since backup import runs where there is
 * no `t`.
 */
export type ImportSectionResult = {
  ok: boolean
  error?: string
  errorKey?: string
}

export type ImportResult = {
  syncStorage: ImportSectionResult
  localStorage: ImportSectionResult
  database: ImportSectionResult
  dexie: {
    vectorDb: ImportSectionResult
    knowledgeDb: ImportSectionResult
  }
  skippedStorageKeys: string[]
}

const requestLiveSqliteFlush = async (): Promise<void> => {
  try {
    await browser.runtime.sendMessage({ type: MESSAGE_KEYS.APP.FLUSH_SQLITE })
  } catch (error) {
    logger.debug(
      "No live SQLite context responded to flush request",
      "Backup",
      {
        error
      }
    )
  }
}

/**
 * Deleting a Dexie database while another context (an open sidepanel) holds a
 * connection can block a clear-before-import transaction. Ask every context —
 * including this one — to close its handles first; the post-import
 * runtime.reload() reopens everything fresh. `importInto` owns the transaction,
 * so a malformed or interrupted import preserves the previous database.
 */
const reopenDexieConnectionsEverywhere = async (): Promise<void> => {
  try {
    await browser.runtime.sendMessage({ type: MESSAGE_KEYS.APP.REOPEN_DEXIE })
  } catch (error) {
    logger.debug("No other context reopened Dexie connections", "Backup", {
      error
    })
  }
  try {
    await vectorDb.open()
    await knowledgeDb.open()
  } catch (error) {
    logger.debug("Reopening local Dexie handles failed", "Backup", { error })
  }
}

const closeDexieConnectionsEverywhere = async (): Promise<void> => {
  try {
    await browser.runtime.sendMessage({ type: MESSAGE_KEYS.APP.CLOSE_DEXIE })
  } catch (error) {
    logger.debug("No other context held Dexie connections", "Backup", {
      error
    })
  }
  try {
    vectorDb.close()
    knowledgeDb.close()
  } catch (error) {
    logger.debug("Closing local Dexie handles failed", "Backup", { error })
  }
}

const preparePortableStorageImport = (
  data: Record<string, unknown>
): {
  settings: Record<string, unknown>
  providerConfigs?: ProviderConfig[]
} => {
  const settings = { ...data }
  let providerConfigValue = settings[ProviderStorageKey.CONFIG]
  delete settings[ProviderStorageKey.CONFIG]
  for (const [key, value] of Object.entries(settings)) {
    settings[key] = validatePortableSetting(key, value)
  }
  if (providerConfigValue === undefined) return { settings }

  // Backups written from raw chrome.storage reads carry the value in
  // @plasmohq/storage's encoded form: a JSON string, not an array. Accept
  // both so existing user backups import.
  if (typeof providerConfigValue === "string") {
    try {
      providerConfigValue = JSON.parse(providerConfigValue)
    } catch {
      throw createAppError("Invalid provider configuration in backup", {
        kind: "validation"
      })
    }
  }

  try {
    return {
      settings,
      providerConfigs: validateProviderConfigs(providerConfigValue)
    }
  } catch {
    throw createAppError("Invalid provider configuration in backup", {
      kind: "validation"
    })
  }
}

export const backupService = {
  exportAll: async (): Promise<Blob> => {
    logger.info("Exporting all user data...", "Backup")
    const zip = new JSZip()

    // Manifest
    logger.info("Exporting manifest...", "Backup")
    const manifest = {
      version: BACKUP_MANIFEST_VERSION,
      timestamp: new Date().toISOString(),
      appVersion: chrome.runtime.getManifest().version,
      storagePolicy: "portable-settings-v1",
      credentialsIncluded: false
    }
    zip.file("manifest.json", JSON.stringify(manifest, null, 2))

    // Sync Storage
    logger.info("Exporting sync storage...", "Backup")
    const rawSyncData = await browser.storage.sync.get(null)
    const { data: syncData } = selectPortableStorageData(rawSyncData)
    zip.file("sync-storage.json", JSON.stringify(syncData, null, 2))

    // Local Storage
    logger.info("Exporting local storage...", "Backup")
    const rawLocalData = await browser.storage.local.get(null)
    const { data: localPortableData } = selectPortableStorageData(rawLocalData)
    zip.file("local-storage.json", JSON.stringify(localPortableData, null, 2))

    // SQLite Database
    try {
      logger.info("Exporting SQLite database...", "Backup")
      await flushSave()
      await requestLiveSqliteFlush()
      const dbBytes = await exportPersistedDatabaseBytes()
      zip.file("database.sqlite", dbBytes)
      logger.info("SQLite database exported.", "Backup")
    } catch (e) {
      logger.error("SQLite export failed", "Backup", { error: e })
      throw e // Re-throw to see the full stack in the UI
    }

    // Dexie-backed vector/knowledge databases. Chat history is SQLite-only.
    const dexieDbs = [
      { name: "Vector DB", db: vectorDb, file: "vector-db.json" },
      { name: "Knowledge DB", db: knowledgeDb, file: "knowledge-db.json" }
    ]

    for (const item of dexieDbs) {
      try {
        logger.info(`Exporting ${item.name}...`, "Backup")
        const blob = await exportDB(item.db)
        zip.file(item.file, blob)
        logger.info(`${item.name} exported.`, "Backup")
      } catch (e) {
        logger.error(`${item.name} export failed`, "Backup", { error: e })
        // We log but don't throw, allowing partial backups
        zip.file(
          `${item.file}.error.txt`,
          `Failed to export ${item.name}: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    }

    // Generate blob
    return await zip.generateAsync({ type: "blob" })
  },

  importAll: async (file: File): Promise<ImportResult> => {
    logger.info("Importing full backup...", "Backup")
    const result: ImportResult = {
      syncStorage: { ok: false },
      localStorage: { ok: false },
      database: { ok: false },
      dexie: {
        vectorDb: { ok: false },
        knowledgeDb: { ok: false }
      },
      skippedStorageKeys: []
    }

    try {
      const zip = await JSZip.loadAsync(file)

      // Manifest
      const manifestFile = zip.file("manifest.json")
      if (!manifestFile) {
        throw createAppError("Missing manifest.json in backup file", {
          kind: "validation"
        })
      }

      const manifestStr = await manifestFile.async("string")
      const manifestResult = safeJsonParse(manifestStr, BackupManifestSchema)
      if (!manifestResult.success) {
        throw createAppError("Invalid manifest: failed schema validation", {
          kind: "validation"
        })
      }
      const manifest = manifestResult.data
      if (!SUPPORTED_BACKUP_MANIFEST_VERSIONS.has(manifest.version)) {
        throw createAppError(
          `Unsupported backup version: ${manifest.version}`,
          {
            kind: "validation"
          }
        )
      }

      let syncData: Record<string, unknown> | undefined
      let localData: Record<string, unknown> | undefined

      // Parse both storage files before mutating either area. Legacy local
      // values fill gaps only; the canonical sync file wins every conflict.
      try {
        const syncFile = zip.file("sync-storage.json")
        if (syncFile) {
          const syncStr = await syncFile.async("string")
          const syncResult = safeJsonParse(syncStr, StorageObjectSchema)
          if (!syncResult.success) {
            throw createAppError(
              "Invalid sync storage: expected a JSON object",
              { kind: "validation" }
            )
          }
          const selected = selectPortableStorageData(syncResult.data, {
            allowLegacyKeys: manifest.version === 1
          })
          syncData = selected.data
          result.skippedStorageKeys.push(...selected.rejectedKeys)
          result.syncStorage.ok = true
        } else {
          result.syncStorage = { ok: false, error: "Missing sync-storage.json" }
        }
      } catch (e) {
        result.syncStorage = {
          ok: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }

      try {
        const localFile = zip.file("local-storage.json")
        if (localFile) {
          const localStr = await localFile.async("string")
          const localResult = safeJsonParse(localStr, StorageObjectSchema)
          if (!localResult.success) {
            throw createAppError(
              "Invalid local storage: expected a JSON object",
              { kind: "validation" }
            )
          }
          const selected = selectPortableStorageData(localResult.data, {
            allowLegacyKeys: manifest.version === 1
          })
          localData = selected.data
          result.skippedStorageKeys.push(...selected.rejectedKeys)
          result.localStorage.ok = true
        } else {
          result.localStorage = {
            ok: false,
            error: "Missing local-storage.json"
          }
        }
      } catch (e) {
        result.localStorage = {
          ok: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }

      if (syncData !== undefined || localData !== undefined) {
        try {
          const mergedData = { ...(localData ?? {}), ...(syncData ?? {}) }
          const { settings, providerConfigs } =
            preparePortableStorageImport(mergedData)
          await importPortableStorageTransaction(settings, providerConfigs)
        } catch (error) {
          const storageError = getErrorMessage(error, "Unknown error")
          if (syncData !== undefined) {
            result.syncStorage = { ok: false, error: storageError }
          }
          if (localData !== undefined) {
            result.localStorage = { ok: false, error: storageError }
          }
        }
      }

      // Database
      try {
        const dbFile = zip.file("database.sqlite")
        if (dbFile) {
          const dbBytes = await dbFile.async("uint8array")
          await importDatabaseBytes(dbBytes)
          result.database.ok = true
        } else if (zip.file("chat-db.json")) {
          // Backups written by 0.6.3 and earlier carry chat history as a Dexie
          // export instead of a SQLite file. Nothing reads that format any more
          // — the Dexie chat bridge shipped only in 0.6.5–0.7.3 — so say which
          // backup this is rather than reporting a missing file, which reads as
          // a corrupt archive.
          result.database = {
            ok: false,
            errorKey: "settings.migration.import_result.legacy_chat_backup"
          }
        } else {
          result.database = { ok: false, error: "Missing database.sqlite" }
        }
      } catch (e) {
        result.database = {
          ok: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }

      // Dexie-backed vector/knowledge databases.
      await closeDexieConnectionsEverywhere()
      try {
        const vectorDbFile = zip.file("vector-db.json")
        if (vectorDbFile) {
          const vectorDbBlob = await vectorDbFile.async("blob")
          await validateDexieMetadata(vectorDbBlob, "VectorDatabase")
          await vectorDb.open()
          await importInto(vectorDb, vectorDbBlob, {
            overwriteValues: true,
            clearTablesBeforeImport: true
          })
          result.dexie.vectorDb.ok = true
        }
      } catch (e) {
        result.dexie.vectorDb = {
          ok: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }

      try {
        const knowledgeDbFile = zip.file("knowledge-db.json")
        if (knowledgeDbFile) {
          const knowledgeDbBlob = await knowledgeDbFile.async("blob")
          await validateDexieExport(knowledgeDbBlob, "KnowledgeDatabase", {
            knowledgeSets: KnowledgeSetRecordSchema,
            knowledgeFiles: KnowledgeFileRecordSchema
          })
          await knowledgeDb.open()
          await importInto(knowledgeDb, knowledgeDbBlob, {
            overwriteValues: true,
            clearTablesBeforeImport: true
          })
          result.dexie.knowledgeDb.ok = true
        }
      } catch (e) {
        result.dexie.knowledgeDb = {
          ok: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }

      // The reload that follows a successful import reopens everything, but
      // a partial failure leaves this session running — restore the handles
      // every context closed for the import so vector/knowledge features
      // keep working without a reload.
      await reopenDexieConnectionsEverywhere()

      result.skippedStorageKeys = [...new Set(result.skippedStorageKeys)].sort()
      return result
    } catch (e) {
      // If we completely fail to parse zip or manifest:
      const errorMessage = getErrorMessage(e, "Unknown error")
      throw createAppError(`Failed to read backup file: ${errorMessage}`, {
        kind: "validation",
        cause: e
      })
    }
  }
}
