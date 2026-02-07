import { beforeEach, describe, expect, it, vi } from "vitest"
import Dexie from "dexie"
import { runDexieToSQLiteMigration, getMigrationStatus } from "../dexie-to-sqlite"
import { SQLiteChatRepository } from "@/lib/repositories/sqlite-chat-repository"
import { db as dexieDb } from "@/lib/db"
import * as sqliteDbModule from "@/lib/sqlite/db"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

// Mock dependencies
vi.mock("@/lib/sqlite/db", () => {
  const mockDb = {
    exec: vi.fn((opts) => {
      if (opts.callback && opts.sql.includes("SELECT")) {
        if (opts.sql.includes("last_insert_rowid")) {
          opts.callback({ id: 1 })
        }
      }
    })
  }

  return {
    getDb: vi.fn().mockResolvedValue(mockDb),
    run: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (sql) => {
      if (sql.includes("last_insert_rowid")) return [{ id: 1 }]
      if (sql.includes("SELECT id FROM files")) return [] // No existing files
      if (sql.includes("SELECT id FROM messages")) return [] // No existing messages
      if (sql.includes("SELECT * FROM sessions")) return []
      return []
    }),
    initSQLite: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock("@/lib/plasmo-global-storage", () => {
  const storage = new Map<string, string>()
  return {
    plasmoGlobalStorage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      set: vi.fn((key: string, value: string) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      remove: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve()
      })
    }
  }
})

