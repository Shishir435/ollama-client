import { beforeEach, describe, expect, it, vi } from "vitest"

// Every external dep is mocked at the module boundary so we can drive
// the orchestration logic deterministically without booting the real
// RAG pipeline. Imports go BELOW the vi.mock calls — vitest hoists
// them, but explicit ordering helps when reading the file top to bottom.

vi.mock("@/features/chat/rag", () => ({
  reformulateQuestion: vi.fn(),
  retrieveContext: vi.fn(),
  retrieveContextFromSources: vi.fn()
}))

vi.mock("@/features/chat/rag/query-classifier", () => ({
  classifyQuery: vi.fn()
}))

vi.mock("@/lib/knowledge/knowledge-sets", () => ({
  DEFAULT_KNOWLEDGE_SET_ID: "default",
  DEFAULT_RAG_PROMPT: "Use context. If absent, say you don't know.",
  getActiveKnowledgeSet: vi.fn(),
  getKnowledgeSetFileIds: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    watch: vi.fn()
  }
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn()
  }
}))

import {
  reformulateQuestion,
  retrieveContext,
  retrieveContextFromSources
} from "@/features/chat/rag"
import { classifyQuery } from "@/features/chat/rag/query-classifier"
import {
  getActiveKnowledgeSet,
  getKnowledgeSetFileIds
} from "@/lib/knowledge/knowledge-sets"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import type { ChatMessage } from "@/types"

import {
  type BuildRagContextOptions,
  buildRagContext
} from "../build-rag-context"

const mockedClassify = vi.mocked(classifyQuery)
const mockedRetrieve = vi.mocked(retrieveContext)
const mockedRetrieveFromSources = vi.mocked(retrieveContextFromSources)
const mockedReformulate = vi.mocked(reformulateQuestion)
const mockedGetActiveKnowledgeSet = vi.mocked(getActiveKnowledgeSet)
const mockedGetKnowledgeSetFileIds = vi.mocked(getKnowledgeSetFileIds)
const mockedStorageGet = vi.mocked(plasmoGlobalStorage.get)
const mockedGetProvider = vi.mocked(ProviderFactory.getProviderForModel)

const toastSpy = vi.fn()

const defaults = (
  overrides: Partial<BuildRagContextOptions> = {}
): BuildRagContextOptions => ({
  rawInput: "Hello",
  files: undefined,
  messages: [],
  hasTabContext: false,
  contextText: "",
  tabDocuments: [],
  memoryEnabled: true,
  maxTabContextChars: 4000,
  maxRagContextChars: 4000,
  groundedOnlyMode: false,
  selectedModel: "llama3",
  selectedModelRef: { providerId: "ollama", modelId: "llama3" },
  customModel: undefined,
  toast: toastSpy,
  ...overrides
})

const ragsetOn = () =>
  mockedClassify.mockReturnValue({
    intent: "knowledge_query",
    confidence: 0.9,
    shouldUseRAG: true,
    suggestedTopK: 5,
    suggestedMode: "hybrid"
  } as never)

beforeEach(() => {
  vi.resetAllMocks()
  // Default to "RAG enabled" so each test only flips what it cares about.
  mockedStorageGet.mockResolvedValue(true as never)
  mockedGetActiveKnowledgeSet.mockResolvedValue(undefined)
  mockedGetKnowledgeSetFileIds.mockResolvedValue([])
  mockedRetrieve.mockResolvedValue({
    documents: [],
    formattedContext: "",
    sources: []
  } as never)
  mockedRetrieveFromSources.mockResolvedValue({
    documents: [],
    formattedContext: "",
    sources: []
  } as never)
  mockedReformulate.mockResolvedValue("")
})

