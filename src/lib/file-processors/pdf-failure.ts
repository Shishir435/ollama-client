/**
 * Why a PDF could not be turned into text.
 *
 * The code travels inside the failure message, the way the storage-full code
 * does: ingestion records only a string, and the layers between the parser and
 * the screen must recognise the reason without parsing prose so the screen can
 * say it in the user's language.
 */
export type PdfFailureCode = "no_text" | "password" | "timeout" | "corrupt"

const PDF_FAILURE_PREFIX = "pdf_failure"

export class PdfFailureError extends Error {
  readonly code: PdfFailureCode

  constructor(code: PdfFailureCode, detail?: string) {
    super(
      detail
        ? `${PDF_FAILURE_PREFIX}:${code} ${detail}`
        : `${PDF_FAILURE_PREFIX}:${code}`
    )
    this.name = "PdfFailureError"
    this.code = code
  }
}

/** Raised when pdf.js neither opens nor rejects a document within its budget. */
export class PdfLoadTimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`)
    this.name = "PdfLoadTimeoutError"
  }
}

/** The reason a failure message names, or undefined if it is not a PDF failure. */
export const pdfFailureCode = (message: string): PdfFailureCode | undefined => {
  const match = new RegExp(
    `(?:^|\\b)${PDF_FAILURE_PREFIX}:(no_text|password|timeout|corrupt)\\b`
  ).exec(message)
  return match ? (match[1] as PdfFailureCode) : undefined
}

/**
 * Maps whatever pdf.js threw to a failure code. pdf.js names its exceptions
 * (`PasswordException`, `InvalidPDFException`, ...) but does not export them
 * as stable classes, so the name is the contract; an unrecognised failure is
 * reported as an unreadable file, which is the honest summary of "it did not
 * open and nothing says why".
 */
export const classifyPdfJsError = (error: unknown): PdfFailureCode => {
  if (error instanceof PdfFailureError) return error.code
  if (error instanceof PdfLoadTimeoutError) return "timeout"
  const name = (error as { name?: unknown } | null)?.name
  return name === "PasswordException" ? "password" : "corrupt"
}
