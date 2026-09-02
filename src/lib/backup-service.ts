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

const readBackupManifest = async (zip: JSZip) => {
  const manifestFile = zip.file("manifest.json")
  if (!manifestFile) {
    throw createAppError("Missing manifest.json in backup file", {
      kind: "validation"
    })
  }
  const manifestResult = safeJsonParse(
    await manifestFile.async("string"),
    BackupManifestSchema
  )
  if (!manifestResult.success) {
    throw createAppError("Invalid manifest: failed schema validation", {
      kind: "validation"
    })
  }
  if (!SUPPORTED_BACKUP_MANIFEST_VERSIONS.has(manifestResult.data.version)) {
    throw createAppError(
      `Unsupported backup version: ${manifestResult.data.version}`,
      { kind: "validation" }
    )
  }
  return manifestResult.data
}

const readPortableStorageSection = async (
  zip: JSZip,
  fileName: string,
  allowLegacyKeys: boolean,
  result: ImportSectionResult,
  skippedStorageKeys: string[]
): Promise<Record<string, unknown> | undefined> => {
  try {
    const file = zip.file(fileName)
    if (!file) {
      result.ok = false
      result.error = `Missing ${fileName}`
      return undefined
    }
    const parsed = safeJsonParse(
      await file.async("string"),
      StorageObjectSchema
    )
    if (!parsed.success) {
      throw createAppError(`Invalid ${fileName}: expected a JSON object`, {
        kind: "validation"
      })
    }
    const selected = selectPortableStorageData(parsed.data, { allowLegacyKeys })
    skippedStorageKeys.push(...selected.rejectedKeys)
    result.ok = true
    return selected.data
  } catch (error) {
    result.ok = false
    result.error = getErrorMessage(error, "Unknown error")
    return undefined
  }
}

const importPortableStorageSections = async (
  zip: JSZip,
  manifestVersion: number,
  result: ImportResult
): Promise<void> => {
  const syncData = await readPortableStorageSection(
    zip,
    "sync-storage.json",
    manifestVersion === 1,
    result.syncStorage,
    result.skippedStorageKeys
  )
  const localData = await readPortableStorageSection(
    zip,
    "local-storage.json",
    manifestVersion === 1,
    result.localStorage,
    result.skippedStorageKeys
  )
  if (syncData === undefined && localData === undefined) return
  try {
    const mergedData = { ...(localData ?? {}), ...(syncData ?? {}) }
    const { settings, providerConfigs } =
      preparePortableStorageImport(mergedData)
    await importPortableStorageTransaction(settings, providerConfigs)
  } catch (error) {
    const storageError = getErrorMessage(error, "Unknown error")
    if (syncData !== undefined)
      result.syncStorage = { ok: false, error: storageError }
    if (localData !== undefined)
      result.localStorage = { ok: false, error: storageError }
  }
}

const importSqliteSection = async (
  zip: JSZip,
  result: ImportResult
): Promise<void> => {
  try {
    const dbFile = zip.file("database.sqlite")
    if (dbFile) {
      await importDatabaseBytes(await dbFile.async("uint8array"))
      result.database.ok = true
      return
    }
    result.database = zip.file("chat-db.json")
      ? {
          ok: false,
          errorKey: "settings.migration.import_result.legacy_chat_backup"
        }
      : { ok: false, error: "Missing database.sqlite" }
  } catch (error) {
    result.database = {
      ok: false,
      error: getErrorMessage(error, "Unknown error")
    }
  }
}

const importVectorSection = async (
  zip: JSZip,
  result: ImportResult
): Promise<void> => {
  try {
    const file = zip.file("vector-db.json")
    if (!file) return
    const blob = await file.async("blob")
    await validateDexieMetadata(blob, "VectorDatabase")
    await vectorDb.open()
    await importInto(vectorDb, blob, {
      overwriteValues: true,
      clearTablesBeforeImport: true
    })
    result.dexie.vectorDb.ok = true
  } catch (error) {
    result.dexie.vectorDb = {
      ok: false,
      error: getErrorMessage(error, "Unknown error")
    }
  }
}

const importKnowledgeSection = async (
  zip: JSZip,
  result: ImportResult
): Promise<void> => {
  try {
    const file = zip.file("knowledge-db.json")
    if (!file) return
    const blob = await file.async("blob")
    await validateDexieExport(blob, "KnowledgeDatabase", {
      knowledgeSets: KnowledgeSetRecordSchema,
      knowledgeFiles: KnowledgeFileRecordSchema
    })
    await knowledgeDb.open()
    await importInto(knowledgeDb, blob, {
      overwriteValues: true,
      clearTablesBeforeImport: true
    })
    result.dexie.knowledgeDb.ok = true
  } catch (error) {
    result.dexie.knowledgeDb = {
      ok: false,
      error: getErrorMessage(error, "Unknown error")
    }
  }
}

const importDexieSections = async (
  zip: JSZip,
  result: ImportResult
): Promise<void> => {
  await closeDexieConnectionsEverywhere()
  try {
    await importVectorSection(zip, result)
    await importKnowledgeSection(zip, result)
  } finally {
    await reopenDexieConnectionsEverywhere()
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
      dexie: { vectorDb: { ok: false }, knowledgeDb: { ok: false } },
      skippedStorageKeys: []
    }
    try {
      const zip = await JSZip.loadAsync(file)
      const manifest = await readBackupManifest(zip)
      await importPortableStorageSections(zip, manifest.version, result)
      await importSqliteSection(zip, result)
      await importDexieSections(zip, result)
      result.skippedStorageKeys = [...new Set(result.skippedStorageKeys)].sort()
      return result
    } catch (error) {
      const errorMessage = getErrorMessage(error, "Unknown error")
      throw createAppError(`Failed to read backup file: ${errorMessage}`, {
        kind: "validation",
        cause: error
      })
    }
  }
}