describe("RAG off (storage USE_RAG=false)", () => {
  it("returns the raw user content unchanged and skips classify+retrieve", async () => {
    mockedStorageGet.mockResolvedValueOnce(false as never)
    const result = await buildRagContext(defaults({ rawInput: "Hi there" }))

    expect(result.contentWithRAG).toBe("Hi there")
    expect(result.ragSources).toBeNull()
    expect(result.promptContextStats.ragContextLength).toBe(0)
    expect(result.promptContextStats.tabContextLength).toBe(0)
    expect(result.pageContextAdded).toBe(false)
    expect(mockedClassify).not.toHaveBeenCalled()
    expect(mockedRetrieve).not.toHaveBeenCalled()
  })

  it("undefined USE_RAG storage value defaults to ON", async () => {
    mockedStorageGet.mockResolvedValueOnce(undefined as never)
    ragsetOn()
    await buildRagContext(defaults())
    expect(mockedClassify).toHaveBeenCalledTimes(1)
  })
})

describe("classifier short-circuits", () => {
  it("shouldUseRAG=false skips the entire retrieval block", async () => {
    mockedClassify.mockReturnValue({
      intent: "chitchat",
      confidence: 0.95,
      shouldUseRAG: false,
      suggestedTopK: 0,
      suggestedMode: "hybrid"
    } as never)

    const result = await buildRagContext(defaults({ rawInput: "hey there" }))

    expect(mockedGetActiveKnowledgeSet).not.toHaveBeenCalled()
    expect(mockedRetrieve).not.toHaveBeenCalled()
    expect(result.contentWithRAG).toBe("hey there")
    expect(result.ragSources).toBeNull()
  })
})

describe("file/global retrieval", () => {
  it("appends retrieved context with the DEFAULT_RAG_PROMPT prefix for explicit files", async () => {
    ragsetOn()
    mockedRetrieve.mockResolvedValueOnce({
      documents: [{ id: 1, content: "About llamas", score: 0.9 }],
      formattedContext: "<doc>About llamas</doc>",
      sources: [
        {
          id: 1,
          title: "Wiki: llamas",
          content: "Llamas are South American camelids.",
          score: 0.9,
          source: "wiki",
          chunkIndex: 0
        }
      ]
    } as never)

    const result = await buildRagContext(
      defaults({
        rawInput: "Tell me about llamas",
        files: [
          {
            metadata: {
              fileId: "llama-file",
              fileName: "llamas.txt",
              fileType: "text/plain",
              fileSize: 12,
              processedAt: 0
            },
            text: "About llamas"
          } as never
        ]
      })
    )

    expect(result.contentWithRAG).toContain("Tell me about llamas")
    expect(result.contentWithRAG).toContain("Use context")
    expect(result.contentWithRAG).toContain("<doc>About llamas</doc>")
    expect(result.ragSources?.sources).toHaveLength(1)
    expect(result.ragSources?.query).toBe("Tell me about llamas")
    expect(result.promptContextStats.ragContextLength).toBeGreaterThan(0)
    expect(result.promptContextStats.usedContextChunks).toHaveLength(1)
    expect(result.promptContextStats.usedContextChunks[0].excerpt).toContain(
      "Llamas are South American"
    )
  })

  it("clamps oversized retrieved context to maxRagContextChars and flags the doc-trunc note", async () => {
    ragsetOn()
    const huge = "A".repeat(10_000)
    mockedRetrieve.mockResolvedValueOnce({
      documents: [{ id: 1, content: huge, score: 0.9 }],
      formattedContext: huge,
      sources: [{ id: 1, title: "Doc", content: huge, score: 0.9 }]
    } as never)

    const result = await buildRagContext(
      defaults({
        rawInput: "Q",
        maxRagContextChars: 100,
        files: [
          {
            metadata: {
              fileId: "doc-file",
              fileName: "doc.txt",
              fileType: "text/plain",
              fileSize: 1,
              processedAt: 0
            },
            text: "Doc"
          } as never
        ]
      })
    )

    expect(result.contentWithRAG).toContain("[Context truncated due to length]")
    expect(result.promptContextStats.ragContextLength).toBeLessThanOrEqual(
      huge.length + 100
    )
  })

  it("groundedOnlyMode skips the global/file RAG retrieval entirely", async () => {
    ragsetOn()
    await buildRagContext(defaults({ groundedOnlyMode: true }))
    expect(mockedRetrieve).not.toHaveBeenCalled()
  })
})

