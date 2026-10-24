import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "@/lib/browser-api"
import { vectorDb } from "@/lib/embeddings/db"
import { getMessage } from "@/lib/repositories/chat-history"
import { getContextReceiptForMessage } from "@/lib/repositories/turn-runs"
import { readTabContent } from "@/lib/tools/internal/tab-utils"
import type { BuildRagContextOptions } from "../build-context"
import {
  captureContextSelection,
  restoreReplayContext
} from "../context-replay"

vi.mock("@/lib/knowledge/knowledge-sets", () => ({
  getKnowledgeSetFileIds: vi.fn(async () => ["set-file"])
}))
vi.mock("@/lib/repositories/chat-history", () => ({ getMessage: vi.fn() }))
vi.mock("@/lib/repositories/turn-runs", () => ({
  getContextReceiptForMessage: vi.fn()
}))
vi.mock("@/lib/browser-api", () => ({ browser: { tabs: { get: vi.fn() } } }))
vi.mock("@/lib/tools/internal/tab-utils", () => ({ readTabContent: vi.fn() }))
vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: vi.fn(async () => true)
}))
vi.mock("@/lib/embeddings/db", () => ({
  vectorDb: {
    vectors: {
      get: vi.fn(),
      where: () => ({
        equals: () => ({ count: async () => 0, sortBy: async () => [] })
      })
    }
  }
}))

const options: BuildRagContextOptions = {
  rawInput: "Question",
  messages: [],
  hasTabContext: true,
  contextText: "page",
  tabDocuments: [{ id: "7", title: "Page", content: "page" }],
  memoryEnabled: false,
  groundedOnlyMode: true,
  maxTabContextChars: 1000,
  maxRagContextChars: 2000,
  selectedModel: "test",
  selectedModelRef: null
}
const policy = {
  memoryEnabled: false,
  ragEnabled: true,
  groundedOnlyMode: true,
  fileIds: []
}
describe("replaying recorded evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 7,
      url: "https://example.com/original"
    } as never)
    vi.mocked(readTabContent).mockResolvedValue({ html: "page" } as never)
  })
  it("restores the original page-only scope and its limits", async () => {
    const selection = await captureContextSelection(options, policy)
    vi.mocked(getContextReceiptForMessage).mockResolvedValue({
      selection,
      sources: []
    } as never)
    const restored = await restoreReplayContext({
      ...options,
      replayOfUserMessageId: 1,
      hasTabContext: false,
      tabDocuments: [],
      groundedOnlyMode: false,
      maxRagContextChars: 99999
    })
    expect(restored).toMatchObject({
      hasTabContext: true,
      groundedOnlyMode: true,
      maxRagContextChars: 2000,
      tabDocuments: [{ id: "7", content: "page" }],
      retrievalPolicy: policy
    })
    expect(JSON.stringify(selection)).not.toContain("https://example.com")
  })
  it("asks before using a tab that has navigated", async () => {
    const selection = await captureContextSelection(options, policy)
    vi.mocked(getContextReceiptForMessage).mockResolvedValue({
      selection,
      sources: []
    } as never)
    vi.mocked(browser.tabs.get).mockResolvedValue({
      id: 7,
      url: "https://example.com/other"
    } as never)
    await expect(
      restoreReplayContext({ ...options, replayOfUserMessageId: 1 })
    ).rejects.toThrow(/current context/)
  })
  it.each(["deleted", "edited"])(
    "refuses %s memory evidence instead of searching again",
    async (status) => {
      vi.mocked(getContextReceiptForMessage).mockResolvedValue({
        selection: {
          policy: { ...policy, memoryEnabled: true, groundedOnlyMode: false },
          hasTabContext: false,
          tabs: [],
          maxTabContextChars: 1000,
          maxRagContextChars: 2000
        },
        sources: [
          { id: 12, source: "memory", excerpt: "Remembered preference" }
        ]
      } as never)
      vi.mocked(vectorDb.vectors.get).mockResolvedValue(
        status === "deleted"
          ? undefined
          : ({
              content: "Remembered preference",
              metadata: {
                type: "chat",
                messageId: 1,
                messageRevision: "old-revision"
              }
            } as never)
      )
      vi.mocked(getMessage).mockResolvedValue({
        content: "Corrected preference",
        role: "user",
        sessionId: "chat",
        timestamp: 1
      })
      await expect(
        restoreReplayContext({ ...options, replayOfUserMessageId: 1 })
      ).rejects.toThrow(/original sources/)
    }
  )
  it("does not replace a deleted file with a global search", async () => {
    vi.mocked(getContextReceiptForMessage).mockResolvedValue({
      selection: {
        policy: {
          ...policy,
          groundedOnlyMode: false,
          fileIds: ["deleted-file"]
        },
        hasTabContext: false,
        tabs: [],
        maxTabContextChars: 1000,
        maxRagContextChars: 2000
      },
      sources: []
    } as never)
    await expect(
      restoreReplayContext({ ...options, replayOfUserMessageId: 1 })
    ).rejects.toThrow(/original sources/)
  })
  it("validates knowledge-set chunks without constructing a full-file fallback", async () => {
    const sortBy = vi.fn()
    vi.spyOn(vectorDb.vectors, "where").mockReturnValue({
      equals: () => ({ count: async () => 1, sortBy })
    } as never)
    vi.mocked(vectorDb.vectors.get).mockResolvedValue({
      content: "selected chunk",
      metadata: { fileId: "set-file", type: "file" }
    } as never)
    vi.mocked(getContextReceiptForMessage).mockResolvedValue({
      selection: {
        policy: {
          ...policy,
          groundedOnlyMode: false,
          knowledgeSetId: "selected-set",
          fileIds: ["set-file"]
        },
        hasTabContext: false,
        tabs: [],
        maxTabContextChars: 1000,
        maxRagContextChars: 2000
      },
      sources: [
        { id: 4, fileId: "set-file", source: "file", excerpt: "selected chunk" }
      ]
    } as never)
    const restored = await restoreReplayContext({
      ...options,
      replayOfUserMessageId: 1
    })
    expect(restored.files).toEqual([])
    expect(sortBy).not.toHaveBeenCalled()
  })
})
