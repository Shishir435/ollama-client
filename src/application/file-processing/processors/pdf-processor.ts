import { PDF_LOAD_TIMEOUT_MS } from "@/lib/constants"
import { createAppError, getErrorMessage } from "@/lib/error-utils"
import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"

/** Define necessary types from pdfjs-dist */
type PDFDocumentProxy =
  import("pdfjs-dist/types/src/display/api").PDFDocumentProxy
type PDFDocumentLoadingTask =
  import("pdfjs-dist/types/src/display/api").PDFDocumentLoadingTask
type TextItem = import("pdfjs-dist/types/src/display/api").TextItem

const EMPTY_PDF_TEXT = "(No text content found in PDF)"

/**
 * The flat text of a PDF, rebuilt from its pages.
 *
 * Pages are the stored form: they carry the page number chunk citations need,
 * and this text is only their concatenation, so keeping both doubled every
 * PDF's bytes in the durable payload.
 */
export const pdfTextFromPages = (
  pages: ReadonlyArray<{ pageNumber: number; text: string }>
): string =>
  pages
    .map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`)
    .join("\n\n") || EMPTY_PDF_TEXT

export class PdfProcessor implements FileProcessor {
  canProcess(file: File): boolean {
    const extension = this.getFileExtension(file.name).toLowerCase()
    return extension === ".pdf" || file.type === "application/pdf"
  }

  async process(file: File, signal?: AbortSignal): Promise<ProcessedFile> {
    let loadingTask: PDFDocumentLoadingTask | undefined
    let pdf: PDFDocumentProxy | undefined

    try {
      signal?.throwIfAborted()
      // Lazy load pdfjs-dist
      const pdfjsLib = await import("pdfjs-dist")

      // pdf.js spawns the worker itself from workerSrc below; the URL
      // reference is what makes the bundler emit the worker asset. Do NOT also
      // `import()` the worker module — that only forces a redundant ~1.3 MB
      // duplicate chunk of the same file into the bundle.
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString()

      const arrayBuffer = await file.arrayBuffer()

      // PDF.js falls back to its fake-worker implementation when constructing
      // the configured worker fails. A second getDocument call would only
      // repeat the same request and leave the first loading task alive.
      loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
      pdf = await promiseTimeout(loadingTask.promise, PDF_LOAD_TIMEOUT_MS)

      const numPages = pdf.numPages

      const pages: Array<{ pageNumber: number; text: string }> = []

      // Extract text from each page
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        signal?.throwIfAborted()
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
          pages.push({ pageNumber: pageNum, text: pageText })
        }
      }
      signal?.throwIfAborted()

      return {
        text: pdfTextFromPages(pages),
        pages,
        metadata: {
          fileName: file.name,
          fileType: file.type || "application/pdf",
          fileSize: file.size,
          pageCount: numPages,
          processedAt: Date.now()
        }
      }
    } catch (error) {
      // A caller that left is not a PDF that failed.
      if (signal?.aborted) throw error
      const errorMessage = getErrorMessage(error, "Unknown error")
      throw createAppError(`Failed to process PDF: ${errorMessage}`, {
        kind: "validation",
        cause: error
      })
    } finally {
      try {
        if (pdf) {
          await pdf.destroy()
        } else if (loadingTask) {
          await loadingTask.destroy()
        }
      } catch (error) {
        logger.warn("Failed to release PDF resources", "PdfProcessor", {
          error
        })
      }
    }
  }

  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".")
    return lastDot !== -1 ? fileName.slice(lastDot) : ""
  }
}

/** Helper: promise with timeout */
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
