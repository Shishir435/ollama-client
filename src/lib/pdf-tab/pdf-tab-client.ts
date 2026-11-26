import { abortableDelay } from "@/lib/abortable-delay"
import { browser } from "@/lib/browser-api"
import { classifyTabAccess } from "@/lib/browser-tab-access"
import { logger } from "@/lib/logger"
import { ensurePersistenceHost } from "@/lib/persistence/client"
import type { TabReadIssue } from "@/lib/tab-read-issue"
import {
  PDF_TAB_CANCEL_REQUEST,
  PDF_TAB_EXTRACT_REQUEST,
  type PdfTabExtractResponse,
  type PdfTabFailureCode
} from "./pdf-tab-protocol"
import { isFileUrl, pdfFileName } from "./pdf-tab-url"

/**
 * What reading a PDF tab produced. A failure carries two texts on purpose:
 * `message` is for the model that called a tool, `issue` is for the person,
 * who reads it in their own language through the locale catalog.
 */
export type PdfTabReadResult =
  | { ok: true; title: string; text: string }
  | { ok: false; issue: TabReadIssue; message: string }

/**
 * A cold host answers nothing (the offscreen document may not exist yet), and
 * that is readiness, not a failed read, so back off across a real startup
 * budget before giving up.
 */
const READY_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600, 3200]

/** A PDF does not change under an open tab; re-reading it every sweep is waste. */
const CACHE_TTL_MS = 5 * 60_000
const MAX_CACHED_PDFS = 4
const cache = new Map<string, { at: number; result: PdfTabReadResult }>()

const issueForCode = (code: PdfTabFailureCode): TabReadIssue => {
  switch (code) {
    case "no_text":
      return "pdf_no_text"
    case "password":
      return "pdf_password"
    case "timeout":
      return "pdf_timeout"
    case "corrupt":
    case "not_pdf":
      return "pdf_corrupt"
    case "too_large":
      return "pdf_too_large"
    default:
      return "pdf_unreachable"
  }
}

/**
 * The model-facing failure text. Each states that retrying the same tab will
 * not help, the one thing a model needs to stop looping on it.
 */
const modelMessage = (issue: TabReadIssue, label: string): string => {
  switch (issue) {
    case "pdf_file_access":
      return `Can't read the local PDF ${label} — the user has not allowed this extension to access file URLs. Do not retry; ask the user to turn on "Allow access to file URLs" in the browser's extension settings.`
    case "pdf_no_text":
      return `The PDF ${label} has no selectable text (it may be a scan) and OCR is not supported. Do not retry; tell the user its text cannot be read.`
    case "pdf_password":
      return `The PDF ${label} is password-protected and cannot be read. Do not retry; ask the user to remove the password.`
    case "pdf_timeout":
      return `The PDF ${label} took too long to open. Do not retry the same tab.`
    case "pdf_too_large":
      return `The PDF ${label} is too large to read. Do not retry the same tab.`
    case "pdf_corrupt":
      return `The PDF ${label} could not be read; it may be damaged. Do not retry the same tab.`
    default:
      return `The PDF ${label} could not be downloaded for reading. Do not retry the same tab.`
  }
}

const failure = (issue: TabReadIssue, label: string): PdfTabReadResult => ({
  ok: false,
  issue,
  message: modelMessage(issue, label)
})

/**
 * Chrome gates `file://` pages behind a per-extension switch. Where the
 * browser does not expose the switch the answer is unknown and the read is
 * attempted; a refused download then lands on the same message below.
 */
const fileAccessDenied = async (): Promise<boolean> => {
  try {
    const extension = browser.extension as unknown as
      | { isAllowedFileSchemeAccess?: () => Promise<boolean> }
      | undefined
    return (await extension?.isAllowedFileSchemeAccess?.()) === false
  } catch {
    return false
  }
}

const requestOnce = async (
  requestId: string,
  url: string
): Promise<PdfTabExtractResponse | undefined> => {
  try {
    return (await browser.runtime.sendMessage({
      type: PDF_TAB_EXTRACT_REQUEST,
      requestId,
      url
    })) as PdfTabExtractResponse | undefined
  } catch (error) {
    logger.verbose("PDF reader host not reachable yet", "PdfTabClient", {
      error
    })
    return undefined
  }
}

