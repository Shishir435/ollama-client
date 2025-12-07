import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"
import { CsvLoader } from "@/lib/loaders/csv-loader"

/**
 * CSV File Processor
 * Handles CSV and TSV files with custom delimiter support
 */
export class CsvProcessor implements FileProcessor {
  canProcess(file: File): boolean {
    const extension = this.getFileExtension(file.name).toLowerCase()

    // Check file extension
    if ([".csv", ".tsv", ".psv"].includes(extension)) {
      return true
    }

    // Check MIME type
    if (file.type === "text/csv" || file.type === "text/tab-separated-values") {
      return true
    }

    return false
  }

  async process(file: File): Promise<ProcessedFile> {
    try {
      // Convert file to data URL
      const dataUrl = await this.fileToDataUrl(file)

      // Detect separator from extension
      const separator = this.detectSeparator(file.name, file.type)

      // Create CSV loader
      const loader = new CsvLoader({
        url: dataUrl,
        name: file.name,
        options: {
          separator
        }
      })

      // Load and parse CSV
      const docs = await loader.load()

      // Combine all documents into single text
      const text = docs.map((doc) => doc.pageContent).join("\n\n---\n\n")

      return {
        text,
        metadata: {
          fileName: file.name,
          fileType: file.type || "text/csv",
          fileSize: file.size,
          processedAt: Date.now(),
          pageCount: docs.length
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error"
      throw new Error(`Failed to process CSV file: ${errorMessage}`)
    }
  }

  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".")
    return lastDot !== -1 ? fileName.slice(lastDot) : ""
  }

  private detectSeparator(fileName: string, mimeType: string): string {
    const extension = this.getFileExtension(fileName).toLowerCase()

    if (extension === ".tsv" || mimeType === "text/tab-separated-values") {
      return "\t"
    }

    if (extension === ".psv") {
      return "|"
    }

    // Default to comma
    return ","
  }

  private async fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}
