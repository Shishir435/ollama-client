import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the db module so we can capture SQL strings + bindings without
// booting sql.js for every test.
vi.mock("@/lib/sqlite/db", () => ({
  query: vi.fn(),
  run: vi.fn(),
  flushSave: vi.fn().mockResolvedValue(undefined),
  resetSQLiteDatabase: vi.fn().mockResolvedValue(undefined)
}))

import { query, resetSQLiteDatabase, run } from "@/lib/sqlite/db"

import * as repo from "../sqlite-chat-history"

const mockedQuery = vi.mocked(query)
const mockedRun = vi.mocked(run)
const mockedReset = vi.mocked(resetSQLiteDatabase)

beforeEach(() => {
  mockedQuery.mockReset()
  mockedRun.mockReset()
  mockedReset.mockReset()
})

describe("sessions", () => {
  it("getAllSessionsOrderedByRecency runs the ORDER BY updatedAt query", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        id: "s1",
        title: "T",
        modelId: "m",
        currentLeafId: 5,
        createdAt: 1,
        updatedAt: 2
      }
    ])
    const result = await repo.getAllSessionsOrderedByRecency()
    expect(mockedQuery).toHaveBeenCalledWith(
      "SELECT * FROM sessions ORDER BY updatedAt DESC"
    )
    expect(result).toEqual([
      {
        id: "s1",
        title: "T",
        modelId: "m",
        currentLeafId: 5,
        createdAt: 1,
        updatedAt: 2,
        pinned: false,
        messages: []
      }
    ])
  })

  it("getSession returns undefined for an empty result", async () => {
    mockedQuery.mockResolvedValueOnce([])
    expect(await repo.getSession("nope")).toBeUndefined()
  })

  it("getLatestSession runs LIMIT 1 query", async () => {
    mockedQuery.mockResolvedValueOnce([])
    await repo.getLatestSession()
    expect(mockedQuery).toHaveBeenCalledWith(
      "SELECT * FROM sessions ORDER BY createdAt DESC LIMIT 1"
    )
  })

  it("addSession runs INSERT with the session payload", async () => {
    mockedRun.mockResolvedValueOnce(undefined)
    const result = await repo.addSession({
      id: "s9",
      title: "Hi",
      modelId: "m",
      currentLeafId: 4,
      createdAt: 100,
      updatedAt: 200,
      messages: []
    })
    expect(result).toBe("s9")
    expect(mockedRun).toHaveBeenCalledTimes(1)
    const [sql, params] = mockedRun.mock.calls[0]
    expect(sql).toContain("INSERT INTO sessions")
    expect(params).toEqual(["s9", "Hi", "m", 4, 100, 200, 0, null])
  })

  it("bulkPutSessions runs INSERT OR REPLACE for each row", async () => {
    mockedRun.mockResolvedValue(undefined)
    await repo.bulkPutSessions([
      {
        id: "a",
        title: "A",
        createdAt: 1,
        updatedAt: 1,
        messages: []
      },
      {
        id: "b",
        title: "B",
        createdAt: 2,
        updatedAt: 2,
        messages: []
      }
    ])
    expect(mockedRun).toHaveBeenCalledTimes(2)
    for (const call of mockedRun.mock.calls) {
      expect(call[0]).toContain("INSERT OR REPLACE INTO sessions")
    }
  })

  it("bulkPutSessions persists imported messages and image files with fresh ids", async () => {
    mockedRun.mockResolvedValue(undefined)
    // Every insertImportedMessage reads last_insert_rowid for the new id.
    mockedQuery.mockResolvedValue([{ id: 10 }])
    await repo.bulkPutSessions([
      {
        id: "s-img",
        title: "Images",
        createdAt: 1,
        updatedAt: 1,
        messages: [
          {
            id: 99,
            role: "user",
            content: "see image",
            timestamp: 100,
            images: [
              {
                imageId: "img-1",
                fileName: "photo.png",
                mimeType: "image/png",
                size: 3,
                base64: "AQID"
              }
            ]
          }
        ]
      }
    ])

    expect(mockedRun.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN IMMEDIATE",
      expect.stringContaining("INSERT OR REPLACE INTO sessions"),
      "DELETE FROM files WHERE sessionId = ?",
      "DELETE FROM messages WHERE sessionId = ?",
      expect.stringContaining("INSERT INTO messages"),
      expect.stringContaining("INSERT INTO files"),
      "UPDATE sessions SET currentLeafId = ? WHERE id = ?",
      "COMMIT"
    ])

    // The exported id (99) must NOT be reused: no OR REPLACE, and the id is not
    // in the message insert params — it gets a fresh autoincrement id instead.
    const msgInsert = mockedRun.mock.calls[4]
    expect(msgInsert[0]).not.toContain("OR REPLACE")
    expect(msgInsert[1]).not.toContain(99)
    expect(msgInsert[1]?.slice(0, 4)).toEqual([
      "s-img",
      "user",
      "see image",
      null
    ])
    // Files are keyed to the new message id (10) from last_insert_rowid.
    const fileInsert = mockedRun.mock.calls[5]
    expect(fileInsert[1]?.slice(0, 4)).toEqual([
      "img-1",
      "s-img",
      10,
      "image/png"
    ])
  })

  it("bulkPutSessions remaps parentId links to the freshly-allocated ids", async () => {
    mockedRun.mockResolvedValue(undefined)
    // Two messages get new ids 100 then 101 (parent inserted before child).
    mockedQuery
      .mockResolvedValueOnce([{ id: 100 }])
      .mockResolvedValueOnce([{ id: 101 }])

    await repo.bulkPutSessions([
      {
        id: "s-tree",
        title: "Tree",
        createdAt: 1,
        updatedAt: 1,
        currentLeafId: 2,
        messages: [
          { id: 1, role: "user", content: "q", timestamp: 1 },
          { id: 2, role: "assistant", content: "a", timestamp: 2, parentId: 1 }
        ]
      }
    ])

    const updates = mockedRun.mock.calls.filter(([sql]) =>
      String(sql).startsWith("UPDATE messages SET parentId")
    )
    // Child's old parentId (1) is remapped to the parent's new id (100), and
    // the update targets the child's new id (101).
    expect(updates).toHaveLength(1)
    expect(updates[0][1]).toEqual([100, 101])

    // Session's currentLeafId (old 2) is remapped to the new id (101).
    const leafUpdate = mockedRun.mock.calls.find(
      ([sql]) => sql === "UPDATE sessions SET currentLeafId = ? WHERE id = ?"
    )
    expect(leafUpdate?.[1]).toEqual([101, "s-tree"])
  })

  it("bulkPutSessions rolls back imported message insert on failure", async () => {
    const importError = new Error("quota exceeded")
    mockedQuery.mockResolvedValue([{ id: 10 }])
    mockedRun.mockImplementation(async (sql) => {
      if (String(sql).includes("INSERT INTO messages")) {
        throw importError
      }
    })

    await expect(
      repo.bulkPutSessions([
        {
          id: "s-fail",
          title: "Fail",
          createdAt: 1,
          updatedAt: 1,
          messages: [
            {
              id: 11,
              role: "user",
              content: "boom",
              timestamp: 100
            }
          ]
        }
      ])
    ).rejects.toThrow("quota exceeded")

    expect(mockedRun.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN IMMEDIATE",
      expect.stringContaining("INSERT OR REPLACE INTO sessions"),
      "DELETE FROM files WHERE sessionId = ?",
      "DELETE FROM messages WHERE sessionId = ?",
      expect.stringContaining("INSERT INTO messages"),
      "ROLLBACK"
    ])
  })

  it("updateSession builds a partial UPDATE only for present fields", async () => {
    mockedRun.mockResolvedValueOnce(undefined)
    await repo.updateSession("s1", { title: "renamed", updatedAt: 123 })
    const [sql, params] = mockedRun.mock.calls[0]
    expect(sql).toBe(
      "UPDATE sessions SET title = ?, updatedAt = ? WHERE id = ?"
    )
    expect(params).toEqual(["renamed", 123, "s1"])
  })

  it("updateSession is a no-op when no recognized fields are present", async () => {
    const count = await repo.updateSession("s1", {})
    expect(count).toBe(0)
    expect(mockedRun).not.toHaveBeenCalled()
  })

  it("deleteSessionRow runs a DELETE on sessions", async () => {
    mockedRun.mockResolvedValueOnce(undefined)
    await repo.deleteSessionRow("s1")
    expect(mockedRun).toHaveBeenCalledWith(
      "DELETE FROM sessions WHERE id = ?",
      ["s1"]
    )
  })
})

