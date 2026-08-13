import { describe, expect, it, vi } from "vitest"
import { handleChromiumPersistenceControlMessage } from "../chromium-owner"
import { handlePersistenceHostMessage } from "../owner-host"
import {
  PERSISTENCE_ENSURE,
  PERSISTENCE_MARKER,
  PERSISTENCE_RPC
} from "../protocol"

const extensionPage = {
  id: "test-extension-id",
  url: "chrome-extension://test/options.html"
}
const contentScript = {
  id: "test-extension-id",
  url: "https://example.com/page",
  tab: { id: 7 }
}
const ownerPage = {
  id: "test-extension-id",
  url: "chrome-extension://test/persistence-host.html?owner=1"
}

describe("persistence host message boundary", () => {
  it("accepts a strict ensure request from an extension page", () => {
    const respond = vi.fn()

    expect(
      handlePersistenceHostMessage(
        { type: PERSISTENCE_ENSURE },
        extensionPage,
        respond
      )
    ).toBe(true)
    expect(respond).toHaveBeenCalledWith({ ok: true })
  })

  it("rejects persistence RPC from a content script before worker access", () => {
    const respond = vi.fn()

    expect(
      handlePersistenceHostMessage(
        { type: PERSISTENCE_RPC, request: { op: "ping" } },
        contentScript,
        respond
      )
    ).toBe(true)
    expect(respond).toHaveBeenCalledWith({
      ok: false,
      error: "Persistence request forbidden"
    })
  })

  it("rejects malformed RPC from a trusted extension page", () => {
    const respond = vi.fn()

    expect(
      handlePersistenceHostMessage(
        {
          type: PERSISTENCE_RPC,
          request: { op: "ping", injected: "DROP TABLE sessions" }
        },
        extensionPage,
        respond
      )
    ).toBe(true)
    expect(respond).toHaveBeenCalledWith({
      ok: false,
      error: "Invalid persistence request"
    })
  })

  it("does not claim unrelated runtime messages", () => {
    expect(
      handlePersistenceHostMessage(
        { type: "unrelated" },
        extensionPage,
        vi.fn()
      )
    ).toBe(false)
  })
})

describe("Chromium persistence control boundary", () => {
  it("rejects ensure requests from content scripts", () => {
    const respond = vi.fn()

    expect(
      handleChromiumPersistenceControlMessage(
        { type: PERSISTENCE_ENSURE },
        contentScript,
        respond
      )
    ).toBe(true)
    expect(respond).toHaveBeenCalledWith({
      ok: false,
      error: "Persistence request forbidden"
    })
  })

  it("rejects marker access from ordinary extension pages", () => {
    const respond = vi.fn()

    expect(
      handleChromiumPersistenceControlMessage(
        { type: PERSISTENCE_MARKER, action: "get", scope: "backend" },
        extensionPage,
        respond
      )
    ).toBe(true)
    expect(respond).toHaveBeenCalledWith({
      ok: false,
      error: "Persistence marker forbidden"
    })
  })

  it("validates marker payloads even from the owner document", () => {
    const respond = vi.fn()

    expect(
      handleChromiumPersistenceControlMessage(
        {
          type: PERSISTENCE_MARKER,
          action: "set",
          scope: "override",
          value: "yes"
        },
        ownerPage,
        respond
      )
    ).toBe(true)
    expect(respond).toHaveBeenCalledWith({
      ok: false,
      error: "Invalid persistence marker request"
    })
  })

  it("allows a validated marker read from the owner document", async () => {
    const respond = vi.fn()
    vi.mocked(
      chrome.storage.local.get as never as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      persistence_backend_v1: { backend: "opfs" }
    })

    expect(
      handleChromiumPersistenceControlMessage(
        { type: PERSISTENCE_MARKER, action: "get", scope: "backend" },
        ownerPage,
        respond
      )
    ).toBe(true)
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        ok: true,
        value: { backend: "opfs" }
      })
    )
  })
})
