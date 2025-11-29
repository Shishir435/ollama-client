import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handleChatStream } from "../handle-chat-stream"
import {
  clearHandlerMocks,
  createMockIsPortClosed,
  createMockPort,
  setupHandlerMocks
} from "./test-utils"

// Mock dependencies
vi.mock("@/background/lib/process-stream-chunk", () => ({
  processStreamChunk: vi.fn(),
  processRemainingMetricsBuffer: vi.fn()
}))

vi.mock("@/background/lib/utils", () => ({
  safePostMessage: vi.fn()
}))

describe("handleChatStream", () => {
  let mockPort: ReturnType<typeof createMockPort>
  let mockIsPortClosed: ReturnType<typeof createMockIsPortClosed>

  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    mockPort = createMockPort("stream-port")
    mockIsPortClosed = createMockIsPortClosed(false)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("successful streaming", () => {
    it("should process stream chunks correctly", async () => {
      const { processStreamChunk } = await import(
        "@/background/lib/process-stream-chunk"
      )

      const chunks = [
        new TextEncoder().encode('{"message": {"content": "Hello"}}'),
        new TextEncoder().encode('{"message": {"content": " world"}}'),
        new TextEncoder().encode('{"done": true}')
      ]

      let chunkIndex = 0
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            return Promise.resolve({
              value: chunks[chunkIndex++],
              done: false
            })
          }
          return Promise.resolve({ value: undefined, done: true })
        }),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      vi.mocked(processStreamChunk).mockReturnValueOnce({
        buffer: "",
        fullText: "Hello",
        isDone: false
      })
      vi.mocked(processStreamChunk).mockReturnValueOnce({
        buffer: "",
        fullText: "Hello world",
        isDone: false
      })
      vi.mocked(processStreamChunk).mockReturnValueOnce({
        buffer: "",
        fullText: "Hello world",
        isDone: true
      })

      await handleChatStream(mockResponse, mockPort, mockIsPortClosed)

      expect(processStreamChunk).toHaveBeenCalledTimes(3)
      expect(mockReader.read).toHaveBeenCalled()
    })

    it("should clear timeout after receiving first data", async () => {
      const { processStreamChunk } = await import(
        "@/background/lib/process-stream-chunk"
      )

      const chunk = new TextEncoder().encode('{"message": {"content": "test"}}')

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ value: chunk, done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      vi.mocked(processStreamChunk).mockReturnValue({
        buffer: "",
        fullText: "test",
        isDone: false
      })

      const streamPromise = handleChatStream(
        mockResponse,
        mockPort,
        mockIsPortClosed
      )

      // Advance time before first chunk
      vi.advanceTimersByTime(30000)

      await streamPromise

      // Should not timeout since data was received
      expect(mockReader.cancel).not.toHaveBeenCalled()
    })
  })

  describe("timeout handling", () => {
    it(
      "should timeout if no data received within 60 seconds",
      { timeout: 10000 },
      async () => {
        const { safePostMessage } = await import("@/background/lib/utils")

        let resolveRead: (value: any) => void
        const readPromise = new Promise((resolve) => {
          resolveRead = resolve
        })

        const mockReader = {
          read: vi.fn().mockReturnValue(readPromise),
          cancel: vi.fn().mockImplementation(() => {
            // When cancel is called, resolve the pending read to break the loop
            resolveRead({ value: undefined, done: true })
            return Promise.resolve()
          })
        }

        const mockResponse = {
          body: {
            getReader: () => mockReader
          }
        } as unknown as Response

        const streamPromise = handleChatStream(
          mockResponse,
          mockPort,
          mockIsPortClosed
        )

        // Advance time to trigger timeout
        await vi.advanceTimersByTimeAsync(60000)

        await streamPromise

        expect(mockReader.cancel).toHaveBeenCalled()
        expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
          error: {
            status: 0,
            message: "Request timeout - try regenerating"
          }
        })
      }
    )

    it("should not timeout if data is received before 60 seconds", async () => {
      const { processStreamChunk } = await import(
        "@/background/lib/process-stream-chunk"
      )

      const chunk = new TextEncoder().encode('{"message": {"content": "data"}}')

      let readCount = 0
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          readCount++
          if (readCount === 1) {
            // First read returns data after 30 seconds
            await new Promise((resolve) => setTimeout(resolve, 100))
            return { value: chunk, done: false }
          }
          return { value: undefined, done: true }
        }),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      vi.mocked(processStreamChunk).mockReturnValue({
        buffer: "",
        fullText: "data",
        isDone: false
      })

      const streamPromise = handleChatStream(
        mockResponse,
        mockPort,
        mockIsPortClosed
      )

      // Advance to 30 seconds (less than timeout)
      await vi.advanceTimersByTimeAsync(30000)

      await streamPromise

      expect(mockReader.cancel).not.toHaveBeenCalled()
    })
  })

  describe("port closed handling", () => {
    it("should cancel stream if port is closed", async () => {
      const chunk = new TextEncoder().encode('{"message": {"content": "test"}}')

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ value: chunk, done: false })
          .mockResolvedValueOnce({ value: chunk, done: false }),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      // Port closes after first chunk
      mockIsPortClosed = vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValue(true)

      await handleChatStream(mockResponse, mockPort, mockIsPortClosed)

      expect(mockReader.cancel).toHaveBeenCalled()
    })

    it("should not process remaining buffer if port is closed", async () => {
      const { processRemainingMetricsBuffer } = await import(
        "@/background/lib/process-stream-chunk"
      )
      const { processStreamChunk } = await import(
        "@/background/lib/process-stream-chunk"
      )

      const chunk = new TextEncoder().encode('{"message": {"content": "test"}}')

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ value: chunk, done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      vi.mocked(processStreamChunk).mockReturnValue({
        buffer: "remaining data",
        fullText: "test",
        isDone: false
      })

      mockIsPortClosed = vi.fn().mockReturnValue(true)

      await handleChatStream(mockResponse, mockPort, mockIsPortClosed)

      expect(processRemainingMetricsBuffer).not.toHaveBeenCalled()
    })
  })

  describe("error handling", () => {
    it("should handle missing response body", async () => {
      const { safePostMessage } = await import("@/background/lib/utils")

      const mockResponse = {
        body: null
      } as Response

      await handleChatStream(mockResponse, mockPort, mockIsPortClosed)

      expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
        error: {
          status: 0,
          message: "No response from model - try regenerating"
        }
      })
    })

    it("should throw errors during stream processing", async () => {
      const mockReader = {
        read: vi.fn().mockRejectedValue(new Error("Read error")),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      await expect(
        handleChatStream(mockResponse, mockPort, mockIsPortClosed)
      ).rejects.toThrow("Read error")
    })

    it("should clear timeout on error", async () => {
      const mockReader = {
        read: vi.fn().mockRejectedValue(new Error("Stream error")),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      await expect(
        handleChatStream(mockResponse, mockPort, mockIsPortClosed)
      ).rejects.toThrow("Stream error")

      // Timeout should be cleared, advancing time should not cause issues
      await vi.advanceTimersByTimeAsync(70000)
    })
  })

  describe("buffer processing", () => {
    it("should process remaining buffer after stream ends", async () => {
      const { processRemainingMetricsBuffer, processStreamChunk } =
        await import("@/background/lib/process-stream-chunk")

      const chunk = new TextEncoder().encode('{"message": {"content": "test"}}')

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ value: chunk, done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      vi.mocked(processStreamChunk).mockReturnValue({
        buffer: "remaining buffer content",
        fullText: "test",
        isDone: false
      })

      await handleChatStream(mockResponse, mockPort, mockIsPortClosed)

      expect(processRemainingMetricsBuffer).toHaveBeenCalledWith(
        "remaining buffer content",
        "test",
        mockPort
      )
    })

    it("should not process empty buffer", async () => {
      const { processRemainingMetricsBuffer, processStreamChunk } =
        await import("@/background/lib/process-stream-chunk")

      const chunk = new TextEncoder().encode('{"done": true}')

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ value: chunk, done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      vi.mocked(processStreamChunk).mockReturnValue({
        buffer: "   ", // Only whitespace
        fullText: "",
        isDone: false
      })

      await handleChatStream(mockResponse, mockPort, mockIsPortClosed)

      expect(processRemainingMetricsBuffer).not.toHaveBeenCalled()
    })

    it("should return early if processStreamChunk indicates done", async () => {
      const { processStreamChunk } = await import(
        "@/background/lib/process-stream-chunk"
      )

      const chunk = new TextEncoder().encode('{"done": true}')

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ value: chunk, done: false })
          .mockResolvedValueOnce({ value: chunk, done: false }),
        cancel: vi.fn().mockResolvedValue(undefined)
      }

      const mockResponse = {
        body: {
          getReader: () => mockReader
        }
      } as unknown as Response

      vi.mocked(processStreamChunk).mockReturnValue({
        buffer: "",
        fullText: "complete",
        isDone: true
      })

      await handleChatStream(mockResponse, mockPort, mockIsPortClosed)

      // Should only call read once since isDone is true
      expect(mockReader.read).toHaveBeenCalledTimes(1)
    })
  })
})
