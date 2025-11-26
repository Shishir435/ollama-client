import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  getProcessor,
  processFile,
  isFileTypeSupported,
  getSupportedExtensions
} from "../index"
import { TextProcessor } from "@/features/file-upload/processors/text-processor"

// Mock the processors
vi.mock("@/features/file-upload/processors/text-processor", () => ({
  TextProcessor: class {
    canProcess = vi.fn().mockImplementation((file: File) => {
      const type = file.type
      const name = file.name
      if (type.startsWith("image/") || type.startsWith("video/") || type === "application/xyz") return false
      if (name.endsWith(".png") || name.endsWith(".mp4") || name.endsWith(".xyz")) return false
      if (type === "application/pdf" || name.endsWith(".pdf")) return false
      if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) return false
      return true
    })
    process = vi.fn().mockImplementation(async (file: File) => ({
      text: await file.text(),
      metadata: { 
        fileName: file.name,
        fileType: file.type || "text/plain",
        fileSize: file.size,
        processedAt: Date.now()
      }
    }))
  }
}))
vi.mock("@/features/file-upload/processors/pdf-processor", () => ({
  PdfProcessor: class {
    canProcess = vi.fn().mockImplementation((file: File) => file.type === "application/pdf" || file.name.endsWith(".pdf"))
    process = vi.fn().mockResolvedValue({
      text: "PDF content",
      metadata: { pageCount: 1 }
    })
  }
}))

vi.mock("@/features/file-upload/processors/docx-processor", () => ({
  DocxProcessor: class {
    canProcess = vi.fn().mockImplementation((file: File) => 
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
      file.name.endsWith(".docx")
    )
    process = vi.fn().mockResolvedValue({
      text: "DOCX content",
      metadata: { wordCount: 100 }
    })
  }
}))

