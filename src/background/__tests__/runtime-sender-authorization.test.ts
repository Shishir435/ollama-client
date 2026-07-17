import { describe, expect, it } from "vitest"
import {
  classifyRuntimeSender,
  isRuntimeMessageAllowed,
  isRuntimePortAllowed,
  isRuntimePortMessageAllowed,
  type RuntimeSenderLike
} from "@/background/runtime-sender-authorization"
import { MESSAGE_KEYS } from "@/lib/constants"

const extensionId = "extension-id"
const extensionUrlPrefix = "chrome-extension://extension-id/"
const extensionPage = {
  id: extensionId,
  url: `${extensionUrlPrefix}sidepanel.html`
}
const contentScript = {
  id: extensionId,
  tab: { id: 42 },
  url: "https://example.com/page"
}

const messageAllowed = (
  type: string,
  sender: RuntimeSenderLike = contentScript
) => isRuntimeMessageAllowed(type, sender, extensionId, extensionUrlPrefix)

const portAllowed = (
  portName: string,
  sender: RuntimeSenderLike = contentScript
) => isRuntimePortAllowed(portName, sender, extensionId, extensionUrlPrefix)

const portMessageAllowed = (
  portName: string,
  messageType: string,
  sender: RuntimeSenderLike = contentScript
) =>
  isRuntimePortMessageAllowed(
    portName,
    messageType,
    sender,
    extensionId,
    extensionUrlPrefix
  )

describe("runtime sender authorization", () => {
  it("classifies extension pages, content scripts, and foreign senders", () => {
    expect(
      classifyRuntimeSender(extensionPage, extensionId, extensionUrlPrefix)
    ).toBe("extension-page")
    expect(
      classifyRuntimeSender(contentScript, extensionId, extensionUrlPrefix)
    ).toBe("content-script")
    expect(
      classifyRuntimeSender({ id: "foreign" }, extensionId, extensionUrlPrefix)
    ).toBe("untrusted")
    expect(classifyRuntimeSender({}, extensionId, extensionUrlPrefix)).toBe(
      "untrusted"
    )
  })

  it("keeps extension pages privileged when opened in a browser tab", () => {
    expect(
      classifyRuntimeSender(
        {
          id: extensionId,
          tab: { id: 9 },
          url: `${extensionUrlPrefix}options.html`
        },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe("extension-page")
    expect(
      classifyRuntimeSender(
        {
          id: extensionId,
          tab: { id: 10 },
          origin: "chrome-extension://extension-id"
        },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe("extension-page")
  })

  it("allows extension pages to use the internal runtime API", () => {
    expect(
      messageAllowed(MESSAGE_KEYS.PROVIDER.DELETE_MODEL, extensionPage)
    ).toBe(true)
    expect(portAllowed("request-id", extensionPage)).toBe(true)
    expect(
      portMessageAllowed(
        "request-id",
        MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
        extensionPage
      )
    ).toBe(true)
    expect(
      portMessageAllowed(MESSAGE_KEYS.PROVIDER.PULL_MODEL, "", extensionPage)
    ).toBe(true)
  })

  it("gives content scripts only the narrow message allowlist", () => {
    expect(messageAllowed(MESSAGE_KEYS.PROVIDER.GET_MODELS)).toBe(true)
    expect(messageAllowed(MESSAGE_KEYS.OLLAMA.GET_MODELS)).toBe(true)
    expect(messageAllowed(MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT)).toBe(
      true
    )
    expect(messageAllowed(MESSAGE_KEYS.PROVIDER.DELETE_MODEL)).toBe(false)
    expect(messageAllowed(MESSAGE_KEYS.PROVIDER.CONFIRM_TOOL)).toBe(false)
  })

  it("binds content-script messages to the selection-action port", () => {
    const portName = MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION
    expect(portAllowed(portName)).toBe(true)
    expect(
      portMessageAllowed(portName, MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION)
    ).toBe(true)
    expect(
      portMessageAllowed(
        portName,
        MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION
      )
    ).toBe(true)
    expect(
      portMessageAllowed(portName, MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL)
    ).toBe(false)
    expect(portAllowed(MESSAGE_KEYS.BROWSER.SELECTION_BRIDGE_PORT)).toBe(false)
  })

  it("rejects every message and port from foreign senders", () => {
    const foreign = {
      id: "foreign",
      tab: { id: 7 },
      url: "https://example.com"
    }
    expect(messageAllowed(MESSAGE_KEYS.PROVIDER.GET_MODELS, foreign)).toBe(
      false
    )
    expect(
      portAllowed(MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION, foreign)
    ).toBe(false)
    expect(
      portMessageAllowed(
        MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
        MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
        foreign
      )
    ).toBe(false)
  })
})