const cancelOnHost = (requestId: string): void => {
  void browser.runtime
    .sendMessage({ type: PDF_TAB_CANCEL_REQUEST, requestId })
    .catch(() => undefined)
}

const requestExtraction = async (
  url: string,
  signal?: AbortSignal
): Promise<PdfTabExtractResponse | undefined> => {
  const requestId = crypto.randomUUID()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      cancelOnHost(requestId)
      reject(signal?.reason)
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
  // The caller leaving must not wait on a host that may never answer.
  aborted.catch(() => undefined)
  const attempt = async (): Promise<PdfTabExtractResponse | undefined> => {
    for (let tries = 0; ; tries++) {
      signal?.throwIfAborted()
      await ensurePersistenceHost().catch((error: unknown) => {
        logger.warn("Failed to ensure PDF reader host", "PdfTabClient", {
          error
        })
      })
      signal?.throwIfAborted()
      const response = await requestOnce(requestId, url)
      if (response) return response
      if (tries >= READY_RETRY_DELAYS_MS.length) return undefined
      await abortableDelay(READY_RETRY_DELAYS_MS[tries] ?? 0, signal)
    }
  }
  try {
    signal?.throwIfAborted()
    return await (signal ? Promise.race([attempt(), aborted]) : attempt())
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort)
  }
}

const formatPdfText = (
  pages: Array<{ pageNumber: number; text: string }>,
  truncated: boolean,
  pageCount: number
): string => {
  // Page markers are the citation anchor: the model can say "page 4" and the
  // reader can check it, which a flat blob of text would not allow.
  const body = pages
    .map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`)
    .join("\n\n")
  return truncated
    ? `${body}\n\n(The document has ${pageCount} pages; only the first ${pages.length} with text are included.)`
    : body
}

/**
 * Reads the text of a tab that is showing a PDF. Honors the same access rules
 * as any tab read (tab access setting, excluded sites, never-read profiles),
 * because the content script that normally enforces them cannot run in the
 * viewer.
 */
export const readPdfTab = async (
  tab: { url: string; title?: string; incognito?: boolean },
  options: { signal?: AbortSignal; force?: boolean } = {}
): Promise<PdfTabReadResult> => {
  const { url } = tab
  const { signal } = options
  const title = tab.title?.trim() || pdfFileName(url)
  const label = `"${title}"`

  /** An incognito tab's file would be fetched with the regular profile's cookies. */
  if (tab.incognito || (await classifyTabAccess(url)) !== "ok") {
    return failure("restricted", label)
  }

  const cached = cache.get(url)
  /**
   * Only successes and permanent failures are held. A forced read (a refresh,
   * manual or automatic) re-reads a success, but a document that could not be
   * read stays unreadable, so it is not downloaded again.
   */
  if (
    cached &&
    Date.now() - cached.at < CACHE_TTL_MS &&
    (!options.force || !cached.result.ok)
  ) {
    return cached.result
  }
  /** A forced read that then fails must not leave the old text to be served. */
  if (options.force) cache.delete(url)

  if (isFileUrl(url) && (await fileAccessDenied())) {
    return failure("pdf_file_access", label)
  }

  const response = await requestExtraction(url, signal)
  if (!response) return failure("pdf_unreachable", label)
  if (!response.ok) {
    const issue =
      isFileUrl(url) && response.code === "unreachable"
        ? "pdf_file_access"
        : issueForCode(response.code)
    const refused = failure(issue, label)
    // A document that has no text or is locked stays that way, so asking
    // again every refresh only downloads it again. A slow or unreachable one
    // may well work next time.
    if (PERMANENT_ISSUES.has(issue)) remember(url, refused)
    return refused
  }

  const result: PdfTabReadResult = {
    ok: true,
    title,
    text: formatPdfText(response.pages, response.truncated, response.pageCount)
  }
  remember(url, result)
  return result
}

/** Failures that re-reading the same document cannot change. */
export const PERMANENT_ISSUES: ReadonlySet<TabReadIssue> = new Set([
  "pdf_no_text",
  "pdf_password",
  "pdf_corrupt",
  "pdf_too_large"
])

const remember = (url: string, result: PdfTabReadResult): void => {
  cache.delete(url)
  cache.set(url, { at: Date.now(), result })
  while (cache.size > MAX_CACHED_PDFS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Drops every held read. */
export const clearPdfTabCache = (): void => cache.clear()
