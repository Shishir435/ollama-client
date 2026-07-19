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
import type { PrintJobPayload } from "../print-job"

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

/** Every stored print job, newest-agnostic (order not guaranteed). */
const storedJobs = (): PrintJobPayload[] => {
  const jobs: PrintJobPayload[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith("print-job:")) continue
    jobs.push(JSON.parse(localStorage.getItem(key) ?? "") as PrintJobPayload)
  }
  return jobs
}

const onlyJob = (): PrintJobPayload => {
  const jobs = storedJobs()
  expect(jobs).toHaveLength(1)
  return jobs[0]
}

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

    const { html } = onlyJob()
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

    const job = onlyJob()
    expect(job.html).not.toContain("tracker.example.com/pixel.png")
    expect(job.html).toContain("blocked-remote-image")
    expect(job.allowRemoteImages).toBe(false)
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

    const job = onlyJob()
    expect(job.html).toContain("https://example.com/a.png")
    expect(job.allowRemoteImages).toBe(true)
  })

  it("renders message-scoped vision images inline as data URIs", async () => {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=="
    await pdfExporter.exportSession(
      makeSession({
        messages: [
          {
            id: "m1",
            role: "user",
            content: "what is this?",
            timestamp: 1000,
            done: true,
            images: [
              {
                imageId: "img1",
                fileName: "flag.png",
                mimeType: "image/png",
                size: 123,
                base64
              }
            ]
          }
        ]
      } as Partial<ChatSession>),
      mockT
    )

    const { html } = onlyJob()
    expect(html).toContain(`src="data:image/png;base64,${base64}"`)
    expect(html).toContain('alt="flag.png"')
    // Base64 payload is the inline image, not leaked as visible text.
    expect(html).toContain("message-image")
  })

  it("ships no remote stylesheet imports", async () => {
    await pdfExporter.exportSession(makeSession(), mockT)
    const { html } = onlyJob()
    expect(html).not.toContain("@import")
    expect(html).not.toContain("fonts.googleapis.com")
  })

  it("hands each print window its own job id", async () => {
    const open = vi.fn((_url?: string) => ({}) as Window)
    vi.stubGlobal("open", open)

    await pdfExporter.exportSession(makeSession({ title: "First" }), mockT)
    await pdfExporter.exportSession(makeSession({ title: "Second" }), mockT)

    // Concurrent exports keep separate payloads — neither overwrites the other.
    const jobs = storedJobs()
    expect(jobs).toHaveLength(2)
    expect(jobs.map((job) => job.html).join("")).toContain("First")
    expect(jobs.map((job) => job.html).join("")).toContain("Second")

    const urls = open.mock.calls.map((call) => String(call[0]))
    expect(urls[0]).toMatch(/print\.html\?job=.+/)
    expect(urls[1]).toMatch(/print\.html\?job=.+/)
    expect(urls[0]).not.toBe(urls[1])
  })

  it("cleans up and throws when the print window is blocked", async () => {
    vi.stubGlobal(
      "open",
      vi.fn(() => null)
    )

    await expect(
      pdfExporter.exportSession(makeSession(), mockT)
    ).rejects.toThrow()
    expect(storedJobs()).toHaveLength(0)
  })
})
