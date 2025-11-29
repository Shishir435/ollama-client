import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useAutoEmbedMessages } from "../use-auto-embed-messages"

// Mock dependencies
vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

vi.mock("@/lib/embeddings/ollama-embedder", () => ({
  generateEmbedding: vi.fn()
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  storeVector: vi.fn(),
  vectorDb: {
    vectors: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          filter: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(null)
          }))
        }))
      }))
    }
  }
}))

describe("useAutoEmbedMessages", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    
    // Reset to default enabled state
    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([true, vi.fn(), { 
      setRenderValue: vi.fn(), 
      setStoreValue: vi.fn(),
      remove: vi.fn(),
      isLoading: false
    }])
  })

  it("should initialize with default state", () => {
    const { result } = renderHook(() => useAutoEmbedMessages())

    expect(result.current).toHaveProperty("embedMessage")
    expect(result.current).toHaveProperty("embedMessages")
    expect(result.current.isEnabled).toBe(true)
  })

  it("should embed a user message", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    const { storeVector } = await import("@/lib/embeddings/vector-store")
    
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })

    const { result } = renderHook(() => useAutoEmbedMessages())

    await result.current.embedMessage(
      { role: "user", content: "This is a test message" },
      "session-1"
    )

    await waitFor(() => {
      expect(generateEmbedding).toHaveBeenCalledWith("This is a test message")
      expect(storeVector).toHaveBeenCalled()
    })
  })

  it("should skip system messages", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    
    const { result } = renderHook(() => useAutoEmbedMessages())

    await result.current.embedMessage(
      { role: "system", content: "System message" },
      "session-1"
    )

    expect(generateEmbedding).not.toHaveBeenCalled()
  })

  it("should skip short messages", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    
    const { result } = renderHook(() => useAutoEmbedMessages())

    await result.current.embedMessage(
      { role: "user", content: "Hi" },
      "session-1"
    )

    expect(generateEmbedding).not.toHaveBeenCalled()
  })

  it("should skip incomplete assistant messages", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    
    const { result } = renderHook(() => useAutoEmbedMessages())

    await result.current.embedMessage(
      { role: "assistant", content: "Partial response..." },
      "session-1"
    )

    expect(generateEmbedding).not.toHaveBeenCalled()
  })

  it("should embed complete assistant messages", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    const { storeVector } = await import("@/lib/embeddings/vector-store")
    
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })

    const { result } = renderHook(() => useAutoEmbedMessages())

    await result.current.embedMessage(
      { role: "assistant", content: "Complete response", done: true },
      "session-1"
    )

    await waitFor(() => {
      expect(generateEmbedding).toHaveBeenCalled()
      expect(storeVector).toHaveBeenCalled()
    })
  })

  it("should handle embedding errors gracefully", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    
    vi.mocked(generateEmbedding).mockResolvedValue({
      error: "Embedding failed"
    })

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { result } = renderHook(() => useAutoEmbedMessages())

    await result.current.embedMessage(
      { role: "user", content: "Test message for error" },
      "session-1"
    )

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled()
    })

    consoleSpy.mockRestore()
  })

  it("should skip messages when auto-embed is disabled", async () => {
    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([false, vi.fn(), { 
      setRenderValue: vi.fn(), 
      setStoreValue: vi.fn(),
      remove: vi.fn(),
      isLoading: false
    }])

    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    
    const { result } = renderHook(() => useAutoEmbedMessages())

    await result.current.embedMessage(
      { role: "user", content: "This should be skipped" },
      "session-1"
    )

    expect(generateEmbedding).not.toHaveBeenCalled()
  })

  it("should embed multiple messages", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: "test-model"
    })

    const { result } = renderHook(() => useAutoEmbedMessages())

    const messages = [
      { role: "user" as const, content: "First message content", done: true },
      { role: "assistant" as const, content: "Second message content", done: true }
    ]

    await result.current.embedMessages(messages, "session-1", false)

    await waitFor(() => {
      expect(generateEmbedding).toHaveBeenCalledTimes(2)
    })
  })

  it("should skip embedding when streaming", async () => {
    const { generateEmbedding } = await import("@/lib/embeddings/ollama-embedder")
    
    const { result } = renderHook(() => useAutoEmbedMessages())

    const messages = [
      { role: "user" as const, content: "Message during streaming" }
    ]

    await result.current.embedMessages(messages, "session-1", true)

    expect(generateEmbedding).not.toHaveBeenCalled()
  })
})