describe("messages", () => {
  it("messageFromRow normalizes done/metrics/thinking from SQL types", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        id: 1,
        sessionId: "s1",
        role: "assistant",
        content: "Hi",
        model: "m",
        timestamp: 5,
        parentId: null,
        done: 0,
        metrics: '{"prompt_eval_count":3}',
        thinking: "reasoning..."
      }
    ])
    const [msg] = await repo.getAllMessages()
    expect(msg.done).toBe(false)
    expect(msg.parentId).toBeUndefined()
    expect(msg.metrics).toEqual({ prompt_eval_count: 3 })
    expect(msg.thinking).toBe("reasoning...")
  })

  it("messageFromRow preserves persisted web-search tool sources", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        id: 1,
        sessionId: "s1",
        role: "assistant",
        content: "Answer with citations",
        model: "m",
        timestamp: 5,
        parentId: null,
        done: 1,
        metrics: JSON.stringify({
          toolRuns: [
            {
              toolId: "web_search",
              label: "web_search",
              category: "web",
              status: "done",
              startedAt: 1,
              completedAt: 2,
              sources: [
                {
                  id: "call-1:web-0",
                  title: "Example",
                  url: "https://example.com",
                  excerpt: "snippet",
                  score: null,
                  used: true
                }
              ]
            }
          ]
        }),
        thinking: null
      }
    ])

    const [msg] = await repo.getAllMessages()

    expect(msg.metrics?.toolRuns?.[0]).toMatchObject({
      toolId: "web_search",
      status: "done",
      sources: [
        {
          id: "call-1:web-0",
          title: "Example",
          url: "https://example.com",
          excerpt: "snippet",
          used: true
        }
      ]
    })
  })

  it("messageFromRow tolerates malformed JSON in metrics", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        id: 1,
        sessionId: "s1",
        role: "user",
        content: "Q",
        timestamp: 1,
        done: 1,
        metrics: "{not json"
      }
    ])
    const [msg] = await repo.getAllMessages()
    expect(msg.metrics).toBeUndefined()
  })

  it("countMessages reads the COUNT(*) result", async () => {
    mockedQuery.mockResolvedValueOnce([{ count: 7 }])
    expect(await repo.countMessages()).toBe(7)
  })

  it("getMessagesPaginated passes limit and offset", async () => {
    mockedQuery.mockResolvedValueOnce([])
    await repo.getMessagesPaginated(20, 10)
    const [sql, params] = mockedQuery.mock.calls[0]
    expect(sql).toBe("SELECT * FROM messages ORDER BY id LIMIT ? OFFSET ?")
    expect(params).toEqual([10, 20])
  })

  it("getMessagesByParents returns empty list without hitting the db when no ids given", async () => {
    expect(await repo.getMessagesByParents([])).toEqual([])
    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it("getMessagesByParents builds an IN clause sized to the input", async () => {
    mockedQuery.mockResolvedValueOnce([])
    await repo.getMessagesByParents([1, 2, 3])
    const [sql, params] = mockedQuery.mock.calls[0]
    expect(sql).toBe("SELECT * FROM messages WHERE parentId IN (?, ?, ?)")
    expect(params).toEqual([1, 2, 3])
  })

  it("getRootMessagesForSession filters parentId IS NULL", async () => {
    mockedQuery.mockResolvedValueOnce([])
    await repo.getRootMessagesForSession("s1")
    const [sql] = mockedQuery.mock.calls[0]
    expect(sql).toBe(
      "SELECT * FROM messages WHERE sessionId = ? AND parentId IS NULL"
    )
  })

  it("addMessage INSERTs and reads last_insert_rowid", async () => {
    mockedRun.mockResolvedValueOnce(undefined)
    mockedQuery.mockResolvedValueOnce([{ id: 42 }])
    const id = await repo.addMessage({
      sessionId: "s1",
      role: "user",
      content: "Hi",
      timestamp: 100,
      done: true
    })
    expect(id).toBe(42)
    const [insertSql, insertParams] = mockedRun.mock.calls[0]
    expect(insertSql).toContain("INSERT INTO messages")
    expect(insertParams).toEqual([
      "s1",
      "user",
      "Hi",
      null,
      100,
      null,
      1,
      null,
      null
    ])
  })

  it("updateMessage stringifies metrics and encodes done as 0/1", async () => {
    mockedRun.mockResolvedValueOnce(undefined)
    await repo.updateMessage(5, { metrics: { eval_count: 1 }, done: false })
    const [sql, params] = mockedRun.mock.calls[0]
    expect(sql).toBe("UPDATE messages SET done = ?, metrics = ? WHERE id = ?")
    expect(params).toEqual([0, '{"eval_count":1}', 5])
  })

  it("updateMessage with empty updates returns 0 and does not run SQL", async () => {
    const result = await repo.updateMessage(5, {})
    expect(result).toBe(0)
    expect(mockedRun).not.toHaveBeenCalled()
  })

  it("bulkDeleteMessages noops on empty input", async () => {
    await repo.bulkDeleteMessages([])
    expect(mockedRun).not.toHaveBeenCalled()
  })

  it("bulkDeleteMessages builds an IN clause", async () => {
    mockedRun.mockResolvedValueOnce(undefined)
    await repo.bulkDeleteMessages([10, 20, 30])
    const [sql, params] = mockedRun.mock.calls[0]
    expect(sql).toBe("DELETE FROM messages WHERE id IN (?, ?, ?)")
    expect(params).toEqual([10, 20, 30])
  })
})

