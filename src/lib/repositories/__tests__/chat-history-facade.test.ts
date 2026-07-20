import { describe, expect, it, vi } from "vitest"

vi.mock("../sqlite-chat-history", () => ({
  getAllSessionsOrderedByRecency: vi.fn(async () => "sqlite:getAllSessions"),
  getAllSessions: vi.fn(),
  getSession: vi.fn(),
  getLatestSession: vi.fn(),
  addSession: vi.fn(),
  bulkPutSessions: vi.fn(),
  updateSession: vi.fn(),
  deleteSessionRow: vi.fn(),
  getMessage: vi.fn(),
  countMessages: vi.fn(),
  getAllMessages: vi.fn(),
  getMessagesPaginated: vi.fn(),
  getMessagesBySessionOrderedByTimestamp: vi.fn(),
  getMessagesBySession: vi.fn(),
  getMessagesBySessionAtTimestamp: vi.fn(),
  getMessagesByParents: vi.fn(),
  getRootMessagesForSession: vi.fn(),
  addMessage: vi.fn(),
  appendMessage: vi.fn(),
  updateMessage: vi.fn(),
  finalizeInterruptedMessages: vi.fn(),
  deleteMessagesBySession: vi.fn(),
  bulkDeleteMessages: vi.fn(),
  getFilesByMessageIds: vi.fn(),
  bulkAddFiles: vi.fn(),
  deleteFilesBySession: vi.fn(),
  deleteFilesByMessageIds: vi.fn(),
  dropDatabase: vi.fn()
}))

import * as sqliteRepo from "../sqlite-chat-history"

describe("chat-history facade", () => {
  it("routes chat history through SQLite", async () => {
    const facade = await import("../chat-history")

    const result = await facade.getAllSessionsOrderedByRecency()

    expect(result).toBe("sqlite:getAllSessions")
    expect(sqliteRepo.getAllSessionsOrderedByRecency).toHaveBeenCalledTimes(1)
  })
})
