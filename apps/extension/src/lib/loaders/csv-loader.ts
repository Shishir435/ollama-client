import { dsvFormat } from "d3-dsv"
import { logger } from "@/lib/logger"
import type { CsvLoaderOptions, DocumentLoader, LoaderDocument } from "./types"

/**
 * CSV Document Loader
 * Parses CSV files with custom delimiters and column extraction
 */
export class CsvLoader implements DocumentLoader {
  private url: string
  private name: string
  private column?: string
  private separator: string

  constructor({ url, name, options = {} }: CsvLoaderOptions) {
    this.url = url
    this.name = name
    this.column = options.column
    this.separator = options.separator || ","
  }

  /**
   * Parse CSV text into an array of formatted strings
   */
  private async parse(raw: string): Promise<string[]> {
    // Create parser with custom separator
    const psv = dsvFormat(this.separator)

    // Parse all rows
    const parsed = psv.parseRows(raw.trim())

    if (parsed.length === 0) {
      throw new Error("CSV file is empty or invalid")
    }

    // Extract specific column if requested
    if (this.column !== undefined) {
      const headers = parsed[0]
      if (!headers || !headers.includes(this.column)) {
        throw new Error(
          `Column "${this.column}" not found in CSV. Available columns: ${headers?.join(", ")}`
        )
      }

      const columnIndex = headers.indexOf(this.column)
      // Skip header row, return only column values
      return parsed.slice(1).map((row) => row[columnIndex] || "")
    }

    // Extract headers and data rows
    const headers = parsed[0]
    const dataRows = parsed.slice(1)

    // Format each row as "header: value" pairs
    return dataRows.map((row) =>
      row.map((value, index) => `${headers[index]}: ${value}`).join("\n")
    )
  }

  /**
   * Load CSV and convert to documents
   */
  async load(): Promise<LoaderDocument[]> {
    try {
      // Fetch CSV file
      const res = await fetch(this.url)

      if (!res.ok) {
        throw new Error(
          `Failed to fetch CSV file: ${res.status} ${res.statusText}`
        )
      }

      const raw = await res.text()

      // Parse CSV
      const parsed = await this.parse(raw)

      // Base metadata
      const metadata = { source: this.name, type: "csv" }

      // Validate parsed data
      for (let i = 0; i < parsed.length; i++) {
        if (typeof parsed[i] !== "string") {
          throw new Error(
            `Expected string at row ${i}, got ${typeof parsed[i]}`
          )
        }
      }

      // Convert to documents
      // If only one result, don't add line numbers
      if (parsed.length === 1) {
        return [
          {
            pageContent: parsed[0],
            metadata
          }
        ]
      }

      // Multiple results: add line numbers
      return parsed.map((pageContent, i) => ({
        pageContent,
        metadata: {
          ...metadata,
          line: i + 1
        }
      }))
    } catch (error) {
      logger.error("CSV loading error", "CsvLoader", { error })
      throw error
    }
  }
}
