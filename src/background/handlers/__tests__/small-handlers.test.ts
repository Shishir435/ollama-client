import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  notifyJobComplete: vi.fn(),
  queryTabs: vi.fn(),
  resolveToolConfirmation: vi.fn(),
  safeSendResponse: vi.fn(),
  startDurableTurn: vi.fn()
}))

vi.mock("@/background/lib/notify", () => ({
  notifyJobComplete: mocks.notifyJobComplete
}))

vi.mock("@/background/lib/runtime-delivery", () => ({
  safeSendResponse: mocks.safeSendResponse
}))

vi.mock("@/background/lib/tool-confirmation-registry", () => ({
  resolveToolConfirmation: mocks.resolveToolConfirmation
}))

vi.mock("@/background/durable-turn-runtime", () => ({
  startDurableTurn: mocks.startDurableTurn
}))

vi.mock("@/background/lib/error-handler", () => ({
  withErrorContext:
    (
      handler: (...args: unknown[]) => unknown,
      context: {
        resolveDiagnosticSessionId?: (message: unknown) => string | undefined
      }
    ) =>
    (...args: unknown[]) => {
      context.resolveDiagnosticSessionId?.(args[0])
      return handler(...args)
    }
}))

vi.mock("@/lib/browser-api", () => ({
  browser: { tabs: { query: mocks.queryTabs } }
}))

import {
  handleJobCompleteNotification,
  handleKeepToolLoopAlive
} from "../handle-app-messages"
import { handleOpenTabs } from "../handle-browser-messages"
import { handleStartTurn } from "../handle-start-turn"
import { handleToolConfirmation } from "../handle-tool-confirmation"

const sendResponse = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe("application message handlers", () => {
  it("acknowledges the tool-loop keepalive synchronously", () => {
    expect(handleKeepToolLoopAlive(sendResponse)).toBeUndefined()
    expect(mocks.safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: true
    })
  })

  it("rejects an invalid job-notification payload", () => {
    const result = handleJobCompleteNotification(
      { type: "notify", payload: { title: 42 } } as never,
      sendResponse
    )

    expect(result).toBe(true)
    expect(mocks.notifyJobComplete).not.toHaveBeenCalled()
    expect(mocks.safeSendResponse).toHaveBeenCalledWith(
      sendResponse,
      expect.objectContaining({
        success: false,
        error: { status: 400, message: "Invalid message payload" }
      })
    )
  })

  it("returns the notification result and optional id", async () => {
    mocks.notifyJobComplete.mockResolvedValueOnce({ sent: true })

    expect(
      handleJobCompleteNotification(
        {
          type: "notify",
          payload: { id: "job-1", title: "Done", message: "Finished" }
        } as never,
        sendResponse
      )
    ).toBe(true)

    await vi.waitFor(() => {
      expect(mocks.notifyJobComplete).toHaveBeenCalledWith({
        id: "job-1",
        title: "Done",
        message: "Finished"
      })
      expect(mocks.safeSendResponse).toHaveBeenCalledWith(sendResponse, {
        success: true,
        data: { sent: true },
        error: undefined
      })
    })
  })

  it("reports a skipped notification with its reason", async () => {
    mocks.notifyJobComplete.mockResolvedValueOnce({
      sent: false,
      reason: "permission denied"
    })

    handleJobCompleteNotification(
      {
        type: "notify",
        payload: { title: "Done", message: "Finished" }
      } as never,
      sendResponse
    )

    await vi.waitFor(() => {
      expect(mocks.safeSendResponse).toHaveBeenCalledWith(
        sendResponse,
        expect.objectContaining({
          success: false,
          error: { status: 0, message: "permission denied" }
        })
      )
    })
  })

  it("converts a notification rejection into an error response", async () => {
    mocks.notifyJobComplete.mockRejectedValueOnce(new Error("notify failed"))

    handleJobCompleteNotification(
      {
        type: "notify",
        payload: { title: "Done", message: "Finished" }
      } as never,
      sendResponse
    )

    await vi.waitFor(() => {
      expect(mocks.safeSendResponse).toHaveBeenCalledWith(sendResponse, {
        success: false,
        error: { status: 0, message: "notify failed" }
      })
    })
  })
})

describe("browser message handlers", () => {
  it("returns the queried tabs", async () => {
    const tabs = [{ id: 1, title: "One" }]
    mocks.queryTabs.mockResolvedValueOnce(tabs)

    expect(handleOpenTabs(sendResponse)).toBe(true)

    await vi.waitFor(() => {
      expect(mocks.queryTabs).toHaveBeenCalledWith({})
      expect(mocks.safeSendResponse).toHaveBeenCalledWith(sendResponse, {
        success: true,
        tabs
      })
    })
  })

  it("returns the browser query error", async () => {
    mocks.queryTabs.mockRejectedValueOnce(new Error("tabs unavailable"))

    handleOpenTabs(sendResponse)

    await vi.waitFor(() => {
      expect(mocks.safeSendResponse).toHaveBeenCalledWith(sendResponse, {
        success: false,
        error: { status: 0, message: "tabs unavailable" }
      })
    })
  })

  it("uses a stable fallback for non-Error query failures", async () => {
    mocks.queryTabs.mockRejectedValueOnce("closed")

    handleOpenTabs(sendResponse)

    await vi.waitFor(() => {
      expect(mocks.safeSendResponse).toHaveBeenCalledWith(sendResponse, {
        success: false,
        error: { status: 0, message: "Failed to query tabs" }
      })
    })
  })
})

describe("tool confirmation handler", () => {
  it.each([
    "session",
    "always"
  ] as const)("forwards an approved %s scope", (scope) => {
    expect(
      handleToolConfirmation(
        {
          type: "confirm",
          payload: { callId: "call-1", approved: true, scope }
        } as never,
        sendResponse
      )
    ).toBeUndefined()

    expect(mocks.resolveToolConfirmation).toHaveBeenCalledWith(
      "call-1",
      true,
      scope
    )
    expect(mocks.safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: true
    })
  })

  it("drops an invalid scope but preserves the decision", () => {
    handleToolConfirmation(
      {
        type: "confirm",
        payload: { callId: "call-2", approved: false, scope: "global" }
      } as never,
      sendResponse
    )

    expect(mocks.resolveToolConfirmation).toHaveBeenCalledWith(
      "call-2",
      false,
      undefined
    )
  })

  it("rejects a missing call id without touching the registry", () => {
    handleToolConfirmation(
      { type: "confirm", payload: { approved: true } } as never,
      sendResponse
    )

    expect(mocks.resolveToolConfirmation).not.toHaveBeenCalled()
    expect(mocks.safeSendResponse).toHaveBeenCalledWith(sendResponse, {
      success: false
    })
  })
})

describe("durable turn adapter", () => {
  it("forwards the durable submission and stream lifecycle", async () => {
    const port = { postMessage: vi.fn() }
    const isPortClosed = vi.fn(() => false)
    const submission = { sessionId: "session-1", rawInput: "hello" }

    await handleStartTurn(
      {
        type: "start-turn",
        payload: {
          assistantMessageId: 22,
          start: { submission, userMessageId: 11 }
        }
      } as never,
      port as never,
      isPortClosed
    )

    expect(mocks.startDurableTurn).toHaveBeenCalledWith(submission, 11, 22, {
      port,
      isPortClosed
    })
  })
})
