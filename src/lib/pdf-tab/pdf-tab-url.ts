/**
 * Whether a tab address names a PDF the browser's own viewer is showing.
 *
 * Both Chromium and Firefox keep the original address on `tab.url` while their
 * built-in viewer renders the document, so the address is the only signal that
 * costs nothing. A PDF served without a `.pdf` path is caught later, when the
 * content script reports the document's content type.
 */
export const isPdfTabUrl = (url?: string): boolean => {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (!/^(https?|file|ftp):$/i.test(parsed.protocol)) return false
    return /\.pdf$/i.test(decodeURIComponent(parsed.pathname))
  } catch {
    return false
  }
}

/** A `file://` address, which the browser gates behind its own user switch. */
export const isFileUrl = (url?: string): boolean => !!url && /^file:/i.test(url)

/** The file name an address ends in, for a title when the tab has none. */
export const pdfFileName = (url: string): string => {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop()
    return last ? decodeURIComponent(last) : "document.pdf"
  } catch {
    return "document.pdf"
  }
}
