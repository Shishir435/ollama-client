import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  isAllowedFileSchemeAccess: vi.fn(),
  classifyTabAccess: vi.fn(),
  ensurePersistenceHost: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: { sendMessage: mocks.sendMessage },
    extension: { isAllowedFileSchemeAccess: mocks.isAllowedFileSchemeAccess }
  }
}))
vi.mock("@/lib/browser-tab-access", () => ({
  classifyTabAccess: mocks.classifyTabAccess
}))
vi.mock("@/lib/persistence/client", () => ({
  ensurePersistenceHost: mocks.ensurePersistenceHost
}))

import { clearPdfTabCache, readPdfTab } from "../pdf-tab-client"
import {
  PDF_TAB_CANCEL_REQUEST,
  PDF_TAB_EXTRACT_REQUEST
} from "../pdf-tab-protocol"

const URL_WEB = "https://example.com/paper.pdf"
const URL_FILE = "file:///Users/me/notes.pdf"

const extractCalls = () =>
  mocks.sendMessage.mock.calls.filter(
    ([message]) => message?.type === PDF_TAB_EXTRACT_REQUEST
  )

describe("readPdfTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearPdfTabCache()
    mocks.classifyTabAccess.mockResolvedValue("ok")
    mocks.ensurePersistenceHost.mockResolvedValue(undefined)
    mocks.isAllowedFileSchemeAccess.mockResolvedValue(true)
    mocks.sendMessage.mockResolvedValue({
      ok: true,
      pages: [
        { pageNumber: 1, text: "Alpha" },
        { pageNumber: 3, text: "Gamma" }
      ],
      pageCount: 3,
      truncated: false
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns the text with page markers a citation can point at", async () => {
    const result = await readPdfTab({ url: URL_WEB, title: "Paper" })

    expect(result).toEqual({
      ok: true,
      title: "Paper",
      text: "--- Page 1 ---\nAlpha\n\n--- Page 3 ---\nGamma"
    })
    expect(extractCalls()[0][0]).toMatchObject({ url: URL_WEB })
  })

  it("names the file when the tab has no title", async () => {
    const result = await readPdfTab({ url: URL_WEB })
    expect(result).toMatchObject({ ok: true, title: "paper.pdf" })
  })

  it("notes when only part of a long document is included", async () => {
    mocks.sendMessage.mockResolvedValue({
      ok: true,
      pages: [{ pageNumber: 1, text: "Alpha" }],
      pageCount: 900,
      truncated: true
    })

    const result = await readPdfTab({ url: URL_WEB, title: "Big" })

    expect(result).toMatchObject({ ok: true })
    expect((result as { text: string }).text).toContain("900 pages")
  })

  it("does not fetch a page the user excluded or the browser blocks", async () => {
    mocks.classifyTabAccess.mockResolvedValue("excluded")

    const result = await readPdfTab({ url: URL_WEB, title: "Paper" })

    expect(result).toMatchObject({ ok: false, issue: "restricted" })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  describe("when the address redirects", () => {
    const DESTINATION = "https://cdn.example/paper.pdf"
    const redirect = { ok: false, code: "redirected", url: DESTINATION }

    it("reads the destination once it passes the same access rules", async () => {
      mocks.sendMessage.mockResolvedValueOnce(redirect)

      const result = await readPdfTab({ url: URL_WEB, title: "Paper" })

      expect(result).toMatchObject({ ok: true })
      expect(mocks.classifyTabAccess).toHaveBeenLastCalledWith(DESTINATION)
      expect(extractCalls().map(([message]) => message.url)).toEqual([
        URL_WEB,
        DESTINATION
      ])
    })

    it("never fetches a destination the user excluded", async () => {
      mocks.sendMessage.mockResolvedValueOnce(redirect)
      mocks.classifyTabAccess.mockImplementation(async (url: string) =>
        url === DESTINATION ? "excluded" : "ok"
      )

      const result = await readPdfTab({ url: URL_WEB, title: "Paper" })

      expect(result).toMatchObject({ ok: false, issue: "restricted" })
      expect(extractCalls()).toHaveLength(1)
    })

    it("gives up on a redirect loop", async () => {
      mocks.sendMessage.mockResolvedValue(redirect)

      const result = await readPdfTab({ url: URL_WEB, title: "Paper" })

      expect(result).toMatchObject({ ok: false, issue: "pdf_unreachable" })
      expect(extractCalls()).toHaveLength(4)
    })
  })

  it("does not fetch an incognito tab's PDF with the regular profile", async () => {
    const result = await readPdfTab({ url: URL_WEB, incognito: true })

    expect(result).toMatchObject({ ok: false, issue: "restricted" })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("tells the user to allow file access for a local PDF, without downloading", async () => {
    mocks.isAllowedFileSchemeAccess.mockResolvedValue(false)

    const result = await readPdfTab({ url: URL_FILE, title: "notes.pdf" })

    expect(result).toMatchObject({ ok: false, issue: "pdf_file_access" })
    /** The model is told to stop and what to ask the user for. */
    expect((result as { message: string }).message).toContain(
      "Allow access to file URLs"
    )
    expect((result as { message: string }).message).toContain("Do not retry")
    expect(extractCalls()).toHaveLength(0)
  })

  it("reads a local PDF once file access is on", async () => {
    const result = await readPdfTab({ url: URL_FILE, title: "notes.pdf" })

    expect(result).toMatchObject({ ok: true })
    expect(extractCalls()).toHaveLength(1)
  })

  it("reads a local PDF where the browser cannot say whether access is on", async () => {
    mocks.isAllowedFileSchemeAccess.mockRejectedValue(new Error("unsupported"))

    expect(await readPdfTab({ url: URL_FILE, title: "n.pdf" })).toMatchObject({
      ok: true
    })
  })

  it("treats a refused local download as missing file access", async () => {
    mocks.sendMessage.mockResolvedValue({ ok: false, code: "unreachable" })

    expect(await readPdfTab({ url: URL_FILE, title: "n.pdf" })).toMatchObject({
      ok: false,
      issue: "pdf_file_access"
    })
  })

  it.each([
    ["no_text", "pdf_no_text"],
    ["password", "pdf_password"],
    ["timeout", "pdf_timeout"],
    ["corrupt", "pdf_corrupt"],
    ["not_pdf", "pdf_corrupt"],
    ["too_large", "pdf_too_large"],
    ["unreachable", "pdf_unreachable"]
  ] as const)("maps a %s failure to the %s issue", async (code, issue) => {
    mocks.sendMessage.mockResolvedValue({ ok: false, code })

    const result = await readPdfTab({ url: URL_WEB, title: "Paper" })

    expect(result).toMatchObject({ ok: false, issue })
    expect((result as { message: string }).message).toContain("Do not retry")
  })

  it("does not download a read it already has", async () => {
    await readPdfTab({ url: URL_WEB, title: "Paper" })
    await readPdfTab({ url: URL_WEB, title: "Paper" })
    expect(extractCalls()).toHaveLength(1)

    await readPdfTab({ url: URL_WEB, title: "Paper" }, { force: true })
    expect(extractCalls()).toHaveLength(2)
  })

  it("does not download a scanned PDF again on every refresh", async () => {
    mocks.sendMessage.mockResolvedValue({ ok: false, code: "no_text" })

    await readPdfTab({ url: URL_WEB, title: "Scan" })
    await readPdfTab({ url: URL_WEB, title: "Scan" })

    expect(extractCalls()).toHaveLength(1)
  })

  it("does not download a scanned PDF again on a forced refresh", async () => {
    mocks.sendMessage.mockResolvedValue({ ok: false, code: "no_text" })

    await readPdfTab({ url: URL_WEB, title: "Scan" })
    await readPdfTab({ url: URL_WEB, title: "Scan" }, { force: true })

    expect(extractCalls()).toHaveLength(1)
  })

  it("serves no earlier text once a forced re-read fails", async () => {
    await readPdfTab({ url: URL_WEB, title: "Paper" })
    mocks.sendMessage.mockResolvedValue({ ok: false, code: "timeout" })

    await readPdfTab({ url: URL_WEB, title: "Paper" }, { force: true })
    const next = await readPdfTab({ url: URL_WEB, title: "Paper" })

    expect(next).toMatchObject({ ok: false, issue: "pdf_timeout" })
    expect(extractCalls()).toHaveLength(3)
  })

  it("tries a slow or unreachable PDF again next time", async () => {
    mocks.sendMessage.mockResolvedValue({ ok: false, code: "timeout" })

    await readPdfTab({ url: URL_WEB, title: "Slow" })
    await readPdfTab({ url: URL_WEB, title: "Slow" })

    expect(extractCalls()).toHaveLength(2)
  })

  it("waits for a host that is still starting", async () => {
    vi.useFakeTimers()
    mocks.sendMessage
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce(undefined)
    const pending = readPdfTab({ url: URL_WEB, title: "Paper" })
    await vi.advanceTimersByTimeAsync(500)

    expect(await pending).toMatchObject({ ok: true })
    expect(extractCalls().length).toBeGreaterThanOrEqual(3)
  })

  it("stops and tells the host when the caller leaves", async () => {
    const controller = new AbortController()
    const gone = new Error("cancelled")
    mocks.sendMessage.mockImplementation((message: { type: string }) =>
      message.type === PDF_TAB_EXTRACT_REQUEST
        ? new Promise(() => undefined)
        : Promise.resolve(undefined)
    )

    const pending = readPdfTab(
      { url: URL_WEB, title: "Paper" },
      { signal: controller.signal }
    )
    await vi.waitFor(() => expect(extractCalls()).toHaveLength(1))
    controller.abort(gone)

    await expect(pending).rejects.toBe(gone)
    const cancel = mocks.sendMessage.mock.calls.find(
      ([message]) => message?.type === PDF_TAB_CANCEL_REQUEST
    )
    expect(cancel?.[0].requestId).toBe(extractCalls()[0][0].requestId)
  })

  it("does not start a read for a caller that already left", async () => {
    const controller = new AbortController()
    controller.abort(new Error("already gone"))

    await expect(
      readPdfTab(
        { url: URL_WEB, title: "Paper" },
        { signal: controller.signal }
      )
    ).rejects.toThrow("already gone")
    expect(extractCalls()).toHaveLength(0)
  })
})