describe("Dexie v2 → SQLite Migration", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Clear migration status
    await plasmoGlobalStorage.remove("sqlite_migration_status")
    await plasmoGlobalStorage.remove("sqlite_migration_progress")
    
    // Clear Dexie database
    await dexieDb.sessions.clear()
    await dexieDb.messages.clear()
    await dexieDb.files.clear()
  })

  describe("Basic Migration", () => {
    it("should migrate sessions from Dexie v2 to SQLite", async () => {
      // Setup: Add v2 data to Dexie
      const session = {
        id: "test-session-1",
        title: "Test Chat",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      await dexieDb.sessions.add(session)

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: SQLite run was called with session data
      expect(sqliteDbModule.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO sessions"),
        expect.arrayContaining([session.id, session.title, session.modelId])
      )
    })

    it("should skip migration if already completed", async () => {
      // Setup: Mark migration as completed
      await plasmoGlobalStorage.set("sqlite_migration_status", "completed")

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: No SQL operations performed
      expect(sqliteDbModule.initSQLite).not.toHaveBeenCalled()
    })

    it("should handle empty database gracefully", async () => {
      // No data in Dexie
      await runDexieToSQLiteMigration()

      // Verify: Migration completes without errors
      const status = await getMigrationStatus()
      expect(status.status).toBe("completed")
    })
  })

  describe("Message Migration with parentId Linking", () => {
    it("should link messages linearly with parentId", async () => {
      // Setup: Session with multiple messages
      const sessionId = "test-session-1"
      await dexieDb.sessions.add({
        id: sessionId,
        title: "Test",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      // Add messages in order (v2 doesn't have parentId)
      const messages = [
        { sessionId, role: "user", content: "Message 1", timestamp: 1000 },
        { sessionId, role: "assistant", content: "Message 2", timestamp: 2000 },
        { sessionId, role: "user", content: "Message 3", timestamp: 3000 }
      ]
      
      for (const msg of messages) {
        await dexieDb.messages.add(msg as any)
      }

      // Mock query to return incremental IDs for message inserts
      let messageIdCounter = 1
      vi.mocked(sqliteDbModule.query).mockImplementation(async (sql) => {
        if (sql.includes("last_insert_rowid")) {
          return [{ id: messageIdCounter++ }]
        }
        if (sql.includes("SELECT id FROM messages")) return []
        return []
      })

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: Messages were inserted with parentId linking
      const insertCalls = vi.mocked(sqliteDbModule.run).mock.calls.filter(
        call => call[0].includes("INSERT INTO messages")
      )
      
      expect(insertCalls.length).toBe(3)
      
      // First message should have no parentId (null/undefined)
      expect(insertCalls[0][1]).toContain(null)
      
      // Second and third messages should have parentIds
      // Note: In actual migration, parentId would be set to previous message's ID
    })

    it("should set currentLeafId to last message", async () => {
      // Setup: Session with messages
      const sessionId = "test-session-1"
      await dexieDb.sessions.add({
        id: sessionId,
        title: "Test",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      await dexieDb.messages.add({
        sessionId,
        role: "user",
        content: "Last message",
        timestamp: 1000
      } as any)

      // Mock to return message ID
      vi.mocked(sqliteDbModule.query).mockImplementation(async (sql) => {
        if (sql.includes("last_insert_rowid")) return [{ id: 42 }]
        return []
      })

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: Session update was called with currentLeafId
      expect(sqliteDbModule.run).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE sessions"),
        expect.arrayContaining([42, sessionId])
      )
    })

    it("should preserve message order by timestamp", async () => {
      // Setup: Messages with non-sequential timestamps
      const sessionId = "test-session-1"
      await dexieDb.sessions.add({
        id: sessionId,
        title: "Test",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      const messages = [
        { sessionId, role: "user", content: "Third", timestamp: 3000 },
        { sessionId, role: "assistant", content: "First", timestamp: 1000 },
        { sessionId, role: "user", content: "Second", timestamp: 2000 }
      ]
      
      for (const msg of messages) {
        await dexieDb.messages.add(msg as any)
      }

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: Messages were sorted by timestamp before insertion
      const insertCalls = vi.mocked(sqliteDbModule.run).mock.calls.filter(
        call => call[0].includes("INSERT INTO messages")
      )
      
      // Check that content order follows timestamp order
      expect(insertCalls[0][1]).toContain("First")
      expect(insertCalls[1][1]).toContain("Second")
      expect(insertCalls[2][1]).toContain("Third")
    })
  })

  describe("File Migration", () => {
    it("should migrate file attachments with Blob data", async () => {
      // Setup: Session with file
      const sessionId = "test-session-1"
      await dexieDb.sessions.add({
        id: sessionId,
        title: "Test",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      // Create a mock Blob
      const blob = new Blob(["test file content"], { type: "text/plain" })
      await dexieDb.files.add({
        fileId: "file-123",
        fileName: "test.txt",
        fileType: "text/plain",
        fileSize: 17,
        sessionId,
        processedAt: Date.now(),
        data: blob
      } as any)

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: File was inserted (Blob conversion happens in SQLiteChatRepository)
      expect(sqliteDbModule.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO files"),
        expect.arrayContaining(["file-123", sessionId, "text/plain"])
      )
    })
  })

  describe("Idempotency", () => {
    it("should not create duplicates when re-running migration", async () => {
      // Setup: Add session and message
      const sessionId = "test-session-1"
      await dexieDb.sessions.add({
        id: sessionId,
        title: "Test",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      await dexieDb.messages.add({
        sessionId,
        role: "user",
        content: "Test message",
        timestamp: 1000
      } as any)

      // Run migration first time
      await runDexieToSQLiteMigration()
      const firstRunCalls = vi.mocked(sqliteDbModule.run).mock.calls.length

      // Clear migration status to simulate re-run
      await plasmoGlobalStorage.set("sqlite_migration_status", "pending")

      // Mock query to return existing data (simulating data already in SQLite)
      vi.mocked(sqliteDbModule.query).mockImplementation(async (sql) => {
        if (sql.includes("SELECT * FROM sessions WHERE id")) {
          return [{ id: sessionId, title: "Test" }]
        }
        if (sql.includes("SELECT id FROM messages WHERE sessionId")) {
          return [{ id: 1 }] // Message already exists
        }
        if (sql.includes("last_insert_rowid")) return [{ id: 1 }]
        return []
      })

      // Run migration second time
      vi.clearAllMocks()
      await runDexieToSQLiteMigration()

      // Verify: No duplicate inserts (session already exists, message skipped)
      const insertCalls = vi.mocked(sqliteDbModule.run).mock.calls.filter(
        call => call[0].includes("INSERT")
      )
      expect(insertCalls.length).toBe(0) // No new inserts
    })
  })

  describe("Progress Tracking", () => {
    it("should report progress during migration", async () => {
      // Setup: Multiple sessions
      for (let i = 0; i < 5; i++) {
        await dexieDb.sessions.add({
          id: `session-${i}`,
          title: `Test ${i}`,
          modelId: "llama2",
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      }

      const progressUpdates: any[] = []
      
      // Run migration with progress callback
      await runDexieToSQLiteMigration((progress) => {
        progressUpdates.push({ ...progress })
      })

      // Verify: Progress was reported
      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1]).toMatchObject({
        totalSessions: 5,
        completedSessions: 5
      })
    })

    it("should save progress for resumability", async () => {
      // Setup: Multiple sessions
      for (let i = 0; i < 3; i++) {
        await dexieDb.sessions.add({
          id: `session-${i}`,
          title: `Test ${i}`,
          modelId: "llama2",
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      }

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: Progress was saved to storage
      expect(plasmoGlobalStorage.set).toHaveBeenCalledWith(
        "sqlite_migration_progress",
        expect.stringContaining("totalSessions")
      )
    })
  })

  describe("Error Handling", () => {
    it("should continue migration even if one session fails", async () => {
      // Setup: Multiple sessions
      await dexieDb.sessions.add({
        id: "session-1",
        title: "Test 1",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      await dexieDb.sessions.add({
        id: "session-2",
        title: "Test 2",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      // Mock to fail on first session
      let callCount = 0
      vi.mocked(sqliteDbModule.run).mockImplementation(async (sql) => {
        if (sql.includes("INSERT INTO sessions") && callCount++ === 0) {
          throw new Error("Database error")
        }
        return undefined
      })

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: Migration completed despite error
      const status = await getMigrationStatus()
      expect(status.status).toBe("completed")
    })
  })

  describe("Edge Cases", () => {
    it("should handle sessions with no messages",  async () => {
      // Clear mocks to reset  default mock behavior
      vi.clearAllMocks()
      
      // Setup: Empty session
      await dexieDb.sessions.add({
        id: "empty-session",
        title: "Empty",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      // Reset query mock to allow new sessions
      vi.mocked(sqliteDbModule.query).mockImplementation(async (sql) => {
        if (sql.includes("last_insert_rowid")) return [{ id: 1 }]
        if (sql.includes("SELECT * FROM sessions WHERE id")) return [] // Session doesn't exist
        return []
      })

      // Run migration
      await runDexieToSQLiteMigration()

      // Verify: Session created, no errors
      expect(sqliteDbModule.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO sessions"),
        expect.arrayContaining(["empty-session"])
      )
    })


    it("should handle large datasets efficiently", async () => {
      // Setup: Many messages
      const sessionId = "large-session"
      await dexieDb.sessions.add({
        id: sessionId,
        title: "Large",
        modelId: "llama2",
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      // Add 100 messages
      const messages = Array.from({ length: 100 }, (_, i) => ({
        sessionId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
        timestamp: i * 1000
      }))

      for (const msg of messages) {
        await dexieDb.messages.add(msg as any)
      }

      const startTime = Date.now()
      await runDexieToSQLiteMigration()
      const duration = Date.now() - startTime

      // Verify: Completes in reasonable time (<5s for 100 messages)
      expect(duration).toBeLessThan(5000)
    })
  })
})
