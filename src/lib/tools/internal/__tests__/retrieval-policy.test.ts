import type { RetrievalPolicy } from "@ollama-client/contracts/context"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  retrieveContextEnhanced,
  formatEnhancedResults
} from "@/application/context/rag/rag-pipeline"
import { resolveRetrievalPolicy } from "@/application/context/retrieval-policy"
import {
  getActiveKnowledgeSet,
  getKnowledgeSetFileIds
} from "@/lib/knowledge/knowledge-sets"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { runFileSearch } from "../file-search-tool"
import { runRagSearch } from "../rag-search-tool"

vi.mock("@/lib/storage/setting-access", () => ({ readSetting: vi.fn() }))
vi.mock("@/lib/knowledge/knowledge-sets", () => ({
  DEFAULT_KNOWLEDGE_SET_ID: "default",
  getActiveKnowledgeSet: vi.fn(),
  getKnowledgeSetFileIds: vi.fn(async () => ["allowed-file"])
}))
vi.mock("@/application/context/rag/rag-pipeline", () => ({
  retrieveContextEnhanced: vi.fn(),
  formatEnhancedResults: vi.fn(() => ({
    formattedContext: "allowed",
    sources: []
  }))
}))

const policy: RetrievalPolicy = {
  memoryEnabled: true,
  ragEnabled: true,
  groundedOnlyMode: false,
  fileIds: ["allowed-file"]
}
describe("turn-scoped retrieval tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readSetting).mockResolvedValue(true)
    vi.mocked(retrieveContextEnhanced).mockResolvedValue([])
  })
  it("keeps the default set out of the automatic corpus", async () => {
    vi.mocked(getActiveKnowledgeSet).mockResolvedValueOnce({
      id: "default"
    } as never)
    const resolved = await resolveRetrievalPolicy({
      memoryEnabled: true,
      groundedOnlyMode: false
    })
    expect(resolved.fileIds).toEqual([])
    expect(resolved.knowledgeSetId).toBeUndefined()
    expect(getKnowledgeSetFileIds).not.toHaveBeenCalled()
  })

  it("refuses memory when disabled while allowing scoped file search", async () => {
    vi.mocked(readSetting).mockImplementation(async (setting) =>
      setting === SETTINGS.MEMORY_ENABLED ? false : (true as never)
    )
    expect(
      (await runRagSearch({ query: "canary" }, { retrievalPolicy: policy }))
        .isError
    ).toBe(true)
    expect(retrieveContextEnhanced).not.toHaveBeenCalled()
    await runFileSearch({ query: "document" }, { retrievalPolicy: policy })
    expect(retrieveContextEnhanced).toHaveBeenCalledWith(
      "document",
      expect.objectContaining({
        fileId: ["allowed-file"],
        includeMemory: false
      })
    )
  })
  it.each([
    undefined,
    { ...policy, fileIds: [] },
    { ...policy, groundedOnlyMode: true }
  ])(
    "never turns an absent or forbidden file scope into the whole corpus",
    async (retrievalPolicy) => {
      expect(
        (await runFileSearch({ query: "canary" }, { retrievalPolicy })).isError
      ).toBe(true)
      expect(retrieveContextEnhanced).not.toHaveBeenCalled()
    }
  )
  it("rejects an already aborted turn before any retrieval", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runFileSearch(
        { query: "canary" },
        { retrievalPolicy: policy, signal: controller.signal }
      )
    ).rejects.toThrow()
    expect(retrieveContextEnhanced).not.toHaveBeenCalled()
  })
  it("withholds a result if memory was disabled while retrieval ran", async () => {
    vi.mocked(retrieveContextEnhanced).mockImplementation(async () => {
      vi.mocked(readSetting).mockResolvedValue(false)
      return [
        {
          document: {
            id: 1,
            content: "SECRET-CANARY",
            embedding: [1],
            metadata: { source: "chat", type: "chat", timestamp: 1 }
          },
          score: 1
        }
      ]
    })
    const result = await runRagSearch(
      { query: "canary" },
      { retrievalPolicy: policy }
    )
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain("SECRET-CANARY")
    expect(formatEnhancedResults).not.toHaveBeenCalled()
  })
})
