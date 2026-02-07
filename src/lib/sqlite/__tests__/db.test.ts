import { describe, it, expect, beforeEach, vi } from "vitest"
import { SQLiteChatRepository } from "../../repositories/sqlite-chat-repository"
import * as dbModule from "../db"

// Mock the DB module
vi.mock("../db", () => {
  const mockDb = {
    exec: vi.fn((opts) => {
      // Simple mock for testing SQL generation/flow
      // In a real test we'd use an in-memory SQLite instance
      if (opts.callback && opts.sql.includes("SELECT")) {
         // Return mock data based on query
         if (opts.sql.includes("sessions")) {
           opts.callback({ id: "session-1", title: "Test Session" })
         }
         if (opts.sql.includes("messages")) {
           opts.callback({ id: 1, sessionId: "session-1", content: "Hello" })
         }
         if (opts.sql.includes("last_insert_rowid")) {
           opts.callback({ id: 1 })
         }
      }
    })
  }
  
  return {
    getDb: vi.fn().mockResolvedValue(mockDb),
    run: vi.fn().mockImplementation(async (sql, bind) => {
      // Just verify call happened
      return
    }),
    query: vi.fn().mockImplementation(async (sql, bind) => {
      if (sql.includes("last_insert_rowid")) return [{ id: 1 }]
      if (sql.includes("SELECT * FROM sessions")) return [{ id: "session-1", title: "Test Session" }]
      if (sql.includes("SELECT * FROM messages")) return [{ id: 1, sessionId: "session-1", content: "Hello", role: "user", timestamp: 123, done: 1 }]
      return []
    }),
    initSQLite: vi.fn()
  }
})

describe("SQLiteChatRepository", () => {
  let repo: SQLiteChatRepository

  beforeEach(() => {
    repo = new SQLiteChatRepository()
    vi.clearAllMocks()
  })

  it("should create a session", async () => {
    const session = {
      id: "session-1",
      modelId: "llama2",
      createdAt: 1000,
      updatedAt: 1000,
      messages: []
    }
    
    await repo.createSession(session as any)
    
    expect(dbModule.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO sessions"),
      expect.arrayContaining(["session-1", "llama2"])
    )
  })

  it("should get a session", async () => {
    const session = await repo.getSession("session-1")
    expect(session).toBeDefined()
    expect(session?.id).toBe("session-1")
  })

  it("should add a message", async () => {
    const message = {
      role: "user",
      content: "Hello",
      timestamp: 1000,
      done: true
    }
    
    const id = await repo.addMessage("session-1", message as any)
    
    expect(id).toBe(1)
    expect(dbModule.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO messages"),
      expect.arrayContaining(["session-1", "user", "Hello"])
    )
  })
})