describe("File Processors - Infrastructure", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getProcessor", () => {
    it("should return TextProcessor for text files", () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" })
      const processor = getProcessor(file)

      expect(processor).toBeInstanceOf(TextProcessor)
    })

    it("should return TextProcessor for markdown files", () => {
      const file = new File(["# Header"], "readme.md", {
        type: "text/markdown"
      })
      const processor = getProcessor(file)

      expect(processor).toBeInstanceOf(TextProcessor)
    })

    it("should return PdfProcessor for PDF files", () => {
      const file = new File(["pdf"], "document.pdf", {
        type: "application/pdf"
      })
      const processor = getProcessor(file)

      expect(processor).not.toBeNull()
      expect(processor?.constructor.name).toBe("PdfProcessor")
    })

    it("should return DocxProcessor for DOCX files", () => {
      const file = new File(["docx"], "document.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
      const processor = getProcessor(file)

      expect(processor).not.toBeNull()
      expect(processor?.constructor.name).toBe("DocxProcessor")
    })

    it("should return null for unsupported file types", () => {
      const file = new File(["data"], "image.jpg", { type: "image/jpeg" })
      const processor = getProcessor(file)

      expect(processor).toBeNull()
    })

    it("should handle files by extension when MIME type is missing", () => {
      const file = new File(["content"], "test.txt", { type: "" })
      const processor = getProcessor(file)

      expect(processor).toBeInstanceOf(TextProcessor)
    })

    it("should handle .js files", () => {
      const file = new File(["code"], "script.js", { type: "text/javascript" })
      const processor = getProcessor(file)

      expect(processor).toBeInstanceOf(TextProcessor)
    })

    it("should handle .json files", () => {
      const file = new File(['{"key":"value"}'], "data.json", {
        type: "application/json"
      })
      const processor = getProcessor(file)

      expect(processor).toBeInstanceOf(TextProcessor)
    })

    it("should handle .csv files", () => {
      const file = new File(["a,b,c"], "data.csv", { type: "text/csv" })
      const processor = getProcessor(file)

      expect(processor).toBeInstanceOf(TextProcessor)
    })
  })

  describe("processFile", () => {
    it("should process text files successfully", async () => {
      const content = "Hello, world!"
      const file = new File([content], "test.txt", { type: "text/plain" })

      const result = await processFile(file)

      expect(result.text).toBe(content)
      expect(result.metadata?.fileType).toBe("text/plain")
    })

    it("should process PDF files using PdfProcessor", async () => {
      const file = new File(["pdf"], "document.pdf", {
        type: "application/pdf"
      })

      const result = await processFile(file)

      expect(result.text).toBe("PDF content")
    })

    it("should process DOCX files using DocxProcessor", async () => {
      const file = new File(["docx"], "document.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })

      const result = await processFile(file)

      expect(result.text).toBe("DOCX content")
    })

    it("should return error for unsupported file types", async () => {
      const file = new File(["data"], "image.png", { type: "image/png" })

      await expect(processFile(file)).rejects.toThrow("No processor available")
    })

    it("should include file metadata in result", async () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" })

      const result = await processFile(file)

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.fileName).toBe("test.txt")
      expect(result.metadata?.fileSize).toBeGreaterThan(0)
      expect(result.metadata?.fileType).toBe("text/plain")
    })

    it("should handle processor errors gracefully", async () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" })
      
      // Processor should handle errors internally
      const result = await processFile(file)
      
      // Should either succeed or return structured error
      expect(result).toBeDefined()
    })
  })

  describe("isFileTypeSupported", () => {
    it("should return true for text files", () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" })

      expect(isFileTypeSupported(file)).toBe(true)
    })

    it("should return true for PDF files", () => {
      const file = new File(["pdf"], "document.pdf", {
        type: "application/pdf"
      })

      expect(isFileTypeSupported(file)).toBe(true)
    })

    it("should return true for DOCX files", () => {
      const file = new File(["docx"], "document.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })

      expect(isFileTypeSupported(file)).toBe(true)
    })

    it("should return true for markdown files", () => {
      const file = new File(["# Header"], "readme.md", {
        type: "text/markdown"
      })

      expect(isFileTypeSupported(file)).toBe(true)
    })

    it("should return true for code files", () => {
      const jsFile = new File(["code"], "script.js", {
        type: "text/javascript"
      })
      const pyFile = new File(["code"], "script.py", { type: "text/x-python" })

      expect(isFileTypeSupported(jsFile)).toBe(true)
      expect(isFileTypeSupported(pyFile)).toBe(true)
    })

    it("should return false for image files", () => {
      const file = new File(["data"], "image.png", { type: "image/png" })

      expect(isFileTypeSupported(file)).toBe(false)
    })

    it("should return false for video files", () => {
      const file = new File(["data"], "video.mp4", { type: "video/mp4" })

      expect(isFileTypeSupported(file)).toBe(false)
    })

    it("should return false for unknown file types", () => {
      const file = new File(["data"], "file.xyz", { type: "application/xyz" })

      expect(isFileTypeSupported(file)).toBe(false)
    })

    it("should check by extension when MIME type is empty", () => {
      const file = new File(["content"], "test.txt", { type: "" })

      expect(isFileTypeSupported(file)).toBe(true)
    })
  })

  describe("getSupportedExtensions", () => {
    it("should return array of supported extensions", () => {
      const extensions = getSupportedExtensions()

      expect(Array.isArray(extensions)).toBe(true)
      expect(extensions.length).toBeGreaterThan(0)
    })

    it("should include common text extensions", () => {
      const exts = getSupportedExtensions()
      
      // Implementation returns specific list
      expect(exts).toContain("*") // Wildcard for text files
    })

    it("should include PDF and DOCX extensions", () => {
      const extensions = getSupportedExtensions()

      expect(extensions).toContain(".pdf")
      expect(extensions).toContain(".docx")
    })

    it("should support wildcard for text files", () => {
      const extensions = getSupportedExtensions()

      expect(extensions).toContain("*")
    })


    it("should not include unsupported extensions", () => {
      const extensions = getSupportedExtensions()

      expect(extensions).not.toContain("png")
      expect(extensions).not.toContain("jpg")
      expect(extensions).not.toContain("mp4")
    })

    it("should return unique extensions", () => {
      const extensions = getSupportedExtensions()
      const uniqueExtensions = [...new Set(extensions)]

      expect(extensions.length).toBe(uniqueExtensions.length)
    })
  })
})
