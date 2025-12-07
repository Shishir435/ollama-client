import { describe, it, expect } from "vitest"
import { CsvLoader } from "../csv-loader"

describe("CsvLoader", () => {
  describe("load", () => {
    it("should parse simple CSV data", async () => {
      const csvData = `name,age,city
John,30,NY
Jane,25,SF`

      const dataUrl = `data:text/csv;base64,${btoa(csvData)}`

      const loader = new CsvLoader({
        url: dataUrl,
        name: "test.csv"
      })

      const docs = await loader.load()

      expect(docs).toHaveLength(2)
      expect(docs[0].pageContent).toContain("name: John")
      expect(docs[0].pageContent).toContain("age: 30")
      expect(docs[0].pageContent).toContain("city: NY")
      expect(docs[0].metadata.source).toBe("test.csv")
      expect(docs[0].metadata.type).toBe("csv")
      expect(docs[0].metadata.line).toBe(1)
    })

    it("should handle custom separators", async () => {
      const tsvData = `name\tage\tcity
John\t30\tNY
Jane\t25\tSF`

      const dataUrl = `data:text/plain;base64,${btoa(tsvData)}`

      const loader = new CsvLoader({
        url: dataUrl,
        name: "test.tsv",
        options: {
          separator: "\t"
        }
      })

      const docs = await loader.load()

      expect(docs).toHaveLength(2)
      expect(docs[0].pageContent).toContain("name: John")
    })

    it("should extract specific column", async () => {
      const csvData = `name,age,city
John,30,NY
Jane,25,SF`

      const dataUrl = `data:text/csv;base64,${btoa(csvData)}`

      const loader = new CsvLoader({
        url: dataUrl,
        name: "test.csv",
        options: {
          column: "name"
        }
      })

      const docs = await loader.load()

      expect(docs).toHaveLength(2)
      expect(docs[0].pageContent).toBe("John")
      expect(docs[1].pageContent).toBe("Jane")
    })

    it("should throw error for non-existent column", async () => {
      const csvData = `name,age,city
John,30,NY`

      const dataUrl = `data:text/csv;base64,${btoa(csvData)}`

      const loader = new CsvLoader({
        url: dataUrl,
        name: "test.csv",
        options: {
          column: "nonexistent"
        }
      })

      await expect(loader.load()).rejects.toThrow(/Column.*not found/)
    })

    it("should handle empty CSV", async () => {
      const csvData = ``

      const dataUrl = `data:text/csv;base64,${btoa(csvData)}`

      const loader = new CsvLoader({
        url: dataUrl,
        name: "test.csv"
      })

      await expect(loader.load()).rejects.toThrow(/empty or invalid/)
    })
  })
})
