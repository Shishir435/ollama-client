import { beforeEach, describe, expect, it, vi } from "vitest"
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

  it("should handle empty PDF", async () => {
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
      items: []
    })

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })
    const result = await processor.process(file)

    expect(result.text).toContain("No text content found")
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
