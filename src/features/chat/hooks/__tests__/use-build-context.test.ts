import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { browser } from "@/lib/browser-api"

import { useBuildContext } from "../use-build-context"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      connect: vi.fn()
    }
  }
}))

const baseRequest = {
  rawInput: "hi",
  messages: [],
  hasTabContext: false,
  contextText: "",
  tabDocuments: [],
  memoryEnabled: false,
  maxTabContextChars: 4000,
  maxRagContextChars: 4000,
  groundedOnlyMode: false,
  selectedModel: "llama3",
  selectedModelRef: null
}

describe("useBuildContext", () => {
  let mockPort: any
  let messageListener: (msg: unknown) => void

  beforeEach(() => {
    vi.clearAllMocks()
    mockPort = {
      postMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn((fn) => {
          messageListener = fn
        }),
        removeListener: vi.fn()
      },
      onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
      disconnect: vi.fn()
    }
    vi.mocked(browser.runtime.connect).mockReturnValue(mockPort)
  })

  const sentRequestId = () =>
    mockPort.postMessage.mock.calls[0][0].payload.requestId

  it("relays progress and resolves with the terminal result", async () => {
    const { result } = renderHook(() => useBuildContext())
    const onActivityEvent = vi.fn()

    const promise = result.current.buildContext(baseRequest, {
      onActivityEvent
    })
    const requestId = sentRequestId()

    messageListener({
      type: "context_progress",
      requestId,
      events: [
        {
          id: "a",
          kind: "searching_files",
          label: "x",
          status: "running",
          startedAt: 1
        }
      ]
    })
    expect(onActivityEvent).toHaveBeenCalledOnce()

    messageListener({
      type: "context_result",
      requestId,
      result: {
        contentWithRAG: "hi",
        ragSources: null,
        pageContextAdded: false,
        promptContextStats: {}
      }
    })

    await expect(promise).resolves.toMatchObject({ contentWithRAG: "hi" })
    expect(mockPort.disconnect).toHaveBeenCalled()
  })

  it("ignores messages for a different requestId", async () => {
    const { result } = renderHook(() => useBuildContext())
    const onActivityEvent = vi.fn()

    result.current.buildContext(baseRequest, { onActivityEvent })

    messageListener({
      type: "context_progress",
      requestId: "someone-else",
      events: [
        {
          id: "a",
          kind: "searching_files",
          label: "x",
          status: "running",
          startedAt: 1
        }
      ]
    })

    expect(onActivityEvent).not.toHaveBeenCalled()
  })

  it("rejects on context_error", async () => {
    const { result } = renderHook(() => useBuildContext())
    const promise = result.current.buildContext(baseRequest)
    const requestId = sentRequestId()

    messageListener({ type: "context_error", requestId, error: "boom" })

    await expect(promise).rejects.toThrow("boom")
  })
})
