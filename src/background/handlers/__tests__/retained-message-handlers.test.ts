import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Runtime } from "webextension-polyfill"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ChromeMessage, SendResponseFunction } from "@/types"

const handlers = vi.hoisted(() => ({
  getModels: vi.fn(),
  openTabs: vi.fn(() => true as const),
  keepAlive: vi.fn(() => undefined),
  notify: vi.fn(() => true as const),
  selection: vi.fn(() => true as const),
  overlay: vi.fn(() => true as const),
  confirmation: vi.fn(() => undefined)
}))

vi.mock("@/background/handlers/handle-get-models", () => ({
  handleGetModels: handlers.getModels
}))
vi.mock("@/background/handlers/handle-browser-messages", () => ({
  handleOpenTabs: handlers.openTabs
}))
vi.mock("@/background/handlers/handle-app-messages", () => ({
  handleKeepToolLoopAlive: handlers.keepAlive,
  handleJobCompleteNotification: handlers.notify
}))
vi.mock("@/background/handlers/handle-selection-messages", () => ({
  handleSelectionMessage: handlers.selection,
  handleLoadSelectionOverlay: handlers.overlay
}))
vi.mock("@/background/handlers/handle-tool-confirmation", () => ({
  handleToolConfirmation: handlers.confirmation
}))

import { dispatchRetainedMessage } from "../retained-message-handlers"

describe("dispatchRetainedMessage", () => {
  const sender = { tab: { id: 7 } } as Runtime.MessageSender
  const response = vi.fn<SendResponseFunction>()

  beforeEach(() => vi.clearAllMocks())

  const dispatch = (type: string, payload?: unknown) =>
    dispatchRetainedMessage(
      { type, payload } as ChromeMessage,
      sender,
      response
    )

  it("dispatches every retained message to its named handler", () => {
    expect(dispatch(MESSAGE_KEYS.PROVIDER.GET_MODELS)).toBe(true)
    expect(handlers.getModels).toHaveBeenCalledWith(response)

    expect(dispatch(MESSAGE_KEYS.BROWSER.OPEN_TAB)).toBe(true)
    expect(handlers.openTabs).toHaveBeenCalledWith(response)

    expect(dispatch(MESSAGE_KEYS.APP.KEEP_TOOL_LOOP_ALIVE)).toBeUndefined()
    expect(handlers.keepAlive).toHaveBeenCalledWith(response)

    const notification = { title: "Done", message: "Finished" }
    expect(dispatch(MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE, notification)).toBe(
      true
    )
    expect(handlers.notify).toHaveBeenCalledWith(
      expect.objectContaining({ payload: notification }),
      response
    )

    expect(dispatch(MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT, "text")).toBe(
      true
    )
    expect(handlers.selection).toHaveBeenCalledWith(
      expect.objectContaining({ payload: "text" }),
      sender.tab,
      response
    )

    const overlay = { requestId: "request-1" }
    expect(dispatch(MESSAGE_KEYS.BROWSER.LOAD_SELECTION_OVERLAY, overlay)).toBe(
      true
    )
    expect(handlers.overlay).toHaveBeenCalledWith(overlay, sender, response)

    expect(
      dispatch(MESSAGE_KEYS.PROVIDER.CONFIRM_TOOL, { callId: "1" })
    ).toBeUndefined()
    expect(handlers.confirmation).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { callId: "1" } }),
      response
    )
  })

  it("leaves unknown and inherited object keys unhandled", () => {
    expect(dispatch("unknown-message")).toBeUndefined()
    expect(dispatch("toString")).toBeUndefined()
    expect(dispatch("__proto__")).toBeUndefined()
  })
})
