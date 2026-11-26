import { beforeEach, describe, expect, it, vi } from "vitest"
import { PDF_LOAD_TIMEOUT_MS } from "@/lib/constants"
import {
  PdfFailureError,
  pdfFailureCode
} from "@/lib/file-processors/pdf-failure"
import { PdfProcessor, pdfTextFromPages } from "../pdf-processor"

// Mock pdfjs-dist
const mockGetPage = vi.fn()
const mockGetTextContent = vi.fn()
const mockGetDocument = vi.fn()
const mockDestroyDocument = vi.fn().mockResolvedValue(undefined)
const mockDestroyLoadingTask = vi.fn().mockResolvedValue(undefined)

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (...args: any[]) => mockGetDocument(...args)
}))

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs", () => ({}))

describe("PdfProcessor", () => {
  let processor: PdfProcessor

  beforeEach(() => {
    processor = new PdfProcessor()
    vi.clearAllMocks()
    mockDestroyDocument.mockResolvedValue(undefined)
    mockDestroyLoadingTask.mockResolvedValue(undefined)
  })

  it("should identify PDF files", () => {
    const file = new File([""], "test.pdf", { type: "application/pdf" })
    expect(processor.canProcess(file)).toBe(true)
  })

  it("should reject non-PDF files", () => {
    const file = new File([""], "test.txt", { type: "text/plain" })
    expect(processor.canProcess(file)).toBe(false)
  })

  it("should process valid PDF file", async () => {
    const mockPdf = {
      numPages: 1,
      getPage: mockGetPage,
      destroy: mockDestroyDocument
    }

    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(mockPdf),
      destroy: mockDestroyLoadingTask
    })

    mockGetPage.mockResolvedValue({
      getTextContent: mockGetTextContent
    })

    mockGetTextContent.mockResolvedValue({
      items: [{ str: "Page content" }]
    })

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })
    const result = await processor.process(file)

    expect(result.text).toContain("Page content")
    expect(result.pages).toEqual([{ pageNumber: 1, text: "Page content" }])
    expect(result.metadata.pageCount).toBe(1)
    expect(mockDestroyDocument).toHaveBeenCalledOnce()
    expect(mockDestroyLoadingTask).not.toHaveBeenCalled()
  })

  it("stops between pages once the caller leaves and releases the document", async () => {
    const controller = new AbortController()
    const gone = new Error("gone")
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 5,
        getPage: mockGetPage,
        destroy: mockDestroyDocument
      }),
      destroy: mockDestroyLoadingTask
    })
    mockGetPage.mockResolvedValue({ getTextContent: mockGetTextContent })
    mockGetTextContent.mockImplementation(async () => {
      if (mockGetPage.mock.calls.length === 2) controller.abort(gone)
      return { items: [{ str: "text" }] }
    })

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })
    await expect(processor.process(file, controller.signal)).rejects.toBe(gone)

    expect(mockGetPage).toHaveBeenCalledTimes(2)
    expect(mockDestroyDocument).toHaveBeenCalledOnce()
  })

  it("stops a page read that never settles once the caller leaves", async () => {
    const controller = new AbortController()
    const gone = new Error("gone")
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: mockGetPage,
        destroy: mockDestroyDocument
      }),
      destroy: mockDestroyLoadingTask
    })
    mockGetPage.mockResolvedValue({ getTextContent: mockGetTextContent })
    mockGetTextContent.mockReturnValue(new Promise(() => undefined))

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })
    const pending = processor.process(file, controller.signal)
    await vi.waitFor(() => expect(mockGetTextContent).toHaveBeenCalled())
    controller.abort(gone)

    await expect(pending).rejects.toBe(gone)
    expect(mockDestroyDocument).toHaveBeenCalledOnce()
  })

  it("stops a load that never settles once the caller leaves", async () => {
    const controller = new AbortController()
    const gone = new Error("gone")
    mockGetDocument.mockReturnValue({
      promise: new Promise(() => undefined),
      destroy: mockDestroyLoadingTask
    })

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })
    const pending = processor.process(file, controller.signal)
    await vi.waitFor(() => expect(mockGetDocument).toHaveBeenCalled())
    controller.abort(gone)

    await expect(pending).rejects.toBe(gone)
    expect(mockDestroyLoadingTask).toHaveBeenCalledOnce()
  })

  it("does not start pdf.js once the caller left during the file read", async () => {
    const controller = new AbortController()
    const gone = new Error("gone")
    const file = new File(["content"], "test.pdf", { type: "application/pdf" })
    file.arrayBuffer = async () => {
      controller.abort(gone)
      return new ArrayBuffer(1)
    }

    await expect(processor.process(file, controller.signal)).rejects.toBe(gone)
    expect(mockGetDocument).not.toHaveBeenCalled()
  })

  it("rebuilds the flat text from pages, matching what the processor returned", async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: mockGetPage,
        destroy: mockDestroyDocument
      }),
      destroy: mockDestroyLoadingTask
    })
    mockGetPage.mockResolvedValue({ getTextContent: mockGetTextContent })
    mockGetTextContent.mockResolvedValue({ items: [{ str: "words" }] })

    const result = await processor.process(
      new File(["content"], "test.pdf", { type: "application/pdf" })
    )

    expect(pdfTextFromPages(result.pages ?? [])).toBe(result.text)
    expect(pdfTextFromPages([])).toBe("(No text content found in PDF)")
  })

  it("should release a failed loading task without retrying", async () => {
    mockGetDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("Worker failed")),
      destroy: mockDestroyLoadingTask
    })

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })

    await expect(processor.process(file)).rejects.toThrow(
      "Failed to process PDF"
    )
    expect(mockGetDocument).toHaveBeenCalledOnce()
    expect(mockDestroyLoadingTask).toHaveBeenCalledOnce()
  })

  it("fails a PDF with no selectable text instead of storing a placeholder", async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: mockGetPage,
        destroy: mockDestroyDocument
      }),
      destroy: mockDestroyLoadingTask
    })
    mockGetPage.mockResolvedValue({ getTextContent: mockGetTextContent })
    mockGetTextContent.mockResolvedValue({ items: [{ str: "   " }] })

    const failure = await processor
      .process(new File(["content"], "scan.pdf", { type: "application/pdf" }))
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PdfFailureError)
    expect(pdfFailureCode((failure as Error).message)).toBe("no_text")
    expect(mockDestroyDocument).toHaveBeenCalledOnce()
  })

  it("names a password-protected PDF", async () => {
    const locked = Object.assign(new Error("No password given"), {
      name: "PasswordException"
    })
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(locked),
      destroy: mockDestroyLoadingTask
    })

    const failure = await processor
      .process(new File(["content"], "locked.pdf", { type: "application/pdf" }))
      .catch((error: unknown) => error)

    expect(pdfFailureCode((failure as Error).message)).toBe("password")
  })

  it("names a PDF that never finishes loading", async () => {
    vi.useFakeTimers()
    try {
      mockGetDocument.mockReturnValue({
        promise: new Promise(() => undefined),
        destroy: mockDestroyLoadingTask
      })
      const pending = processor
        .process(new File(["x"], "slow.pdf", { type: "application/pdf" }))
        .catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(PDF_LOAD_TIMEOUT_MS + 1)

      expect(pdfFailureCode(((await pending) as Error).message)).toBe("timeout")
    } finally {
      vi.useRealTimers()
    }
  })

  it("names a corrupt PDF", async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(
        Object.assign(new Error("Invalid PDF structure."), {
          name: "InvalidPDFException"
        })
      ),
      destroy: mockDestroyLoadingTask
    })

    const failure = await processor
      .process(new File(["junk"], "bad.pdf", { type: "application/pdf" }))
      .catch((error: unknown) => error)

    expect(pdfFailureCode((failure as Error).message)).toBe("corrupt")
  })

  it("should handle processing errors", async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error("Corrupt PDF")),
      destroy: mockDestroyLoadingTask
    })

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })

    await expect(processor.process(file)).rejects.toThrow(
      "Failed to process PDF"
    )
    expect(mockDestroyLoadingTask).toHaveBeenCalledOnce()
  })
})
