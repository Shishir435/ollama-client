import { beforeEach, describe, expect, it, vi } from "vitest"
import { generateEmbeddingsBatch } from "@/lib/embeddings/embedding-client"
import { storeVector } from "@/lib/embeddings/storage"
import type { ChromeMessage, ChromePort } from "@/types"
import {
  handleEmbedFileChunks,
  handleEmbedFileChunksPort
} from "../handle-embed-chunks"

// Mock dependencies
vi.mock("@/lib/embeddings/embedding-client", () => ({
  generateEmbeddingsBatch: vi.fn()
}))

vi.mock("@/lib/embeddings/storage", () => ({
  storeVector: vi.fn()
}))

describe("Handle Embed Chunks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("handleEmbedFileChunks (Legacy)", () => {
    it("should handle valid payload", async () => {
      const message: ChromeMessage = {
        type: "embed",
        payload: {
          chunks: [{ index: 0, text: "chunk1" }],
          metadata: { fileId: "file1", title: "File 1" },
          model: "test-model"
        }
      }
      const sendResponse = vi.fn()

      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([
        { embedding: [0.1], model: "test-model", providerId: "ollama" }
      ])

      await handleEmbedFileChunks(message, sendResponse)

      expect(generateEmbeddingsBatch).toHaveBeenCalledWith(
        ["chunk1"],
        "test-model"
      )
      expect(storeVector).toHaveBeenCalled()
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        data: { embedded: 1 }
      })
    })

    it("should handle invalid payload", async () => {
      const message: ChromeMessage = { type: "embed", payload: {} }
      const sendResponse = vi.fn()

      await handleEmbedFileChunks(message, sendResponse)

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({ message: "Invalid payload" })
      })
    })

    it("should handle errors", async () => {
      const message: ChromeMessage = {
        type: "embed",
        payload: {
          chunks: [{ index: 0, text: "chunk1" }],
          metadata: { fileId: "file1" }
        }
      }
      const sendResponse = vi.fn()

      vi.mocked(generateEmbeddingsBatch).mockRejectedValue(
        new Error("API Error")
      )

      await handleEmbedFileChunks(message, sendResponse)

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({ message: "API Error" })
      })
    })
  })

  describe("handleEmbedFileChunksPort (Streaming)", () => {
    let port: ChromePort
    let listeners: {
      message?: (message: ChromeMessage) => void | Promise<void>
      disconnect?: () => void
    }

    beforeEach(() => {
      listeners = {}
      port = {
        name: "test-port",
        onMessage: {
          addListener: vi.fn((fn) => {
            listeners.message = fn
          }),
          removeListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn()
        },
        onDisconnect: {
          addListener: vi.fn((fn) => {
            listeners.disconnect = fn
          }),
          removeListener: vi.fn(),
          hasListener: vi.fn(),
          hasListeners: vi.fn()
        },
        postMessage: vi.fn(),
        disconnect: vi.fn()
      } as unknown as ChromePort
    })

    it("should initialize correctly", () => {
      handleEmbedFileChunksPort(port)

      listeners.message?.({
        type: "init",
        payload: {
          metadata: { fileId: "file1" },
          model: "test-model"
        }
      })

      expect(port.postMessage).toHaveBeenCalledWith({ status: "initialized" })
    })

    it("should process batch of chunks", async () => {
      handleEmbedFileChunksPort(port)

      // Init first
      listeners.message?.({
        type: "init",
        payload: {
          metadata: { fileId: "file1" }
        }
      })

      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([
        { embedding: [0.1], model: "default", providerId: "ollama" },
        { embedding: [0.2], model: "default", providerId: "ollama" }
      ])

      // Send batch
      await listeners.message?.({
        type: "batch",
        payload: {
          chunks: [
            { index: 0, text: "chunk1" },
            { index: 1, text: "chunk2" }
          ]
        }
      })

      expect(generateEmbeddingsBatch).toHaveBeenCalledWith(
        ["chunk1", "chunk2"],
        undefined
      )
      expect(storeVector).toHaveBeenCalledTimes(2)
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "progress",
          processed: 2,
          total: 2
        })
      )
    })

    it("should handle cancellation", () => {
      handleEmbedFileChunksPort(port)

      listeners.message?.({ type: "cancel", cancel: true })

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "cancelled"
        })
      )
      expect(port.disconnect).toHaveBeenCalled()
    })

    it("should handle done message", () => {
      handleEmbedFileChunksPort(port)

      listeners.message?.({ type: "done" })

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "done"
        })
      )
      expect(port.disconnect).toHaveBeenCalled()
    })

    it("should handle errors during processing", async () => {
      handleEmbedFileChunksPort(port)

      listeners.message?.({
        type: "init",
        payload: { metadata: { fileId: "file1" } }
      })

      vi.mocked(generateEmbeddingsBatch).mockRejectedValue(
        new Error("Processing failed")
      )

      await listeners.message?.({
        type: "batch",
        payload: { chunks: [{ index: 0, text: "chunk1" }] }
      })

      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          message: "Processing failed"
        })
      )
    })

    it("should stop processing on disconnect", async () => {
      handleEmbedFileChunksPort(port)

      listeners.message?.({
        type: "init",
        payload: { metadata: { fileId: "file1" } }
      })

      // Simulate disconnect
      listeners.disconnect?.()

      vi.mocked(generateEmbeddingsBatch).mockResolvedValue([
        { embedding: [0.1], model: "default", providerId: "ollama" }
      ])

      await listeners.message?.({
        type: "batch",
        payload: { chunks: [{ index: 0, text: "chunk1" }] }
      })

      // Should not store vector if cancelled/disconnected
      expect(storeVector).not.toHaveBeenCalled()
    })
  })
})
