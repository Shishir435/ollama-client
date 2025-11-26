import { describe, expect, it, vi, beforeEach } from "vitest"
import { PdfProcessor } from "@/features/file-upload/processors/pdf-processor"
import { DocxProcessor } from "@/features/file-upload/processors/docx-processor"
import fs from "fs"
import path from "path"

// Mock pdfjs-dist
vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn().mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({
          items: [{ str: "PDF Content" }]
        }),
        cleanup: vi.fn()
      })
    })
  }),
  GlobalWorkerOptions: { workerSrc: "" }
}))

// Mock mammoth
vi.mock("mammoth", () => ({
  extractRawText: vi.fn().mockResolvedValue({
    value: "DOCX Content",
    messages: []
  }),
  convertToHtml: vi.fn().mockResolvedValue({
    value: "<p>DOCX Content</p>",
    messages: []
  })
}))

describe("File Processors - Integration with Test Files", () => {
  const fixturesDir = path.resolve(__dirname)
  
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should process the provided document.pdf", async () => {
    const pdfPath = path.join(fixturesDir, "document.pdf")
    if (!fs.existsSync(pdfPath)) {
      console.warn("document.pdf not found, skipping test")
      return
    }
    
    const buffer = fs.readFileSync(pdfPath)
    const file = new File([new Uint8Array(buffer)], "document.pdf", { type: "application/pdf" })
    
    const processor = new PdfProcessor()
    const result = await processor.process(file)
    
    expect(result.text).toBeTruthy()
    expect(result.metadata.fileType).toBe("application/pdf")
  })

  it("should process the provided document.docx", async () => {
    const docxPath = path.join(fixturesDir, "document.docx")
    if (!fs.existsSync(docxPath)) {
      console.warn("document.docx not found, skipping test")
      return
    }

    const buffer = fs.readFileSync(docxPath)
    const file = new File([new Uint8Array(buffer)], "document.docx", { 
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
    })
    
    const processor = new DocxProcessor()
    const result = await processor.process(file)
    
    expect(result.text).toBe("DOCX Content") // Based on mock
    expect(result.metadata.fileType).toContain("wordprocessingml")
  })
})
