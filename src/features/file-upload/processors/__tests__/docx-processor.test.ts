import { describe, it, expect, vi, beforeEach } from "vitest"
import { DocxProcessor } from "../docx-processor"

// Mock mammoth
const mockExtractRawText = vi.fn()
const mockConvertToHtml = vi.fn()

vi.mock("mammoth", () => ({
  extractRawText: (...args: any[]) => mockExtractRawText(...args),
  convertToHtml: (...args: any[]) => mockConvertToHtml(...args)
}))

describe("DocxProcessor", () => {
  let processor: DocxProcessor

  beforeEach(() => {
    processor = new DocxProcessor()
    vi.clearAllMocks()
  })

  it("should identify DOCX files", () => {
    const file = new File([""], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    expect(processor.canProcess(file)).toBe(true)
  })

  it("should reject non-DOCX files", () => {
    const file = new File([""], "test.txt", { type: "text/plain" })
    expect(processor.canProcess(file)).toBe(false)
  })

  it("should process valid DOCX file", async () => {
    mockExtractRawText.mockResolvedValue({ value: "Raw text content" })
    mockConvertToHtml.mockResolvedValue({ value: "<p>HTML content</p>" })

    const file = new File(["content"], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    const result = await processor.process(file)

    expect(result.text).toBe("Raw text content")
    expect(result.metadata.fileName).toBe("test.docx")
  })

  it("should fallback to HTML content if raw text is empty", async () => {
    mockExtractRawText.mockResolvedValue({ value: "  " }) // Empty/whitespace
    mockConvertToHtml.mockResolvedValue({ value: "<p>HTML content</p>" })

    const file = new File(["content"], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    const result = await processor.process(file)

    expect(result.text).toBe("<p>HTML content</p>")
  })

  it("should return fallback message if no content found", async () => {
    mockExtractRawText.mockResolvedValue({ value: "" })
    mockConvertToHtml.mockResolvedValue({ value: "" })

    const file = new File(["content"], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    const result = await processor.process(file)

    expect(result.text).toContain("No text content found")
  })

  it("should handle processing errors", async () => {
    mockExtractRawText.mockRejectedValue(new Error("Corrupt file"))

    const file = new File(["content"], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    
    await expect(processor.process(file)).rejects.toThrow("Failed to process DOCX: Corrupt file")
  })
})
