/**
 * Accessibility Tree generator for the browser agent.
 * Inspired by Claude for Chrome's approach: produces a text-based tree of the
 * page using ARIA roles and semantic HTML, with stable ref_ids via WeakRef.
 *
 * This replaces the flat "interactive elements list" with a hierarchical,
 * human-readable tree that gives the LLM much richer context about the page.
 */

// WeakRef is available in all modern browsers but may not be in TS lib
// biome-ignore lint/suspicious/noShadowRestrictedNames: Missing in TS lib
declare class WeakRef<T extends object> {
  constructor(target: T)
  deref(): T | undefined
}

// ─── Global Element Map (stable across scans) ────────────────────────────────

interface ElementMapEntry {
  ref: WeakRef<Element>
  role: string
  label: string
}

// Use window-scoped globals so they survive HMR and re-imports
declare global {
  interface Window {
    __agentElementMap?: Record<string, ElementMapEntry>
    __agentRefCounter?: number
  }
}

if (!window.__agentElementMap) {
  window.__agentElementMap = {}
}
if (!window.__agentRefCounter) {
  window.__agentRefCounter = 0
}

// ─── Role Detection ──────────────────────────────────────────────────────────

const TAG_ROLE_MAP: Record<string, string> = {
  a: "link",
  button: "button",
  select: "combobox",
  textarea: "textbox",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "image",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  section: "region",
  article: "article",
  aside: "complementary",
  form: "form",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
  label: "label",
  video: "video",
  audio: "audio",
  iframe: "iframe",
  dialog: "dialog",
  details: "group",
  summary: "button"
}

function getRole(el: Element): string {
  const explicit = el.getAttribute("role")
  if (explicit) return explicit

  const tag = el.tagName.toLowerCase()
  const type = el.getAttribute("type")

  if (tag === "input") {
    if (type === "submit" || type === "button") return "button"
    if (type === "checkbox") return "checkbox"
    if (type === "radio") return "radio"
    if (type === "file") return "button"
    return "textbox"
  }

  return TAG_ROLE_MAP[tag] || "generic"
}

// ─── Label Extraction ────────────────────────────────────────────────────────

function getLabel(el: Element): string {
  const tag = el.tagName.toLowerCase()

  // Select: show selected option
  if (tag === "select") {
    const select = el as HTMLSelectElement
    const selected =
      select.querySelector("option[selected]") ||
      select.options[select.selectedIndex]
    if (selected?.textContent) return selected.textContent.trim()
  }

  // ARIA label
  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel?.trim()) return ariaLabel.trim()

  // Placeholder
  const placeholder = el.getAttribute("placeholder")
  if (placeholder?.trim()) return placeholder.trim()

  // Title
  const title = el.getAttribute("title")
  if (title?.trim()) return title.trim()

  // Alt
  const alt = el.getAttribute("alt")
  if (alt?.trim()) return alt.trim()

  // Label[for]
  if (el.id) {
    const labelEl = document.querySelector(`label[for="${el.id}"]`)
    if (labelEl?.textContent?.trim()) return labelEl.textContent.trim()
  }

  // Input value
  if (tag === "input") {
    const input = el as HTMLInputElement
    const type = el.getAttribute("type") || ""
    if (type === "submit" && input.value?.trim()) return input.value.trim()
    if (input.value && input.value.length < 50 && input.value.trim())
      return input.value.trim()
  }

  // Button / link / summary: direct text children
  if (["button", "a", "summary"].includes(tag)) {
    let text = ""
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent
    }
    if (text.trim()) return text.trim()
  }

  // Headings: full text
  if (/^h[1-6]$/.test(tag)) {
    const text = el.textContent
    if (text?.trim()) return text.trim().substring(0, 100)
  }

  // Image: no label fallback
  if (tag === "img") return ""

  // Generic: first direct text content
  let directText = ""
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) directText += child.textContent
  }
  if (directText?.trim() && directText.trim().length >= 3) {
    const trimmed = directText.trim()
    return trimmed.length > 100 ? trimmed.substring(0, 100) + "..." : trimmed
  }

  return ""
}

// ─── Visibility & Relevance ─────────────────────────────────────────────────

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el)
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    (el as HTMLElement).offsetWidth > 0 &&
    (el as HTMLElement).offsetHeight > 0
  )
}

function isInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  )
}

function isInteractive(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  return (
    [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "details",
      "summary"
    ].includes(tag) ||
    el.getAttribute("onclick") !== null ||
    el.getAttribute("tabindex") !== null ||
    el.getAttribute("role") === "button" ||
    el.getAttribute("role") === "link" ||
    el.getAttribute("contenteditable") === "true"
  )
}

function isLandmark(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  return (
    [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "nav",
      "main",
      "header",
      "footer",
      "section",
      "article",
      "aside"
    ].includes(tag) || el.getAttribute("role") !== null
  )
}

function shouldInclude(el: Element, filter: "all" | "interactive"): boolean {
  const tag = el.tagName.toLowerCase()
  if (
    [
      "script",
      "style",
      "meta",
      "link",
      "title",
      "noscript",
      "svg",
      "path"
    ].includes(tag)
  )
    return false
  if (el.getAttribute("aria-hidden") === "true") return false
  if (!isVisible(el)) return false
  if (!isInViewport(el)) return false

  if (filter === "interactive") return isInteractive(el)

  // For "all" mode: include interactive, landmark, or labeled elements
  if (isInteractive(el)) return true
  if (isLandmark(el)) return true
  if (getLabel(el).length > 0) return true

  const role = getRole(el)
  return role !== "generic" && role !== "image"
}