describe("page (tab) context", () => {
  it("retrieves and appends page-context when hasTabContext is true", async () => {
    ragsetOn()
    mockedRetrieveFromSources.mockResolvedValueOnce({
      documents: [{ id: "doc-1", content: "Page text", score: 0.8 }],
      formattedContext: "<page>Page text</page>",
      sources: [
        {
          id: "doc-1",
          title: "The Page",
          content: "Page text we kept",
          score: 0.8,
          source: "tab",
          chunkIndex: 0
        }
      ]
    } as never)

    const result = await buildRagContext(
      defaults({
        hasTabContext: true,
        tabDocuments: [{ id: "doc-1", title: "The Page", content: "Page text" }]
      })
    )

    expect(result.pageContextAdded).toBe(true)
    expect(result.contentWithRAG).toContain("<page>Page text</page>")
    expect(result.ragSources?.sources).toHaveLength(1)
    expect(result.promptContextStats.tabContextLength).toBeGreaterThan(0)
    expect(mockedRetrieveFromSources.mock.calls[0]?.[2]).toMatchObject({
      maxTokens: 4000
    })
  })

  it("when hasTabContext is true but retriever returns empty, no page block is added; tab-fallback fires instead", async () => {
    ragsetOn()
    mockedRetrieveFromSources.mockResolvedValueOnce({
      documents: [],
      formattedContext: "",
      sources: []
    } as never)

    const result = await buildRagContext(
      defaults({
        hasTabContext: true,
        contextText: "Raw extracted page body that is long enough to matter",
        tabDocuments: [{ id: "1", title: "x", content: "y" }]
      })
    )

    expect(result.pageContextAdded).toBe(false)
    // Tab-fallback path appended the raw context as a fallback chunk.
    expect(result.contentWithRAG).toContain("Raw extracted page body")
    expect(result.promptContextStats.tabContextLength).toBeGreaterThan(0)
    expect(result.promptContextStats.usedContextChunks[0].id).toBe(
      "tab-fallback"
    )
  })
})

