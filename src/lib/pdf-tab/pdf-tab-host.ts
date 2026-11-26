import { PdfProcessor } from "@/application/file-processing/processors/pdf-processor"
import { FILE_UPLOAD, PDF_LOAD_TIMEOUT_MS } from "@/lib/constants"
import {
  classifyPdfJsError,
  PdfFailureError
} from "@/lib/file-processors/pdf-failure"
import { isTrustedPersistenceSender } from "@/lib/persistence/host-authorization"
import {
  PDF_TAB_CANCEL_REQUEST,
  PDF_TAB_EXTRACT_REQUEST,
  type PdfTabExtractResponse,
  type PdfTabFailureCode
} from "./pdf-tab-protocol"
import { pdfFileName } from "./pdf-tab-url"

/** Downloading and reading are one budget, so a stalled server cannot hold a read open. */
const PDF_TAB_BUDGET_MS = PDF_LOAD_TIMEOUT_MS * 4

/**
 * Where a tab's text is cut. A PDF can be hundreds of pages and the chat
 * context is bounded far below this; the ceiling only keeps one document from
 * becoming an unbounded message, and matches the tab-content cache's.
 */
const MAX_PDF_TAB_CHARS = 1_000_000

const isReadableAddress = (url: string): boolean => /^(https?|file):/i.test(url)

/** The body, read only as far as the size ceiling allows. */
const readCapped = async (
  response: Response,
  signal: AbortSignal
): Promise<Uint8Array | "too_large"> => {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > FILE_UPLOAD.MAX_SIZE) {
    void response.body?.cancel().catch(() => undefined)
    return "too_large"
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength > FILE_UPLOAD.MAX_SIZE ? "too_large" : bytes
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    signal.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > FILE_UPLOAD.MAX_SIZE) {
      void reader.cancel().catch(() => undefined)
      return "too_large"
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const looksLikePdf = (bytes: Uint8Array): boolean =>
  // The header may follow a few bytes of junk, which pdf.js tolerates too.
  new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")

/**
 * Downloads a PDF the user has open and reads its text with the same processor
 * that reads uploaded files. Runs in an extension page: the content script
 * cannot see inside the browser's PDF viewer, and a service worker cannot run
 * pdf.js, so the page-level host is the one context that can do both.
 */
export const extractPdfFromUrl = async (
  url: string,
  signal?: AbortSignal
): Promise<PdfTabExtractResponse> => {
  if (!isReadableAddress(url)) return { ok: false, code: "unreachable" }
  const budget = AbortSignal.timeout(PDF_TAB_BUDGET_MS)
  const combined = signal ? AbortSignal.any([signal, budget]) : budget

  try {
    const response = await fetch(url, {
      signal: combined,
      credentials: "include",
      redirect: "follow"
    })
    /**
     * The caller checked only the address it sent. A redirect elsewhere goes
     * back to it, so an excluded destination is never read.
     */
    if (response.redirected && response.url !== url) {
      void response.body?.cancel().catch(() => undefined)
      return { ok: false, code: "redirected", url: response.url }
    }
    if (!response.ok) return { ok: false, code: "unreachable" }
    const body = await readCapped(response, combined)
    if (body === "too_large") return { ok: false, code: "too_large" }
    if (!looksLikePdf(body)) return { ok: false, code: "not_pdf" }

    const file = new File([body as BlobPart], pdfFileName(url), {
      type: "application/pdf"
    })
    const processed = await new PdfProcessor().process(file, combined)
    const pages: Array<{ pageNumber: number; text: string }> = []
    let chars = 0
    let truncated = false
    for (const page of processed.pages ?? []) {
      const room = MAX_PDF_TAB_CHARS - chars
      if (page.text.length > room) {
        /** Keep what fits, so one huge first page still yields text. */
        if (room > 0) pages.push({ ...page, text: page.text.slice(0, room) })
        truncated = true
        break
      }
      pages.push(page)
      chars += page.text.length
    }
    return {
      ok: true,
      pages,
      pageCount: processed.metadata.pageCount ?? pages.length,
      truncated
    }
  } catch (error) {
    /** A caller that left is not a PDF that failed. */
    if (signal?.aborted) throw error
    if (budget.aborted) return { ok: false, code: "timeout" }
    if (error instanceof PdfFailureError) {
      return { ok: false, code: error.code }
    }
    const name = (error as { name?: unknown } | null)?.name
    // fetch rejects with a TypeError for a blocked or unreachable address, and
    // pdf.js rejections carry their own names; anything else is the download.
    const code: PdfTabFailureCode =
      error instanceof TypeError || name === "AbortError"
        ? "unreachable"
        : classifyPdfJsError(error)
    return { ok: false, code }
  }
}

let registered = false

/** Parses in flight per request id, so a cancel reaches the read it names. */
const inFlight = new Map<string, AbortController>()

export const registerPdfTabHost = (): void => {
  if (registered) return
  registered = true
  const extensionUrlPrefix = chrome.runtime.getURL("")
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const request = message as
      | { type?: string; requestId?: unknown; url?: unknown }
      | undefined
    if (
      request?.type !== PDF_TAB_EXTRACT_REQUEST &&
      request?.type !== PDF_TAB_CANCEL_REQUEST
    ) {
      return false
    }
    if (
      typeof request.requestId !== "string" ||
      !isTrustedPersistenceSender(sender, chrome.runtime.id, extensionUrlPrefix)
    ) {
      return false
    }
    const { requestId } = request
    if (request.type === PDF_TAB_CANCEL_REQUEST) {
      inFlight.get(requestId)?.abort()
      return false
    }
    if (typeof request.url !== "string") return false

    const controller = new AbortController()
    inFlight.set(requestId, controller)
    void extractPdfFromUrl(request.url, controller.signal)
      .catch(() => ({ ok: false, code: "unreachable" }) as const)
      .then((result) => sendResponse(result))
      .finally(() => {
        if (inFlight.get(requestId) === controller) inFlight.delete(requestId)
      })
    return true
  })
}
