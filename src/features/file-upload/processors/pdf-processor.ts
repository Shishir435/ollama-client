import * as pdfjsLib from "pdfjs-dist"
import type {
  PDFDocumentProxy,
  TextItem
} from "pdfjs-dist/types/src/display/api"
import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"

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

      // Try loading PDF with worker first; if worker fails (CSP/packaging), fallback to disableWorker
      let pdf: PDFDocumentProxy

      try {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        // Race the loading task against a timeout to avoid hanging indefinitely
        pdf = await promiseTimeout(loadingTask.promise, 10000)
      } catch (_firstErr) {
        // First attempt failed or timed out; retry without worker
        logger.warn(
          "PDF worker load failed or timed out, retrying without worker",
          "PdfProcessor"
        )
        const loadingTask2 = pdfjsLib.getDocument({ data: arrayBuffer })
        pdf = await promiseTimeout(loadingTask2.promise, 15000)
      }

      const numPages = pdf.numPages

      const textParts: string[] = []

      // Extract text from each page
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()
        const pageText = textContent.items
          .map((item) => {
            if ("str" in item) {
              return (item as TextItem).str
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

// Helper: promise with timeout
function promiseTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(`Operation timed out after ${ms}ms`))
      }
    }, ms)

    p.then((v) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(v)
      }
    }).catch((err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })
  })
}