// ─── Ref ID Management ──────────────────────────────────────────────────────

function getOrCreateRefId(el: Element): string {
  const map = window.__agentElementMap!

  // Check if element already has a ref
  for (const refId in map) {
    if (map[refId].ref.deref() === el) return refId
  }

  // Create new ref
  const refId = `ref_${++window.__agentRefCounter!}`
  map[refId] = {
    ref: new WeakRef(el),
    role: getRole(el),
    label: getLabel(el)
  }

  // Also set data attribute for backwards compat with click_element
  ;(el as HTMLElement).dataset.agentId = refId

  return refId
}

export function getRefIdForElement(el: Element): string {
  return getOrCreateRefId(el)
}

/** Look up an element by its ref_id */
export function findElementByRefId(refId: string): Element | null {
  const entry = window.__agentElementMap?.[refId]
  if (!entry) return null
  return entry.ref.deref() || null
}

// ─── Tree Generation ─────────────────────────────────────────────────────────

export interface AccessibilityTreeOptions {
  filter?: "all" | "interactive"
  maxDepth?: number
  maxChars?: number
  refId?: string // Focus on a specific element subtree
}

export interface AccessibilityTreeResult {
  pageContent: string
  viewport: { width: number; height: number }
  error?: string
  elementCount: number
}

export function generateAccessibilityTree(
  options: AccessibilityTreeOptions = {}
): AccessibilityTreeResult {
  const { filter = "all", maxDepth = 12, maxChars = 15000, refId } = options

  const lines: string[] = []
  let elementCount = 0

  function walk(el: Element, depth: number): void {
    if (depth > maxDepth) return
    if (!el || !el.tagName) return

    const include =
      shouldInclude(el, filter) || (refId !== undefined && depth === 0)

    if (include) {
      const role = getRole(el)
      const label = getLabel(el)
      const id = getOrCreateRefId(el)

      // Build the line: indentation + role + label + [ref_id] + attributes
      let line = "  ".repeat(depth) + role
      if (label) {
        const cleanLabel = label
          .replace(/\s+/g, " ")
          .substring(0, 100)
          .replace(/"/g, '\\"')
        line += ` "${cleanLabel}"`
      }
      line += ` [${id}]`

      // Useful attributes
      const href = el.getAttribute("href")
      if (href) line += ` href="${href}"`

      const type = el.getAttribute("type")
      if (type) line += ` type="${type}"`

      const disabled = (el as HTMLButtonElement).disabled
      if (disabled) line += " (disabled)"

      const checked = (el as HTMLInputElement).checked
      if (checked) line += " (checked)"

      // Video status
      if (el.tagName.toLowerCase() === "video") {
        const video = el as HTMLVideoElement
        line += video.paused
          ? ` (paused at ${Math.round(video.currentTime)}s)`
          : ` (playing ${Math.round(video.currentTime)}/${Math.round(video.duration || 0)}s)`
      }

      lines.push(line)
      elementCount++

      // Select options
      if (el.tagName.toLowerCase() === "select") {
        const select = el as HTMLSelectElement
        for (const opt of Array.from(select.options)) {
          let optLine = "  ".repeat(depth + 1) + "option"
          const optText = opt.textContent?.trim() || ""
          if (optText) optLine += ` "${optText.substring(0, 100)}"`
          if (opt.selected) optLine += " (selected)"
          lines.push(optLine)
        }
      }
    }

    // Recurse into children
    if (el.children && depth < maxDepth) {
      for (const child of Array.from(el.children)) {
        walk(child, include ? depth + 1 : depth)
      }
    }
  }

  try {
    if (refId) {
      const entry = window.__agentElementMap?.[refId]
      if (!entry) {
        return {
          error: `Element with ref_id '${refId}' not found.`,
          pageContent: "",
          viewport: { width: window.innerWidth, height: window.innerHeight },
          elementCount: 0
        }
      }
      const el = entry.ref.deref()
      if (!el) {
        return {
          error: `Element with ref_id '${refId}' no longer exists.`,
          pageContent: "",
          viewport: { width: window.innerWidth, height: window.innerHeight },
          elementCount: 0
        }
      }
      walk(el, 0)
    } else if (document.body) {
      walk(document.body, 0)
    }

    // Cleanup stale weak refs
    const map = window.__agentElementMap!
    for (const key in map) {
      if (!map[key].ref.deref()) delete map[key]
    }

    const content = lines.join("\n")

    if (maxChars && content.length > maxChars) {
      return {
        error: `Output exceeds ${maxChars} character limit (${content.length} chars). Try filter: "interactive" to reduce output.`,
        pageContent: "",
        viewport: { width: window.innerWidth, height: window.innerHeight },
        elementCount
      }
    }

    return {
      pageContent: content,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      elementCount
    }
  } catch (err) {
    return {
      error: `Error generating accessibility tree: ${err instanceof Error ? err.message : String(err)}`,
      pageContent: "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      elementCount: 0
    }
  }
}