describe("files", () => {
  it("getFilesByMessageIds returns [] for empty ids without db call", async () => {
    expect(await repo.getFilesByMessageIds([])).toEqual([])
    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it("getFilesByMessageIds builds IN clause", async () => {
    mockedQuery.mockResolvedValueOnce([])
    await repo.getFilesByMessageIds([1, 2])
    const [sql, params] = mockedQuery.mock.calls[0]
    expect(sql).toBe("SELECT * FROM files WHERE messageId IN (?, ?)")
    expect(params).toEqual([1, 2])
  })

  it("bulkAddFiles passes Uint8Array data through, null when missing", async () => {
    mockedRun.mockResolvedValue(undefined)
    const blob = new Uint8Array([1, 2, 3])
    await repo.bulkAddFiles([
      {
        fileId: "a",
        sessionId: "s1",
        messageId: 1,
        fileType: "text",
        fileName: "a.txt",
        fileSize: 3,
        processedAt: 100,
        data: blob
      },
      {
        fileId: "b",
        sessionId: "s1",
        fileType: "text",
        fileName: "b.txt",
        fileSize: 0,
        processedAt: 200
      }
    ])
    expect(mockedRun).toHaveBeenCalledTimes(2)
    expect(mockedRun.mock.calls[0][1]?.at(-1)).toBe(blob)
    expect(mockedRun.mock.calls[1][1]?.at(-1)).toBeNull()
  })
})

describe("dropDatabase", () => {
  it("delegates to resetSQLiteDatabase", async () => {
    await repo.dropDatabase()
    expect(mockedReset).toHaveBeenCalledTimes(1)
  })
})
