import type { PdfFailureCode } from "@/lib/file-processors/pdf-failure"

/** Asks the file-processor host to download and read a PDF tab's document. */
export const PDF_TAB_EXTRACT_REQUEST = "pdf-tab-extract-request"

/** Tells the host to stop a read; nothing is answered. */
export const PDF_TAB_CANCEL_REQUEST = "pdf-tab-cancel-request"

/** Why a PDF tab could not be read: the parser's reasons plus the download's. */
export type PdfTabFailureCode =
  | PdfFailureCode
  | "too_large"
  | "unreachable"
  | "not_pdf"

export type PdfTabExtractResponse =
  | {
      ok: true
      pages: Array<{ pageNumber: number; text: string }>
      pageCount: number
      /** The text was cut to the context ceiling; later pages are not here. */
      truncated: boolean
    }
  | { ok: false; code: PdfTabFailureCode }
  /** The address redirected; nothing past it was read. */
  | { ok: false; code: "redirected"; url: string }
