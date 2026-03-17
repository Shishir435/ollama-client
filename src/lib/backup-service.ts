import { exportDB, importInto } from "dexie-export-import"
import JSZip from "jszip"
import { db as chatDb } from "./db"
import { vectorDb } from "./embeddings/db"
import { knowledgeDb } from "./knowledge/knowledge-sets"
import { logger } from "./logger"
import { exportDatabaseBytes, importDatabaseBytes } from "./sqlite/db"

export type ImportResult = {
  syncStorage: { ok: boolean; error?: string }
  localStorage: { ok: boolean; error?: string }
  database: { ok: boolean; error?: string }
  dexie: {
    chatDb: { ok: boolean; error?: string }
    vectorDb: { ok: boolean; error?: string }
    knowledgeDb: { ok: boolean; error?: string }
  }
}

const MANIFEST_VERSION = 1

export const backupService = {
  exportAll: async (): Promise<Blob> => {
    logger.info("Exporting all user data...", "Backup")
    const zip = new JSZip()

    // Manifest
    console.log("[Backup] Exporting manifest...")
    const manifest = {
      version: MANIFEST_VERSION,
      timestamp: new Date().toISOString(),
      appVersion: chrome.runtime.getManifest().version
    }
    zip.file("manifest.json", JSON.stringify(manifest, null, 2))

    // Sync Storage
    console.log("[Backup] Exporting sync storage...")
    const syncData = await chrome.storage.sync.get(null)
    zip.file("sync-storage.json", JSON.stringify(syncData, null, 2))

    // Local Storage
    console.log("[Backup] Exporting local storage...")
    const localData = await chrome.storage.local.get(null)
    zip.file("local-storage.json", JSON.stringify(localData, null, 2))

    // SQLite Database
    try {
      console.log("[Backup] Exporting SQLite database...")
      const dbBytes = await exportDatabaseBytes()
      zip.file("database.sqlite", dbBytes)
      console.log("[Backup] SQLite database exported.")
    } catch (e) {
      console.error("[Backup] SQLite export failed:", e)
      throw e // Re-throw to see the full stack in the UI
    }

    // Dexie Databases
    const dexieDbs = [
      { name: "Chat DB", db: chatDb, file: "chat-db.json" },
      { name: "Vector DB", db: vectorDb, file: "vector-db.json" },
      { name: "Knowledge DB", db: knowledgeDb, file: "knowledge-db.json" }
    ]

    for (const item of dexieDbs) {
      try {
        console.log(`[Backup] Exporting ${item.name}...`)
        const blob = await exportDB(item.db)
        zip.file(item.file, blob)
        console.log(`[Backup] ${item.name} exported.`)
      } catch (e) {
        console.error(`[Backup] ${item.name} export failed:`, e)
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
        chatDb: { ok: false },
        vectorDb: { ok: false },
        knowledgeDb: { ok: false }
      }
    }

    try {
      const zip = await JSZip.loadAsync(file)

      // Manifest
      const manifestFile = zip.file("manifest.json")
      if (!manifestFile) {
        throw new Error("Missing manifest.json in backup file")
      }

      const manifestStr = await manifestFile.async("string")
      const manifest = JSON.parse(manifestStr)
      if (manifest.version !== MANIFEST_VERSION) {
        throw new Error(`Unsupported backup version: ${manifest.version}`)
      }

      // Sync Storage
      try {
        const syncFile = zip.file("sync-storage.json")
        if (syncFile) {
          const syncStr = await syncFile.async("string")
          const syncData = JSON.parse(syncStr)

          await chrome.storage.sync.clear()

          const failedKeys: string[] = []
          for (const [key, value] of Object.entries(syncData)) {
            try {
              await chrome.storage.sync.set({ [key]: value })
            } catch (e) {
              const errorMessage =
                e instanceof Error ? e.message : "Unknown error"
              logger.warn(
                `Failed to import sync key ${key}: ${errorMessage}`,
                "Backup"
              )
              failedKeys.push(key)
            }
          }

          if (failedKeys.length > 0) {
            result.syncStorage = {
              ok: false,
              error: `Failed to import keys due to quota/size: ${failedKeys.join(", ")}`
            }
          } else {
            result.syncStorage.ok = true
          }
        } else {
          result.syncStorage = { ok: false, error: "Missing sync-storage.json" }
        }
      } catch (e) {
        result.syncStorage = {
          ok: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }

      // Local Storage
      try {
        const localFile = zip.file("local-storage.json")
        if (localFile) {
          const localStr = await localFile.async("string")
          const localData = JSON.parse(localStr)
          await chrome.storage.local.clear()
          await chrome.storage.local.set(localData)
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

      // Dexie Databases
      try {
        const chatDbFile = zip.file("chat-db.json")
        if (chatDbFile) {
          const chatDbBlob = await chatDbFile.async("blob")
          await chatDb.delete()
          await chatDb.open()
          await importInto(chatDb, chatDbBlob, {
            overwriteValues: true,
            clearTablesBeforeImport: true
          })
          result.dexie.chatDb.ok = true
        }
      } catch (e) {
        result.dexie.chatDb = {
          ok: false,
          error: e instanceof Error ? e.message : "Unknown error"
        }
      }

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

      return result
    } catch (e) {
      // If we completely fail to parse zip or manifest:
      const errorMessage = e instanceof Error ? e.message : "Unknown error"
      throw new Error(`Failed to read backup file: ${errorMessage}`)
    }
  }
}
