import * as pdfjsLib from "pdfjs-dist"
import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"

import "pdfjs-dist/build/pdf.worker.min.mjs"

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

export class PdfProcessor implements FileProcessor {
  canProcess(file: File): boolean {
    const extension = this.getFileExtension(file.name).toLowerCase()
    return extension === ".pdf" || file.type === "application/pdf"
  }

  async process(file: File): Promise<ProcessedFile> {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
      const pdf = await loadingTask.promise
      const numPages = pdf.numPages

      const textParts: string[] = []

      // Extract text from each page
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()
        const pageText = textContent.items
          .map((item) => {
            if ("str" in item) {
              return item.str
            }
            return ""
          })
          .join(" ")

        if (pageText.trim()) {
          textParts.push(`--- Page ${pageNum} ---\n${pageText}`)
        }
      }

      const fullText =
        textParts.join("\n\n") || "(No text content found in PDF)"

      return {
        text: fullText,
        metadata: {
          fileName: file.name,
          fileType: file.type || "application/pdf",
          fileSize: file.size,
          pageCount: numPages,
          processedAt: Date.now()
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error"
      throw new Error(`Failed to process PDF: ${errorMessage}`)
    }
  }

  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".")
    return lastDot !== -1 ? fileName.slice(lastDot) : ""
  }
}
