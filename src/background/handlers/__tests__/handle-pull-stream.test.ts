import { describe, expect, it, vi, beforeEach } from "vitest"
import { handlePullStream } from "../handle-pull-stream"
import { clearAbortController } from "@/background/lib/abort-controller-registry"

// Mock dependencies
vi.mock("@/background/lib/abort-controller-registry", () => ({
  clearAbortController: vi.fn()
}))

vi.mock("@/background/lib/utils", () => ({
  getPullAbortControllerKey: vi.fn().mockReturnValue("key"),
  // safePostMessage is NOT mocked, so it uses the real implementation which calls port.postMessage
  safePostMessage: vi.fn().mockImplementation(async (port, message) => {
    console.log("safePostMessage called with:", message)
    try {
      port.postMessage(message)
    } catch (e) {
      console.log("safePostMessage error:", e)
    }
  })
}))

describe("Handle Pull Stream", () => {
  const mockPort = { 
    name: "test-port",
    postMessage: vi.fn(),
    onDisconnect: { addListener: vi.fn() }
  } as any
  const isPortClosed = vi.fn().mockReturnValue(false)

  beforeEach(() => {
    vi.clearAllMocks()
    isPortClosed.mockReturnValue(false)
  })

  const createMockResponseWithReader = (chunks: string[]) => {
    console.log("Creating mock response with chunks:", chunks)
    const encoder = new TextEncoder()
    const encodedChunks = chunks.map(c => encoder.encode(c))
    
    let index = 0
    const reader = {
      read: vi.fn().mockImplementation(async () => {
        if (index < encodedChunks.length) {
          console.log("Reading chunk:", index, chunks[index])
          return { value: encodedChunks[index++], done: false }
        }
        return { value: undefined, done: true }
      }),
      cancel: vi.fn().mockResolvedValue(undefined)
    }

    return {
      body: {
        getReader: vi.fn().mockReturnValue(reader)
      }
    } as unknown as Response
  }

  it("sanity check TextDecoder", () => {
    const decoder = new TextDecoder("utf-8")
    const encoder = new TextEncoder()
    const chunk1 = encoder.encode("part1")
    const chunk2 = encoder.encode("part2\n")
    
    let buffer = ""
    buffer += decoder.decode(chunk1, { stream: true })
    buffer += decoder.decode(chunk2, { stream: true })
    
    expect(buffer).toBe("part1part2\n")
  })

  it("should process successful stream", async () => {
    const chunks = [
      JSON.stringify({ status: "pulling manifest" }) + "\n",
      JSON.stringify({ status: "downloading", completed: 10, total: 100 }) + "\n",
      JSON.stringify({ status: "success" }) + "\n"
    ]
    const res = createMockResponseWithReader(chunks)

    await handlePullStream(res, mockPort, isPortClosed, "llama2")

    expect(mockPort.postMessage).toHaveBeenCalledWith({ status: "pulling manifest" })
    expect(mockPort.postMessage).toHaveBeenCalledWith({ 
      status: "Downloading: 10%", 
      progress: 10 
    })
    expect(mockPort.postMessage).toHaveBeenCalledWith({ done: true })
    expect(clearAbortController).toHaveBeenCalled()
  })

  it("should handle stream errors", async () => {
    const chunks = [
      JSON.stringify({ error: "Pull failed" }) + "\n"
    ]
    const res = createMockResponseWithReader(chunks)

    await handlePullStream(res, mockPort, isPortClosed, "llama2")

    expect(mockPort.postMessage).toHaveBeenCalledWith({ error: "Pull failed" })
    expect(clearAbortController).toHaveBeenCalled()
  })

  it("should handle port closed during stream", async () => {
    const encoder = new TextEncoder()
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ value: encoder.encode(JSON.stringify({ status: "start" }) + "\n"), done: false })
        .mockImplementation(async () => {
          isPortClosed.mockReturnValue(true)
          return { value: undefined, done: false }
        }),
      cancel: vi.fn().mockResolvedValue(undefined)
    }
    
    const res = {
      body: {
        getReader: vi.fn().mockReturnValue(reader)
      }
    } as unknown as Response

    await handlePullStream(res, mockPort, isPortClosed, "llama2")

    expect(reader.cancel).toHaveBeenCalled()
  })

  it("should handle split chunks", async () => {
    const json = JSON.stringify({ status: "success" })
    const part1 = json.slice(0, 10)
    const part2 = json.slice(10) + "\n"
    
    const res = createMockResponseWithReader([part1, part2])

    await handlePullStream(res, mockPort, isPortClosed, "llama2")

    expect(mockPort.postMessage).toHaveBeenCalledWith({ done: true })
  })

  it("should ignore empty lines", async () => {
    const res = createMockResponseWithReader(["\n", JSON.stringify({ status: "success" }) + "\n"])

    await handlePullStream(res, mockPort, isPortClosed, "llama2")

    expect(mockPort.postMessage).toHaveBeenCalledWith({ done: true })
  })

  it("should handle invalid JSON gracefully", async () => {
    const res = createMockResponseWithReader(["invalid-json\n", JSON.stringify({ status: "success" }) + "\n"])
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await handlePullStream(res, mockPort, isPortClosed, "llama2")

    expect(consoleSpy).toHaveBeenCalled()
    expect(mockPort.postMessage).toHaveBeenCalledWith({ done: true })
  })
})
