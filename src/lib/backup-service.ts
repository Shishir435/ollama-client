import { exportDB, importInto } from "dexie-export-import"
import JSZip from "jszip"
import { z } from "zod"
import { MESSAGE_KEYS } from "./constants"
import { vectorDb } from "./embeddings/db"
import { createAppError, getErrorMessage } from "./error-utils"
import { knowledgeDb } from "./knowledge/knowledge-sets"
import { logger } from "./logger"
import {
  type ProviderConfig,
  ProviderStorageKey,
  ProviderType
} from "./providers/types"
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
import { safeJsonParse } from "./validation"

const BackupManifestSchema = z.object({
  version: z.number(),
  timestamp: z.string().optional(),
  appVersion: z.string().optional()
})

const StorageObjectSchema = z.record(z.string(), z.unknown())
const ProviderConfigBackupSchema = z
  .object({
    id: z.string(),
    type: z.nativeEnum(ProviderType),
    enabled: z.boolean(),
    baseUrl: z.string().optional(),
    modelId: z.string().optional(),
    name: z.string(),
    customModels: z.array(z.string()).optional()
  })
  .passthrough()
const ProviderConfigsBackupSchema = z.array(ProviderConfigBackupSchema)

export type ImportResult = {
  syncStorage: { ok: boolean; error?: string }
  localStorage: { ok: boolean; error?: string }
  database: { ok: boolean; error?: string }
  dexie: {
    vectorDb: { ok: boolean; error?: string }
    knowledgeDb: { ok: boolean; error?: string }
  }
  skippedStorageKeys: string[]
}

const requestLiveSqliteFlush = async (): Promise<void> => {
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_KEYS.APP.FLUSH_SQLITE })
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

// Deleting a Dexie database while another context (an open sidepanel) holds a
// connection blocks the delete and surfaces "Another connection wants to
// delete database" warnings on the extensions page. Ask every context —
// including this one — to close its handles first; the post-import
// runtime.reload() reopens everything fresh.
const closeDexieConnectionsEverywhere = async (): Promise<void> => {
  try {
    await chrome.runtime.sendMessage({ type: MESSAGE_KEYS.APP.CLOSE_DEXIE })
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

  const parsedProviderConfigs =
    ProviderConfigsBackupSchema.safeParse(providerConfigValue)
  if (!parsedProviderConfigs.success) {
    throw createAppError("Invalid provider configuration in backup", {
      kind: "validation"
    })
  }
  return {
    settings,
    providerConfigs: parsedProviderConfigs.data as ProviderConfig[]
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
    const rawSyncData = await chrome.storage.sync.get(null)
    const { data: syncData } = selectPortableStorageData(rawSyncData)
    zip.file("sync-storage.json", JSON.stringify(syncData, null, 2))

    // Local Storage
    logger.info("Exporting local storage...", "Backup")
    const rawLocalData = await chrome.storage.local.get(null)
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
          await vectorDb.delete()
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
          await knowledgeDb.delete()
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
