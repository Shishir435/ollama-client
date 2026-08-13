import { beforeEach, describe, expect, it, vi } from "vitest"
import { consumePullStream } from "../handle-pull-stream"

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

  const consume = (response: Response) =>
    consumePullStream(response, {
      isCancelled: isPortClosed,
      onEvent: (event) => mockPort.postMessage(event)
    })

  const createMockResponseWithReader = (chunks: string[]) => {
    console.log("Creating mock response with chunks:", chunks)
    const encoder = new TextEncoder()
    const encodedChunks = chunks.map((c) => encoder.encode(c))

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
      `${JSON.stringify({ status: "pulling manifest" })}\n`,
      JSON.stringify({ status: "downloading", completed: 10, total: 100 }) +
        "\n",
      `${JSON.stringify({ status: "success" })}\n`
    ]
    const res = createMockResponseWithReader(chunks)

    await consume(res)

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      version: 1,
      type: "model_pull_progress",
      status: "pulling manifest"
    })
    expect(mockPort.postMessage).toHaveBeenCalledWith({
      version: 1,
      type: "model_pull_progress",
      status: "Downloading: 10%",
      progress: 10
    })
    expect(mockPort.postMessage).toHaveBeenCalledWith({
      version: 1,
      type: "model_pull_complete",
      status: "success"
    })
  })

  it("should handle stream errors", async () => {
    const chunks = [`${JSON.stringify({ error: "Pull failed" })}\n`]
    const res = createMockResponseWithReader(chunks)

    await consume(res)

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      version: 1,
      type: "model_pull_error",
      failure: { status: 0, message: "Pull failed" }
    })
  })

  it("should handle port closed during stream", async () => {
    const encoder = new TextEncoder()
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          value: encoder.encode(`${JSON.stringify({ status: "start" })}\n`),
          done: false
        })
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

    await consume(res)

    expect(reader.cancel).toHaveBeenCalled()
  })

  it("should handle split chunks", async () => {
    const json = JSON.stringify({ status: "success" })
    const part1 = json.slice(0, 10)
    const part2 = `${json.slice(10)}\n`

    const res = createMockResponseWithReader([part1, part2])

    await consume(res)

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      version: 1,
      type: "model_pull_complete",
      status: "success"
    })
  })

  it("should ignore empty lines", async () => {
    const res = createMockResponseWithReader([
      "\n",
      `${JSON.stringify({ status: "success" })}\n`
    ])

    await consume(res)

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      version: 1,
      type: "model_pull_complete",
      status: "success"
    })
  })

  it("should handle invalid JSON gracefully", async () => {
    const res = createMockResponseWithReader([
      "invalid-json\n",
      `${JSON.stringify({ status: "success" })}\n`
    ])
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await consume(res)

    expect(consoleSpy).toHaveBeenCalled()
    expect(mockPort.postMessage).toHaveBeenCalledWith({
      version: 1,
      type: "model_pull_complete",
      status: "success"
    })
  })
})
