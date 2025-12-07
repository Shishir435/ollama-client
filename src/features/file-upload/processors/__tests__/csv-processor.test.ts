import { describe, it, expect, vi, beforeEach } from "vitest"
import { CsvProcessor } from "../csv-processor"

// Mock CsvLoader
const mockLoad = vi.fn()

vi.mock("@/lib/loaders/csv-loader", () => ({
  CsvLoader: class {
    constructor(public options: any) {}
    load = mockLoad
  }
}))

describe("CsvProcessor", () => {
  let processor: CsvProcessor

  beforeEach(() => {
    processor = new CsvProcessor()
    vi.clearAllMocks()
  })

  describe("canProcess", () => {
    it("should accept .csv files by extension", () => {
      const file = new File(["data"], "test.csv", { type: "" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should accept .tsv files by extension", () => {
      const file = new File(["data"], "test.tsv", { type: "" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should accept .psv files by extension", () => {
      const file = new File(["data"], "test.psv", { type: "" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should accept CSV files by MIME type", () => {
      const file = new File(["data"], "data.csv", { type: "text/csv" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should accept TSV files by MIME type", () => {
      const file = new File(["data"], "data.tsv", {
        type: "text/tab-separated-values"
      })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should reject non-CSV files", () => {
      const file = new File(["data"], "test.txt", { type: "text/plain" })
      expect(processor.canProcess(file)).toBe(false)
    })

    it("should reject PDF files", () => {
      const file = new File(["data"], "test.pdf", { type: "application/pdf" })
      expect(processor.canProcess(file)).toBe(false)
    })

    it("should handle files with uppercase extensions", () => {
      const file = new File(["data"], "test.CSV", { type: "" })
      expect(processor.canProcess(file)).toBe(true)
    })

    it("should handle files with no extension but CSV MIME type", () => {
      const file = new File(["data"], "data", { type: "text/csv" })
      expect(processor.canProcess(file)).toBe(true)
    })
  })

  describe("process", () => {
    it("should process valid CSV file", async () => {
      const csvContent = "header1,header2,header3\nvalue1,value2,value3"
      const file = new File([csvContent], "test.csv", { type: "text/csv" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "header1: value1\nheader2: value2\nheader3: value3",
          metadata: { source: "test.csv", type: "csv", line: 1 }
        }
      ])

      const result = await processor.process(file)

      expect(result.text).toBe(
        "header1: value1\nheader2: value2\nheader3: value3"
      )
      expect(result.metadata.fileName).toBe("test.csv")
      expect(result.metadata.fileType).toBe("text/csv")
      expect(result.metadata.fileSize).toBe(csvContent.length)
      expect(result.metadata.pageCount).toBe(1)
      expect(result.metadata.processedAt).toBeGreaterThan(0)
    })

    it("should process CSV with multiple rows", async () => {
      const csvContent =
        "name,age,city\nJohn,30,NY\nJane,25,SF\nBob,35,LA"
      const file = new File([csvContent], "data.csv", { type: "text/csv" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "name: John\nage: 30\ncity: NY",
          metadata: { source: "data.csv", type: "csv", line: 1 }
        },
        {
          pageContent: "name: Jane\nage: 25\ncity: SF",
          metadata: { source: "data.csv", type: "csv", line: 2 }
        },
        {
          pageContent: "name: Bob\nage: 35\ncity: LA",
          metadata: { source: "data.csv", type: "csv", line: 3 }
        }
      ])

      const result = await processor.process(file)

      expect(result.text).toContain("name: John")
      expect(result.text).toContain("name: Jane")
      expect(result.text).toContain("name: Bob")
      expect(result.text).toContain("---") // Row separator
      expect(result.metadata.pageCount).toBe(3)
    })

    it("should process TSV file with tab separator", async () => {
      const tsvContent = "header1\theader2\theader3\nvalue1\tvalue2\tvalue3"
      const file = new File([tsvContent], "test.tsv", {
        type: "text/tab-separated-values"
      })

      mockLoad.mockResolvedValue([
        {
          pageContent: "header1: value1\nheader2: value2\nheader3: value3",
          metadata: { source: "test.tsv", type: "csv", line: 1 }
        }
      ])

      const result = await processor.process(file)

      expect(result.text).toBe(
        "header1: value1\nheader2: value2\nheader3: value3"
      )
      expect(result.metadata.fileName).toBe("test.tsv")
    })

    it("should process PSV file with pipe separator", async () => {
      const psvContent = "header1|header2|header3\nvalue1|value2|value3"
      const file = new File([psvContent], "test.psv", { type: "" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "header1: value1\nheader2: value2\nheader3: value3",
          metadata: { source: "test.psv", type: "csv", line: 1 }
        }
      ])

      const result = await processor.process(file)

      expect(result.text).toBe(
        "header1: value1\nheader2: value2\nheader3: value3"
      )
    })

    it("should fallback to text/csv for unknown MIME types", async () => {
      const csvContent = "a,b,c\n1,2,3"
      const file = new File([csvContent], "test.csv", { type: "" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "a: 1\nb: 2\nc: 3",
          metadata: { source: "test.csv", type: "csv" }
        }
      ])

      const result = await processor.process(file)

      expect(result.metadata.fileType).toBe("text/csv")
    })

    it("should handle empty CSV gracefully", async () => {
      const file = new File([""], "empty.csv", { type: "text/csv" })

      mockLoad.mockRejectedValue(new Error("CSV file is empty or invalid"))

      await expect(processor.process(file)).rejects.toThrow(
        "Failed to process CSV file"
      )
    })

    it("should handle CSV parsing errors", async () => {
      const file = new File(["invalid"], "bad.csv", { type: "text/csv" })

      mockLoad.mockRejectedValue(new Error("Parse error"))

      await expect(processor.process(file)).rejects.toThrow(
        "Failed to process CSV file: Parse error"
      )
    })

    it("should handle large CSV files", async () => {
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        pageContent: `row: ${i}`,
        metadata: { source: "large.csv", type: "csv", line: i + 1 }
      }))

      const file = new File(["large data"], "large.csv", { type: "text/csv" })

      mockLoad.mockResolvedValue(rows)

      const result = await processor.process(file)

      expect(result.metadata.pageCount).toBe(1000)
      expect(result.text).toContain("row: 0")
      expect(result.text).toContain("row: 999")
    })

    it("should handle special characters in CSV", async () => {
      const csvContent = 'name,description\nTest,"Quote ""test"""\nSpecial,<>&'
      const file = new File([csvContent], "special.csv", { type: "text/csv" })

      mockLoad.mockResolvedValue([
        {
          pageContent: 'name: Test\ndescription: Quote "test"',
          metadata: { source: "special.csv", type: "csv", line: 1 }
        },
        {
          pageContent: "name: Special\ndescription: <>&",
          metadata: { source: "special.csv", type: "csv", line: 2 }
        }
      ])

      const result = await processor.process(file)

      expect(result.text).toContain("Quote")
      expect(result.text).toContain("<>&")
    })

    it("should handle UTF-8 content in CSV", async () => {
      const csvContent = "name,city\nJohn,東京\nJané,São Paulo"
      const file = new File([csvContent], "utf8.csv", { type: "text/csv" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "name: John\ncity: 東京",
          metadata: { source: "utf8.csv", type: "csv", line: 1 }
        },
        {
          pageContent: "name: Jané\ncity: São Paulo",
          metadata: { source: "utf8.csv", type: "csv", line: 2 }
        }
      ])

      const result = await processor.process(file)

      expect(result.text).toContain("東京")
      expect(result.text).toContain("São Paulo")
    })

    it("should preserve metadata from CsvLoader", async () => {
      const file = new File(["data"], "test.csv", { type: "text/csv" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "content",
          metadata: {
            source: "test.csv",
            type: "csv",
            line: 1,
            customField: "value"
          }
        }
      ])

      const result = await processor.process(file)

      // Processor adds its own metadata
      expect(result.metadata.fileName).toBe("test.csv")
      expect(result.metadata.pageCount).toBe(1)
    })

    it("should handle single row CSV", async () => {
      const csvContent = "header1,header2\nvalue1,value2"
      const file = new File([csvContent], "single.csv", { type: "text/csv" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "header1: value1\nheader2: value2",
          metadata: { source: "single.csv", type: "csv" }
        }
      ])

      const result = await processor.process(file)

      expect(result.metadata.pageCount).toBe(1)
      expect(result.text).not.toContain("---") // No separator for single row
    })

    it("should detect separator from file extension", async () => {
      const file = new File(["data"], "test.tsv", { type: "" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "data",
          metadata: { source: "test.tsv", type: "csv" }
        }
      ])

      await processor.process(file)

      // Check that CsvLoader was called with correct separator
      expect(mockLoad).toHaveBeenCalled()
      const loaderInstance = (mockLoad as any).mock.instances[0]
      expect(loaderInstance.options.options.separator).toBe("\t")
    })

    it("should use comma as default separator for .csv files", async () => {
      const file = new File(["data"], "test.csv", { type: "text/csv" })

      mockLoad.mockResolvedValue([
        {
          pageContent: "data",
          metadata: { source: "test.csv", type: "csv" }
        }
      ])

      await processor.process(file)

      const loaderInstance = (mockLoad as any).mock.instances[0]
      expect(loaderInstance.options.options.separator).toBe(",")
    })
  })
})