describe("knowledge set overrides", () => {
  it("uses the knowledge set's custom ragPrompt + retrieval overrides", async () => {
    ragsetOn()
    mockedGetActiveKnowledgeSet.mockResolvedValueOnce({
      id: "ks-1",
      name: "Custom",
      ragPrompt: "Custom RAG instruction",
      questionPrompt: "Reformulate this",
      retrieval: { topK: 7, minSimilarity: 0.6, minRerankScore: 0.5 }
    } as never)
    mockedRetrieve.mockResolvedValueOnce({
      documents: [{ id: 1, content: "ctx", score: 0.9 }],
      formattedContext: "the-ctx",
      sources: [{ id: 1, title: "src", content: "ctx", score: 0.9 }]
    } as never)

    const result = await buildRagContext(
      defaults({
        rawInput: "Q",
        files: [
          {
            metadata: {
              fileId: "f1",
              fileName: "doc.txt",
              fileType: "text/plain",
              fileSize: 1,
              processedAt: 0
            },
            text: "Doc"
          } as never
        ]
      })
    )

    const retrieveCall = mockedRetrieve.mock.calls[0]
    expect(retrieveCall?.[2]).toMatchObject({
      topK: 7,
      minSimilarity: 0.6,
      minRerankScore: 0.5
    })
    expect(result.contentWithRAG).toContain("Custom RAG instruction")
  })

  it("reformulates the query when questionPrompt is set and history is non-trivial", async () => {
    ragsetOn()
    const activitySnapshots: unknown[] = []
    mockedGetActiveKnowledgeSet.mockResolvedValueOnce({
      id: "ks-1",
      name: "Custom",
      questionPrompt: "Reformulate"
    } as never)
    mockedReformulate.mockResolvedValueOnce("REFORMULATED")

    const history: ChatMessage[] = [
      { role: "user", content: "Earlier user msg" },
      { role: "assistant", content: "Earlier reply", done: true }
    ]

    await buildRagContext(
      defaults({
        messages: history,
        onActivityEvent: (events) => activitySnapshots.push(events),
        files: [
          {
            metadata: {
              fileId: "f1",
              fileName: "doc.txt",
              fileType: "text/plain",
              fileSize: 1,
              processedAt: 0
            },
            text: "Doc"
          } as never
        ]
      })
    )

    expect(mockedReformulate).toHaveBeenCalledTimes(1)
    // The reformulated query is what gets sent to retrieveContext.
    expect(mockedRetrieve).toHaveBeenCalled()
    expect(mockedRetrieve.mock.calls[0]?.[0]).toBe("REFORMULATED")
    expect(activitySnapshots).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            kind: "query_rewrite",
            label: "Rewriting query",
            status: "running"
          })
        ]),
        expect.arrayContaining([
          expect.objectContaining({
            kind: "query_rewrite",
            status: "done",
            outputPreview: "REFORMULATED"
          })
        ])
      ])
    )
  })

  it("does NOT reformulate when history is too short even with a questionPrompt", async () => {
    ragsetOn()
    mockedGetActiveKnowledgeSet.mockResolvedValueOnce({
      id: "ks-1",
      name: "Custom",
      questionPrompt: "Reformulate"
    } as never)

    await buildRagContext(defaults({ messages: [] }))

    expect(mockedReformulate).not.toHaveBeenCalled()
  })

  it("DEFAULT_KNOWLEDGE_SET_ID with empty file ids skips global RAG scope", async () => {
    ragsetOn()
    mockedGetActiveKnowledgeSet.mockResolvedValueOnce({
      id: "default",
      name: "Default"
    } as never)
    mockedGetKnowledgeSetFileIds.mockResolvedValueOnce([])

    await buildRagContext(defaults())

    expect(mockedRetrieve).not.toHaveBeenCalled()
  })

  it("custom active knowledge set scopes the search to that set's files", async () => {
    ragsetOn()
    mockedGetActiveKnowledgeSet.mockImplementation(
      async () =>
        ({
          id: "ks-1",
          name: "Project"
        }) as never
    )
    mockedGetKnowledgeSetFileIds.mockImplementation(
      async () => ["ks-file"] as never
    )

    await buildRagContext(defaults())

    expect(mockedRetrieve.mock.calls[0]?.[1]).toEqual(["ks-file"])
  })

  it("explicit files in the request scope the search to those file ids", async () => {
    ragsetOn()
    await buildRagContext(
      defaults({
        files: [
          {
            metadata: {
              fileId: "f1",
              fileName: "a.txt",
              fileType: "text",
              fileSize: 1,
              processedAt: 0
            },
            text: "abc"
          } as never,
          {
            metadata: {
              fileId: "f2",
              fileName: "b.txt",
              fileType: "text",
              fileSize: 1,
              processedAt: 0
            },
            text: "xyz"
          } as never
        ]
      })
    )

    expect(mockedRetrieve.mock.calls[0]?.[1]).toEqual(["f1", "f2"])
  })
})

describe("fallbacks", () => {
  it("if RAG returned nothing and files are attached, embeds full file text as a final fallback", async () => {
    ragsetOn()
    const result = await buildRagContext(
      defaults({
        rawInput: "Question",
        files: [
          {
            metadata: {
              fileId: "f1",
              fileName: "doc.txt",
              fileType: "text",
              fileSize: 5,
              processedAt: 0
            },
            text: "FULL FILE TEXT THAT WAS NEVER CHUNKED"
          } as never
        ]
      })
    )

    expect(result.contentWithRAG).toContain("[File: doc.txt]")
    expect(result.contentWithRAG).toContain("FULL FILE TEXT")
  })

  it("file fallback truncates content over 10000 chars and marks it", async () => {
    ragsetOn()
    const long = "X".repeat(11_000)
    const result = await buildRagContext(
      defaults({
        rawInput: "Q",
        files: [
          {
            metadata: {
              fileId: "f1",
              fileName: "huge.txt",
              fileType: "text",
              fileSize: long.length,
              processedAt: 0
            },
            text: long
          } as never
        ]
      })
    )

    expect(result.contentWithRAG).toContain("... (truncated)")
  })
})

