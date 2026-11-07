import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  addStrippedProviderOrigin,
  clearStrippedProviderOrigins,
  isOwnExtensionRequest,
  setStrippedProviderOrigins,
  strippedProviderOrigins,
  stripProviderOrigin,
  supportsOriginStripListener
} from "../firefox-origin-guard"

const OWN = "moz-extension://own-uuid/"
const addListener = vi.fn()
const removeListener = vi.fn()

const originalGetURL = chrome.runtime.getURL

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(chrome, {
    webRequest: { onBeforeSendHeaders: { addListener, removeListener } }
  })
  chrome.runtime.getURL = ((path: string) => `${OWN}${path}`) as never
  clearStrippedProviderOrigins()
  vi.clearAllMocks()
  return () => {
    chrome.runtime.getURL = originalGetURL
    delete (chrome as { webRequest?: unknown }).webRequest
  }
})

const headers = (origin = "moz-extension://own-uuid") => [
  { name: "Content-Type", value: "application/json" },
  { name: "Origin", value: origin }
]

describe("Firefox Origin guard", () => {
  it("strips Origin from this extension's requests to a configured provider", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])

    const response = stripProviderOrigin({
      url: "http://localhost:11434/api/chat",
      originUrl: `${OWN}_generated_background_page.html`,
      requestHeaders: headers()
    })

    expect(response.requestHeaders).toEqual([
      { name: "Content-Type", value: "application/json" }
    ])
  })

  it("covers the extension's own pages, not only its background page", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])

    const response = stripProviderOrigin({
      url: "http://localhost:11434/api/chat",
      documentUrl: `${OWN}sidepanel.html`,
      requestHeaders: headers()
    })

    expect(response.requestHeaders).toHaveLength(1)
  })

  it("leaves a web page's request to the same provider untouched", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])

    expect(
      stripProviderOrigin({
        url: "http://localhost:11434/api/chat",
        originUrl: "https://evil.example/page.html",
        documentUrl: "https://evil.example/page.html",
        requestHeaders: headers("https://evil.example")
      })
    ).toEqual({})
  })

  it("leaves another extension's request untouched", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])

    expect(
      stripProviderOrigin({
        url: "http://localhost:11434/api/chat",
        originUrl: "moz-extension://other-uuid/background.html",
        requestHeaders: headers("moz-extension://other-uuid")
      })
    ).toEqual({})
  })

  it("leaves the extension's requests to an unconfigured origin untouched", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])

    for (const url of [
      "http://localhost:1143/api/chat",
      "http://localhost:11435/api/chat",
      "https://localhost:11434/api/chat",
      "https://example.com/?u=http://localhost:11434/"
    ]) {
      expect(
        stripProviderOrigin({
          url,
          originUrl: `${OWN}sidepanel.html`,
          requestHeaders: headers()
        })
      ).toEqual({})
    }
  })

  it("registers one blocking listener narrowed to the provider hosts", () => {
    setStrippedProviderOrigins([
      "http://localhost:11434",
      "http://localhost:1234/v1",
      "https://llm.example.com/v1"
    ])

    expect(addListener).toHaveBeenCalledTimes(1)
    expect(addListener).toHaveBeenCalledWith(
      expect.any(Function),
      {
        urls: ["http://localhost/*", "https://llm.example.com/*"],
        types: ["xmlhttprequest"]
      },
      ["blocking", "requestHeaders"]
    )
  })

  it("replaces the previous listener on every reconcile", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])
    const first = addListener.mock.calls[0][0]

    setStrippedProviderOrigins(["http://localhost:1234"])

    expect(removeListener).toHaveBeenCalledWith(first)
    expect(strippedProviderOrigins()).toEqual(["http://localhost:1234"])
  })

  it("adds a draft origin without dropping the configured ones", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])

    addStrippedProviderOrigin("https://draft.example.com/v1")

    expect(strippedProviderOrigins()).toEqual([
      "http://localhost:11434",
      "https://draft.example.com"
    ])
  })

  it("drops a draft origin once the test that added it settles", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])

    const release = addStrippedProviderOrigin("https://draft.example.com/v1")
    release()

    expect(strippedProviderOrigins()).toEqual(["http://localhost:11434"])
  })

  it("keeps a configured origin a draft test also used", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])

    addStrippedProviderOrigin("http://localhost:11434")()

    expect(strippedProviderOrigins()).toEqual(["http://localhost:11434"])
  })

  it("keeps a held draft origin through a reconcile", () => {
    const release = addStrippedProviderOrigin("https://draft.example.com")

    setStrippedProviderOrigins(["http://localhost:11434"])
    expect(strippedProviderOrigins()).toEqual([
      "http://localhost:11434",
      "https://draft.example.com"
    ])

    release()
    expect(strippedProviderOrigins()).toEqual(["http://localhost:11434"])
  })

  it("strips nothing once cleared, and registers nothing for an empty set", () => {
    setStrippedProviderOrigins(["http://localhost:11434"])
    clearStrippedProviderOrigins()

    expect(removeListener).toHaveBeenCalledTimes(1)
    expect(
      stripProviderOrigin({
        url: "http://localhost:11434/api/chat",
        originUrl: `${OWN}sidepanel.html`,
        requestHeaders: headers()
      })
    ).toEqual({})

    addListener.mockClear()
    setStrippedProviderOrigins([])
    expect(addListener).not.toHaveBeenCalled()
  })

  it("strips nothing when the listener cannot be registered", () => {
    addListener.mockImplementation(() => {
      throw new Error("invalid match pattern")
    })

    expect(() =>
      setStrippedProviderOrigins(["http://localhost:11434"])
    ).toThrow("invalid match pattern")
    expect(strippedProviderOrigins()).toEqual([])
  })

  it("does not claim an initiator it cannot see", () => {
    expect(isOwnExtensionRequest({})).toBe(false)
  })

  it("reports no listener support without the webRequest permission", () => {
    delete (chrome as { webRequest?: unknown }).webRequest

    expect(supportsOriginStripListener()).toBe(false)
  })
})
