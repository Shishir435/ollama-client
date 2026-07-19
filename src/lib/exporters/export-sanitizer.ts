import DOMPurify from "dompurify"

/**
 * Shared sanitization config for HTML that leaves the app as an export (the
 * print/PDF pipeline). Kept free of markdown/highlighting imports so the
 * print entrypoint can re-sanitize without bundling the whole parser.
 */

export const EXPORT_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "strike",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "div",
  "span",
  "mark",
  "sub",
  "sup",
  "del",
  "ins"
]

export const EXPORT_ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "id",
  "checked",
  "type",
  // Inline `style` is allowed so exported images can carry their own size clamp
  // directly on the element. DOMPurify still sanitizes the CSS (drops url(),
  // expression(), etc.) and the print page's CSP blocks remote resources, so a
  // crafted style cannot fetch anything. Relying on the element's own style
  // avoids depending on the injected <style> block matching a selector.
  "style"
]

/**
 * URI schemes allowed in exported HTML. Everything else (javascript:, chrome:,
 * filesystem:, …) is dropped by DOMPurify. `data:`/`blob:` stay so inline
 * image attachments survive; remote http(s) images are separately gated by
 * `stripRemoteImages` below.
 */
export const EXPORT_ALLOWED_URI_REGEXP = /^(?:https?|mailto|data|blob):/i

/** Escape a string for interpolation into an HTML template (titles, headers). */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const isRemoteUrl = (src: string): boolean => /^https?:/i.test(src.trim())

/**
 * Replace every remote (http/https) `<img>` in an HTML fragment with an inert
 * placeholder. Remote images in an export are a network side effect — printing
 * a chat should not announce itself to third-party servers — so they are
 * blocked unless the user opted in (Settings → Privacy).
 */
export const stripRemoteImages = (
  html: string,
  blockedLabel?: string
): string => {
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html"
  )
  for (const img of Array.from(doc.body.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? ""
    if (!isRemoteUrl(src)) continue
    const placeholder = doc.createElement("span")
    placeholder.className = "blocked-remote-image"
    let host = ""
    try {
      host = new URL(src).host
    } catch {
      // keep the placeholder hostless
    }
    const label = blockedLabel ?? img.getAttribute("alt") ?? ""
    placeholder.textContent = host ? `[${label}: ${host}]` : `[${label}]`
    img.replaceWith(placeholder)
  }
  return doc.body.innerHTML
}

export interface ExportSanitizeOptions {
  /** Allow remote http(s) images through (user opt-in). Default: blocked. */
  allowRemoteImages?: boolean
  /** Translated label used in the placeholder for a blocked remote image. */
  blockedImageLabel?: string
}

/**
 * Sanitize the COMPLETE assembled print/export fragment. The print page reads
 * this fragment out of localStorage — writable by any extension page — so it
 * re-sanitizes on its side too; both ends share this one config. `<style>` is
 * allowed because the export carries its own stylesheet; when remote images
 * are blocked, the print page's CSP meta also covers CSS `url()` loads.
 */
export const sanitizeExportFragment = (
  html: string,
  options?: ExportSanitizeOptions
): string => {
  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...EXPORT_ALLOWED_TAGS, "style", "hr"],
    ALLOWED_ATTR: EXPORT_ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: EXPORT_ALLOWED_URI_REGEXP
  })
  return options?.allowRemoteImages
    ? safe
    : stripRemoteImages(safe, options?.blockedImageLabel)
}
