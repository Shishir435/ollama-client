import { describe, it, expect, vi, beforeEach } from "vitest"
import { PdfProcessor } from "../pdf-processor"

// Mock pdfjs-dist
const mockGetPage = vi.fn()
const mockGetTextContent = vi.fn()
const mockGetDocument = vi.fn()

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
      getPage: mockGetPage
    }
    
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(mockPdf)
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
    expect(result.metadata.pageCount).toBe(1)
  })

  it("should handle worker failure and retry", async () => {
    const mockPdf = {
      numPages: 1,
      getPage: mockGetPage
    }

    // First attempt fails
    mockGetDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("Worker failed"))
    })
    
    // Second attempt succeeds
    mockGetDocument.mockReturnValueOnce({
      promise: Promise.resolve(mockPdf)
    })

    mockGetPage.mockResolvedValue({
      getTextContent: mockGetTextContent
    })
    
    mockGetTextContent.mockResolvedValue({
      items: [{ str: "Retry content" }]
    })

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })
    const result = await processor.process(file)

    expect(result.text).toContain("Retry content")
    expect(mockGetDocument).toHaveBeenCalledTimes(2)
  })

  it("should handle empty PDF", async () => {
    const mockPdf = {
      numPages: 1,
      getPage: mockGetPage
    }
    
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(mockPdf)
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
      promise: Promise.reject(new Error("Corrupt PDF"))
    })

    const file = new File(["content"], "test.pdf", { type: "application/pdf" })
    
    await expect(processor.process(file)).rejects.toThrow("Failed to process PDF")
  })
})
