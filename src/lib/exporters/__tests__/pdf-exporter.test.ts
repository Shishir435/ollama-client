import type { TFunction } from "i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatSession } from "@/types"

const storedValues = vi.hoisted(() => new Map<string, unknown>())

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => storedValues.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    storedValues.set(key, value)
  })
}))

import { STORAGE_KEYS } from "@/lib/constants"
import { pdfExporter } from "../pdf-exporter"

const mockT = vi.fn((key: string) => key) as unknown as TFunction

const makeSession = (overrides: Partial<ChatSession> = {}): ChatSession =>
  ({
    id: "s1",
    title: "My Chat",
    createdAt: 1000,
    updatedAt: 2000,
    messages: [
      { id: "m1", role: "user", content: "Hello", timestamp: 1000, done: true }
    ],
    ...overrides
  }) as unknown as ChatSession

describe("pdfExporter print fragment", () => {
  beforeEach(() => {
    storedValues.clear()
    localStorage.clear()
    vi.stubGlobal(
      "open",
      vi.fn(() => ({}) as Window)
    )
    chrome.runtime.getURL = vi.fn(
      (path: string) => `chrome-extension://id/${path}`
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("escapes a markup-bearing session title", async () => {
    await pdfExporter.exportSession(
      makeSession({ title: "<img src=x onerror=alert(1)>" }),
      mockT
    )

    const html = localStorage.getItem("print_html") ?? ""
    // No element carries the payload — it survives only as escaped text.
    expect(html).not.toContain("<img src=x")
    expect(html).not.toMatch(/<[^>]*onerror/)
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
  })

  it("blocks remote message images by default and records the flag", async () => {
    await pdfExporter.exportSession(
      makeSession({
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "![pic](https://tracker.example.com/pixel.png)",
            timestamp: 1000,
            done: true
          }
        ]
      } as Partial<ChatSession>),
      mockT
    )

    const html = localStorage.getItem("print_html") ?? ""
    expect(html).not.toContain("tracker.example.com/pixel.png")
    expect(html).toContain("blocked-remote-image")
    expect(localStorage.getItem("print_allow_remote")).toBe("0")
  })

  it("keeps remote images when the user opted in", async () => {
    storedValues.set(STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES, true)

    await pdfExporter.exportSession(
      makeSession({
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "![pic](https://example.com/a.png)",
            timestamp: 1000,
            done: true
          }
        ]
      } as Partial<ChatSession>),
      mockT
    )

    const html = localStorage.getItem("print_html") ?? ""
    expect(html).toContain("https://example.com/a.png")
    expect(localStorage.getItem("print_allow_remote")).toBe("1")
  })

  it("ships no remote stylesheet imports", async () => {
    await pdfExporter.exportSession(makeSession(), mockT)
    const html = localStorage.getItem("print_html") ?? ""
    expect(html).not.toContain("@import")
    expect(html).not.toContain("fonts.googleapis.com")
  })

  it("cleans up and throws when the print window is blocked", async () => {
    vi.stubGlobal(
      "open",
      vi.fn(() => null)
    )

    await expect(
      pdfExporter.exportSession(makeSession(), mockT)
    ).rejects.toThrow()
    expect(localStorage.getItem("print_html")).toBeNull()
    expect(localStorage.getItem("print_allow_remote")).toBeNull()
  })
})
