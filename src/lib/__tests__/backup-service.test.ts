import { importInto } from "dexie-export-import"
import JSZip from "jszip"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { backupService } from "../backup-service"
import { importDatabaseBytes } from "../sqlite/db"

vi.mock("jszip", () => {
  const MockZip: any = vi.fn().mockImplementation(function (this: any) {
    this.file = vi.fn()
    this.generateAsync = vi.fn().mockResolvedValue(new Blob(["test-zip"]))
    return this
  })
  MockZip.loadAsync = vi.fn()
  return { default: MockZip }
})

vi.mock("dexie-export-import", () => ({
  exportDB: vi.fn().mockResolvedValue(new Blob(["test-dexie"])),
  importInto: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("../sqlite/db", () => ({
  exportDatabaseBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  importDatabaseBytes: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("../db", () => ({
  db: {
    delete: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("../embeddings/db", () => ({
  vectorDb: {
    delete: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("../knowledge/knowledge-sets", () => ({
  knowledgeDb: {
    delete: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined)
  },
  listKnowledgeSets: vi.fn()
}))

describe("backupService", () => {
  const mockManifest = {
    version: 1,
    appVersion: "1.0.0",
    timestamp: new Date().toISOString()
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock chrome storage returns
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({})
    vi.mocked(chrome.storage.local.get).mockResolvedValue({})

    // Mock chrome.runtime.getManifest
    global.chrome.runtime.getManifest = vi
      .fn()
      .mockReturnValue({ version: "1.0.0" })
  })

  describe("exportAll", () => {
    it("should export all components into a zip", async () => {
      await backupService.exportAll()

      const zipInstance = vi.mocked(JSZip).mock.instances[0]
      expect(zipInstance.file).toHaveBeenCalledWith(
        "manifest.json",
        expect.any(String)
      )
      expect(zipInstance.file).toHaveBeenCalledWith(
        "sync-storage.json",
        expect.any(String)
      )
      expect(zipInstance.file).toHaveBeenCalledWith(
        "local-storage.json",
        expect.any(String)
      )
      expect(zipInstance.file).toHaveBeenCalledWith(
        "database.sqlite",
        expect.any(Uint8Array)
      )
      expect(zipInstance.file).toHaveBeenCalledWith(
        "chat-db.json",
        expect.any(Blob)
      )
      expect(zipInstance.file).toHaveBeenCalledWith(
        "vector-db.json",
        expect.any(Blob)
      )
      expect(zipInstance.file).toHaveBeenCalledWith(
        "knowledge-db.json",
        expect.any(Blob)
      )
    })
  })

  describe("importAll", () => {
    it("should fail if manifest is missing", async () => {
      vi.mocked(JSZip.loadAsync).mockResolvedValue({
        file: vi.fn().mockReturnValue(null)
      } as any)

      await expect(
        backupService.importAll(new File([], "test.zip"))
      ).rejects.toThrow("Missing manifest.json in backup file")
    })

    it("should import all components successfully", async () => {
      const mockFile = (content: string) => ({
        async: vi.fn().mockResolvedValue(content)
      })

      const zipInstance = {
        file: vi.fn().mockImplementation((name) => {
          if (name === "manifest.json")
            return mockFile(JSON.stringify(mockManifest))
          if (name === "sync-storage.json")
            return mockFile(JSON.stringify({ testKey: "testValue" }))
          if (name === "local-storage.json")
            return mockFile(JSON.stringify({ localKey: "localValue" }))
          if (name === "database.sqlite")
            return { async: vi.fn().mockResolvedValue(new Uint8Array([1])) }
          if (name === "chat-db.json")
            return { async: vi.fn().mockResolvedValue(new Blob()) }
          if (name === "vector-db.json")
            return { async: vi.fn().mockResolvedValue(new Blob()) }
          if (name === "knowledge-db.json")
            return { async: vi.fn().mockResolvedValue(new Blob()) }
          return null
        })
      }
      vi.mocked(JSZip.loadAsync).mockResolvedValue(zipInstance as any)

      const result = await backupService.importAll(new File([], "test.zip"))

      expect(result.syncStorage.ok).toBe(true)
      expect(result.localStorage.ok).toBe(true)
      expect(result.database.ok).toBe(true)
      expect(result.dexie.chatDb.ok).toBe(true)
      expect(result.dexie.vectorDb.ok).toBe(true)
      expect(result.dexie.knowledgeDb.ok).toBe(true)

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        testKey: "testValue"
      })
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        localKey: "localValue"
      })
      expect(importDatabaseBytes).toHaveBeenCalled()
      expect(importInto).toHaveBeenCalledTimes(3)
    })
  })
})
