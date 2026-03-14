import JSZip from "jszip"
import { exportDB, importInto } from "dexie-export-import"
import { exportDatabaseBytes, importDatabaseBytes } from "./sqlite/db"
import { db as chatDb } from "./db"
import { vectorDb } from "./embeddings/db"
import { knowledgeDb, listKnowledgeSets } from "./knowledge/knowledge-sets"
import { logger } from "./logger"

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
    const manifest = {
      version: MANIFEST_VERSION,
      timestamp: new Date().toISOString(),
      appVersion: chrome.runtime.getManifest().version
    }
    zip.file("manifest.json", JSON.stringify(manifest, null, 2))

    // Sync Storage
    const syncData = await chrome.storage.sync.get(null)
    zip.file("sync-storage.json", JSON.stringify(syncData, null, 2))

    // Local Storage
    const localData = await chrome.storage.local.get(null)
    zip.file("local-storage.json", JSON.stringify(localData, null, 2))

    // SQLite Database
    const dbBytes = await exportDatabaseBytes()
    zip.file("database.sqlite", dbBytes)

    // Dexie Databases
    try {
      // Chat DB
      const chatDbBlob = await exportDB(chatDb)
      zip.file("chat-db.json", chatDbBlob)

      // Vector DB
      const vectorDbBlob = await exportDB(vectorDb)
      zip.file("vector-db.json", vectorDbBlob)

      // Knowledge DB
      const knowledgeDbBlob = await exportDB(knowledgeDb)
      zip.file("knowledge-db.json", knowledgeDbBlob)
    } catch (e: any) {
      logger.error("Failed to export Dexie databases", "Backup", { error: e })
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
            } catch (e: any) {
              logger.warn(`Failed to import sync key ${key}: ${e.message}`, "Backup")
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
      } catch (e: any) {
        result.syncStorage = { ok: false, error: e.message }
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
          result.localStorage = { ok: false, error: "Missing local-storage.json" }
        }
      } catch (e: any) {
        result.localStorage = { ok: false, error: e.message }
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
      } catch (e: any) {
        result.database = { ok: false, error: e.message }
      }

      // Dexie Databases
      try {
        const chatDbFile = zip.file("chat-db.json")
        if (chatDbFile) {
          const chatDbBlob = await chatDbFile.async("blob")
          await chatDb.delete()
          await chatDb.open()
          await importInto(chatDb, chatDbBlob, { overwriteValues: true, clearTablesBeforeImport: true })
          result.dexie.chatDb.ok = true
        }
      } catch (e: any) {
        result.dexie.chatDb = { ok: false, error: e.message }
      }

      try {
        const vectorDbFile = zip.file("vector-db.json")
        if (vectorDbFile) {
          const vectorDbBlob = await vectorDbFile.async("blob")
          await vectorDb.delete()
          await vectorDb.open()
          await importInto(vectorDb, vectorDbBlob, { overwriteValues: true, clearTablesBeforeImport: true })
          result.dexie.vectorDb.ok = true
        }
      } catch (e: any) {
        result.dexie.vectorDb = { ok: false, error: e.message }
      }

      try {
        const knowledgeDbFile = zip.file("knowledge-db.json")
        if (knowledgeDbFile) {
          const knowledgeDbBlob = await knowledgeDbFile.async("blob")
          await knowledgeDb.delete()
          await knowledgeDb.open()
          await importInto(knowledgeDb, knowledgeDbBlob, { overwriteValues: true, clearTablesBeforeImport: true })
          result.dexie.knowledgeDb.ok = true
        }
      } catch (e: any) {
        result.dexie.knowledgeDb = { ok: false, error: e.message }
      }

      return result
    } catch (e: any) {
      // If we completely fail to parse zip or manifest:
      throw new Error(`Failed to read backup file: ${e.message}`)
    }
  }
}
