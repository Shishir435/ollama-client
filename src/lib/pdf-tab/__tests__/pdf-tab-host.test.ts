import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const process = vi.hoisted(() => vi.fn())

vi.mock("@/application/file-processing/processors/pdf-processor", () => ({
  PdfProcessor: class {
    process = process
  }
}))

import { FILE_UPLOAD } from "@/lib/constants"
import { PdfFailureError } from "@/lib/file-processors/pdf-failure"
import { extractPdfFromUrl } from "../pdf-tab-host"

const pdfBytes = (extra = ""): Uint8Array =>
  new TextEncoder().encode(`%PDF-1.4\n${extra}`)

const respond = (body: unknown, init: ResponseInit = { status: 200 }) =>
  vi.fn().mockResolvedValue(new Response(body as BodyInit, init))

describe("extractPdfFromUrl", () => {
  beforeEach(() => {
    process.mockReset()
    process.mockResolvedValue({
      text: "",
      pages: [
        { pageNumber: 1, text: "First page" },
        { pageNumber: 2, text: "Second page" }
      ],
      metadata: { pageCount: 2 }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("downloads the document and returns its pages", async () => {
    const fetchMock = respond(pdfBytes())
    vi.stubGlobal("fetch", fetchMock)

    const result = await extractPdfFromUrl("https://example.com/paper.pdf")

    expect(result).toEqual({
      ok: true,
      pages: [
        { pageNumber: 1, text: "First page" },
        { pageNumber: 2, text: "Second page" }
      ],
      pageCount: 2,
      truncated: false
    })
    const file = process.mock.calls[0][0] as File
    expect(file.name).toBe("paper.pdf")
    expect(file.type).toBe("application/pdf")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/paper.pdf",
      expect.objectContaining({ credentials: "include" })
    )
  })

  it("refuses an address that is not a web or file address", async () => {
    const fetchMock = respond(pdfBytes())
    vi.stubGlobal("fetch", fetchMock)

    await expect(extractPdfFromUrl("chrome://settings")).resolves.toEqual({
      ok: false,
      code: "unreachable"
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reports a failed download as unreachable", async () => {
    vi.stubGlobal("fetch", respond("nope", { status: 404 }))
    await expect(
      extractPdfFromUrl("https://example.com/a.pdf")
    ).resolves.toEqual({ ok: false, code: "unreachable" })

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed")))
    await expect(
      extractPdfFromUrl("https://example.com/a.pdf")
    ).resolves.toEqual({ ok: false, code: "unreachable" })
    expect(process).not.toHaveBeenCalled()
  })

  it("does not parse something that only has a .pdf address", async () => {
    vi.stubGlobal("fetch", respond("<html>Please log in</html>"))

    await expect(
      extractPdfFromUrl("https://example.com/a.pdf")
    ).resolves.toEqual({ ok: false, code: "not_pdf" })
    expect(process).not.toHaveBeenCalled()
  })

  it("refuses a document larger than the upload limit, by header", async () => {
    vi.stubGlobal(
      "fetch",
      respond(pdfBytes(), {
        status: 200,
        headers: { "content-length": String(FILE_UPLOAD.MAX_SIZE + 1) }
      })
    )

    await expect(
      extractPdfFromUrl("https://example.com/a.pdf")
    ).resolves.toEqual({ ok: false, code: "too_large" })
    expect(process).not.toHaveBeenCalled()
  })

  it("refuses a document that grows past the limit while streaming", async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ > 12) controller.close()
        else controller.enqueue(chunk)
      }
    })
    vi.stubGlobal("fetch", respond(body))

    await expect(
      extractPdfFromUrl("https://example.com/a.pdf")
    ).resolves.toEqual({ ok: false, code: "too_large" })
  })

  it.each(["no_text", "password", "timeout", "corrupt"] as const)(
    "passes the parser's %s reason through",
    async (code) => {
      vi.stubGlobal("fetch", respond(pdfBytes()))
      process.mockRejectedValue(new PdfFailureError(code))

      await expect(
        extractPdfFromUrl("https://example.com/a.pdf")
      ).resolves.toEqual({ ok: false, code })
    }
  )

  it("cuts the text at the ceiling and says it did", async () => {
    vi.stubGlobal("fetch", respond(pdfBytes()))
    process.mockResolvedValue({
      text: "",
      pages: [
        { pageNumber: 1, text: "a".repeat(600_000) },
        { pageNumber: 2, text: "b".repeat(600_000) }
      ],
      metadata: { pageCount: 2 }
    })

    const result = await extractPdfFromUrl("https://example.com/a.pdf")

    expect(result).toMatchObject({ ok: true, pageCount: 2, truncated: true })
    expect((result as { pages: unknown[] }).pages).toHaveLength(1)
  })

  it("lets the caller's abort through instead of reporting a failure", async () => {
    const controller = new AbortController()
    const gone = new Error("gone")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        controller.abort(gone)
        init.signal?.throwIfAborted()
        return new Response(pdfBytes() as unknown as BodyInit)
      })
    )

    await expect(
      extractPdfFromUrl("https://example.com/a.pdf", controller.signal)
    ).rejects.toBe(gone)
  })

  it("gives up on a download that outlasts the budget", async () => {
    const expired = new AbortController()
    expired.abort(new DOMException("timed out", "TimeoutError"))
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(expired.signal)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        init.signal?.throwIfAborted()
        return new Response(pdfBytes() as unknown as BodyInit)
      })
    )

    await expect(
      extractPdfFromUrl("https://example.com/a.pdf")
    ).resolves.toEqual({ ok: false, code: "timeout" })
    vi.restoreAllMocks()
  })

  it("reads a local file address the same way", async () => {
    const fetchMock = respond(pdfBytes())
    vi.stubGlobal("fetch", fetchMock)

    const result = await extractPdfFromUrl("file:///Users/me/notes.pdf")

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      "file:///Users/me/notes.pdf",
      expect.anything()
    )
  })
})