describe("error path", () => {
  it("retriever throwing produces a destructive toast and falls back to attached file text", async () => {
    ragsetOn()
    mockedRetrieve.mockRejectedValueOnce(new Error("vector store down"))

    const result = await buildRagContext(
      defaults({
        rawInput: "Q",
        files: [
          {
            metadata: {
              fileId: "f1",
              fileName: "doc.txt",
              fileType: "text/plain",
              fileSize: 1,
              processedAt: 0
            },
            text: "Doc"
          } as never
        ]
      })
    )

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "RAG Warning"
      })
    )
    expect(result.contentWithRAG).toContain("[File: doc.txt]")
    expect(result.ragSources).toBeNull()
  })
})

describe("prompt stats", () => {
  it("computes lengths against the augmented body, not just the input", async () => {
    ragsetOn()
    mockedRetrieve.mockResolvedValueOnce({
      documents: [{ id: 1, content: "ctx", score: 0.9 }],
      formattedContext: "RETRIEVED",
      sources: [{ id: 1, title: "src", content: "ctx", score: 0.9 }]
    } as never)

    const result = await buildRagContext(
      defaults({
        rawInput: "Q",
        files: [
          {
            metadata: {
              fileId: "f1",
              fileName: "doc.txt",
              fileType: "text/plain",
              fileSize: 1,
              processedAt: 0
            },
            text: "Doc"
          } as never
        ]
      })
    )

    expect(result.promptContextStats.promptInputLength).toBe(1)
    expect(result.promptContextStats.promptAugmentedLength).toBe(
      result.contentWithRAG.length
    )
    expect(result.promptContextStats.groundedOnlyMode).toBe(false)
    expect(result.promptContextStats.insufficientContext).toBe(false)
  })
})

describe("query reformulation provider call", () => {
  it("invokeModelOnce is wired with the streaming provider when reformulation runs", async () => {
    ragsetOn()
    mockedGetActiveKnowledgeSet.mockResolvedValueOnce({
      id: "ks-1",
      name: "K",
      questionPrompt: "QP"
    } as never)
    mockedReformulate.mockImplementationOnce(async (_q, _hist, invoke) => {
      // Call the invoke fn to assert it routes through ProviderFactory.
      return invoke("ping")
    })

    const fakeProvider = {
      streamChat: vi.fn(async (_req, onChunk) => {
        onChunk({ delta: "pong" })
      })
    }
    mockedGetProvider.mockResolvedValueOnce(fakeProvider as never)

    await buildRagContext(
      defaults({
        messages: [
          { role: "user", content: "x" },
          { role: "assistant", content: "y", done: true }
        ],
        files: [
          {
            metadata: {
              fileId: "f1",
              fileName: "doc.txt",
              fileType: "text/plain",
              fileSize: 1,
              processedAt: 0
            },
            text: "Doc"
          } as never
        ]
      })
    )

    expect(mockedGetProvider).toHaveBeenCalledWith("llama3", "ollama")
    expect(fakeProvider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "llama3",
        temperature: 0.2,
        num_predict: 64,
        stop: ["\n"],
        think: false
      }),
      expect.any(Function),
      expect.any(AbortSignal)
    )
    // The reformulated value ("pong") should be the query sent to retrieve.
    expect(mockedRetrieve.mock.calls[0]?.[0]).toBe("pong")
  })
})
