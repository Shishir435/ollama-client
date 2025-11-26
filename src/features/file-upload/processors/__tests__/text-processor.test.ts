import { beforeEach, describe, expect, it, vi } from "vitest"
import { TextProcessor } from "../text-processor"

describe("TextProcessor", () => {
  let processor: TextProcessor

  beforeEach(() => {
    processor = new TextProcessor()
  })

  describe("canProcess", () => {
    it("should accept text files", () => {
      const file = new File(["test content"], "test.txt", { type: "text/plain" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should accept markdown files", () => {
      const file = new File(["# Header"], "test.md", { type: "text/markdown" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should accept files with no extension but text/* mime type", () => {
      const file = new File(["content"], "README", { type: "text/plain" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should reject PDF files by extension", () => {
      const file = new File([new ArrayBuffer(10)], "document.pdf", { type: "application/pdf" })
      expect(processor.canProcess(file)).toBe(false)
    })

    it("should reject PDF files by mime type", () => {
      const file = new File([new ArrayBuffer(10)], "document.unknown", { type: "application/pdf" })
      expect(processor.canProcess(file)).toBe(false)
    })

    it("should reject DOCX files", () => {
      const file = new File(
        [new ArrayBuffer(10)],
        "document.docx",
        { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
      )
      expect(processor.canProcess(file)).toBe(false)
    })

    it("should reject image files", () => {
      const file = new File([new ArrayBuffer(10)], "image.png", { type: "image/png" })
      expect(processor.canProcess(file)).toBe(false)
    })

    it("should reject binary files", () => {
      const file = new File([new ArrayBuffer(10)], "app.exe", { type: "application/x-msdownload" })
      expect(processor.canProcess(file)).toBe(false)
    })

    it("should reject zip files", () => {
      const file = new File([new ArrayBuffer(10)], "archive.zip", { type: "application/zip" })
      expect(processor.canProcess(file)).toBe(false)
    })

    it("should accept CSV files", () => {
      const file = new File(["col1,col2"], "data.csv", { type: "text/csv" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should accept JSON files", () => {
      const file = new File(['{"key": "value"}'], "data.json", { type: "application/json" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should accept JavaScript files", () => {
      const file = new File(['console.log("test")'], "script.js", { type: "text/javascript" })
      expect(processor.canProcess(file)).toBe(true)
    })
  })

  describe("process", () => {
    it("should extract text from text file", async () => {
      const content = "This is a test file content"
      const file = new File([content], "test.txt", { type: "text/plain" })

      const result = await processor.process(file)

      expect(result.text).toBe(content)
      expect(result.metadata.fileName).toBe("test.txt")
      expect(result.metadata.fileType).toBe("text/plain")
      expect(result.metadata.fileSize).toBe(content.length)
      expect(result.metadata.processedAt).toBeGreaterThan(0)
    })

    it("should handle multiline text", async () => {
      const content = "Line 1\\nLine 2\\nLine 3"
      const file = new File([content], "test.txt", { type: "text/plain" })

      const result = await processor.process(file)

      expect(result.text).toBe(content)
      expect(result.text.split("\\n").length).toBe(3)
    })

    it("should handle UTF-8 content", async () => {
      const content = "Hello 世界 🌍"
      const file = new File([content], "test.txt", { type: "text/plain" })

      const result = await processor.process(file)

      expect(result.text).toBe(content)
    })

    it("should handle empty files", async () => {
      const file = new File([""], "empty.txt", { type: "text/plain" })

      const result = await processor.process(file)

      expect(result.text).toBe("")
      expect(result.metadata.fileSize).toBe(0)
    })

    it("should handle large text files", async () => {
      const content = "a".repeat(100000) // 100KB of text
      const file = new File([content], "large.txt", { type: "text/plain" })

      const result = await processor.process(file)

      expect(result.text).toBe(content)
      expect(result.metadata.fileSize).toBe(100000)
    })

    it("should fallback to text/plain for unknown types", async () => {
      const content = "test content"
      const file = new File([content], "test.unknown", { type: "" })

      const result = await processor.process(file)

      expect(result.text).toBe(content)
      expect(result.metadata.fileType).toBe("text/plain")
    })

    it("should preserve special characters", async () => {
      const content = "Special chars: <>&\"'\\n\\t"
      const file = new File([content], "special.txt", { type: "text/plain" })

      const result = await processor.process(file)

      expect(result.text).toBe(content)
    })

    it("should handle code files", async () => {
      const content = `function test() {
  return "hello";
}`
      const file = new File([content], "test.js", { type: "text/javascript" })

      const result = await processor.process(file)

      expect(result.text).toBe(content)
    })

    it("should throw error on processing failure", async () => {
      // Create a file that will fail to read
      const file = new File([], "test.txt", { type: "text/plain" })
      // Mock the text() method to throw error
      vi.spyOn(file, "text").mockRejectedValue(new Error("Read failed"))

      await expect(processor.process(file)).rejects.toThrow("Failed to process text file")
    })
  })
})
