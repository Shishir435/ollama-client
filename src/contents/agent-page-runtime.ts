import type {
  AgentPageActionRequest,
  PageElementRef,
  PageSnapshot
} from "@/types/agent"

const MAX_ELEMENTS = 150
const documentId =
  globalThis.crypto?.randomUUID?.() ??
  `document-${Date.now()}-${Math.random().toString(36).slice(2)}`

interface CachedElement {
  element: HTMLElement
  signature: string
}

let currentSnapshotId = ""
let elementCache = new Map<number, CachedElement>()
let highlight: HTMLDivElement | undefined

const normalized = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim()

const textFromIds = (element: Element, ids: string): string =>
  ids
    .split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent)
    .map(normalized)
    .filter(Boolean)
    .join(" ")

const accessibleName = (element: HTMLElement): string => {
  const labelledBy = element.getAttribute("aria-labelledby")
  if (labelledBy) {
    const value = textFromIds(element, labelledBy)
    if (value) return value
  }
  const aria = normalized(element.getAttribute("aria-label"))
  if (aria) return aria
  if (element instanceof HTMLImageElement && normalized(element.alt)) {
    return normalized(element.alt)
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    if (element.id) {
      const label = element.ownerDocument.querySelector(
        `label[for="${CSS.escape(element.id)}"]`
      )
      if (normalized(label?.textContent)) return normalized(label?.textContent)
    }
    const wrappingLabel = element.closest("label")
    if (normalized(wrappingLabel?.textContent)) {
      return normalized(wrappingLabel?.textContent)
    }
    if (normalized(element.getAttribute("placeholder"))) {
      return normalized(element.getAttribute("placeholder"))
    }
  }
  return (
    normalized(element.textContent).slice(0, 160) ||
    normalized(element.getAttribute("title")) ||
    normalized(element.getAttribute("name")) ||
    element.tagName.toLowerCase()
  )
}

const roleFor = (element: HTMLElement): string => {
  const explicit = normalized(element.getAttribute("role"))
  if (explicit) return explicit
  if (element instanceof HTMLButtonElement) return "button"
  if (element instanceof HTMLAnchorElement) return "link"
  if (element instanceof HTMLSelectElement) return "combobox"
  if (element instanceof HTMLTextAreaElement) return "textbox"
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox"
    if (element.type === "radio") return "radio"
    if (element.type === "submit" || element.type === "button") return "button"
    return "textbox"
  }
  return element.tagName.toLowerCase()
}

const isVisible = (element: HTMLElement): boolean => {
  const style = getComputedStyle(element)
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    (style.opacity !== "" && Number(style.opacity) === 0)
  ) {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

const isInteractive = (element: HTMLElement): boolean => {
  if (
    element.matches(
      "a[href],button,input,textarea,select,summary,[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='switch'],[role='tab'],[role='menuitem'],[contenteditable='true'],[tabindex]"
    )
  ) {
    const tabIndex = element.getAttribute("tabindex")
    return (
      tabIndex !== "-1" ||
      element.matches("input,textarea,select,button,a[href]")
    )
  }
  return false
}

const domPathFor = (element: HTMLElement): string => {
  const parts: string[] = []
  let current: HTMLElement | null = element
  while (current && parts.length < 8) {
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (sibling) => sibling.tagName === current?.tagName
        )
      : []
    parts.unshift(
      `${current.tagName.toLowerCase()}:${Math.max(0, siblings.indexOf(current))}`
    )
    current = current.parentElement
  }
  return parts.join("/")
}

const signatureFor = (element: HTMLElement): string => {
  const form = element.closest("form")
  const type = element.getAttribute("type") ?? ""
  const mutableValue =
    element instanceof HTMLInputElement &&
    !["password", "file", "hidden"].includes(element.type)
      ? element.value
      : element instanceof HTMLTextAreaElement
        ? element.value
        : element instanceof HTMLSelectElement
          ? `${element.value}|${Array.from(element.options)
              .map(
                (option) => `${option.value}:${normalized(option.textContent)}`
              )
              .join(",")}`
          : ""
  const dataset = Object.entries(element.dataset)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&")
  const rowContext = normalized(
    element.closest("tr,li,[role='row']")?.textContent ??
      element.parentElement?.textContent
  ).slice(0, 240)

  return JSON.stringify({
    tag: element.tagName,
    role: roleFor(element),
    name: accessibleName(element),
    type,
    href: element.getAttribute("href") ?? "",
    target: element.getAttribute("target") ?? "",
    id: element.id,
    nameAttribute: element.getAttribute("name") ?? "",
    testId: element.getAttribute("data-testid") ?? "",
    dataset,
    ariaControls: element.getAttribute("aria-controls") ?? "",
    ariaDescribedBy: element.getAttribute("aria-describedby") ?? "",
    formAction: form?.getAttribute("action") ?? "",
    formMethod: form?.getAttribute("method") ?? "",
    mutableValue,
    domPath: domPathFor(element),
    rowContext
  })
}

const collectRoots = (
  root: Document | ShadowRoot,
  roots: Array<Document | ShadowRoot>
) => {
  roots.push(root)
  for (const element of root.querySelectorAll("*")) {
    if (element instanceof HTMLElement && element.shadowRoot) {
      collectRoots(element.shadowRoot, roots)
    }
  }
}

const collectDocuments = (): {
  documents: Array<{ document: Document; framePath: number[] }>
  unsupported: number
} => {
  const documents = [{ document, framePath: [] as number[] }]
  let unsupported = 0
  const visit = (current: Document, path: number[]) => {
    const frames = Array.from(current.querySelectorAll("iframe"))
    frames.forEach((frame, index) => {
      try {
        const child = frame.contentDocument
        if (!child) {
          unsupported++
          return
        }
        const framePath = [...path, index]
        documents.push({ document: child, framePath })
        visit(child, framePath)
      } catch {
        unsupported++
      }
    })
  }
  visit(document, [])
  return { documents, unsupported }
}

export const snapshotPage = (): PageSnapshot => {
  clearAgentHighlight()
  currentSnapshotId =
    globalThis.crypto?.randomUUID?.() ??
    `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`
  elementCache = new Map()
  const candidates: Array<{ element: HTMLElement; framePath: number[] }> = []
  const { documents, unsupported } = collectDocuments()

  for (const entry of documents) {
    const roots: Array<Document | ShadowRoot> = []
    collectRoots(entry.document, roots)
    for (const root of roots) {
      for (const node of root.querySelectorAll("*")) {
        if (
          node instanceof HTMLElement &&
          isInteractive(node) &&
          isVisible(node)
        ) {
          candidates.push({ element: node, framePath: entry.framePath })
        }
      }
    }
  }

  candidates.sort((a, b) => {
    const ar = a.element.getBoundingClientRect()
    const br = b.element.getBoundingClientRect()
    const av = ar.bottom >= 0 && ar.top <= innerHeight
    const bv = br.bottom >= 0 && br.top <= innerHeight
    if (av !== bv) return av ? -1 : 1
    return ar.top - br.top || ar.left - br.left
  })

  const elements: PageElementRef[] = candidates
    .slice(0, MAX_ELEMENTS)
    .map(({ element, framePath }, index) => {
      const elementId = index + 1
      const rect = element.getBoundingClientRect()
      const disabled =
        element.matches(":disabled") ||
        element.getAttribute("aria-disabled") === "true"
      const ref: PageElementRef = {
        elementId,
        role: roleFor(element),
        name: accessibleName(element),
        tag: element.tagName.toLowerCase(),
        type: element instanceof HTMLInputElement ? element.type : undefined,
        value:
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? normalized(element.value).slice(0, 120)
            : undefined,
        disabled,
        checked:
          element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio")
            ? element.checked
            : undefined,
        inViewport: rect.bottom >= 0 && rect.top <= innerHeight,
        framePath: framePath.length ? framePath : undefined
      }
      elementCache.set(elementId, {
        element,
        signature: signatureFor(element)
      })
      return ref
    })

  return {
    snapshotId: currentSnapshotId,
    documentId,
    url: location.href,
    title: document.title,
    capturedAt: Date.now(),
    elements,
    truncated: Math.max(0, candidates.length - elements.length),
    unsupportedCrossOriginFrames: unsupported
  }
}

const resolveTarget = (snapshotId: string, elementId: number): HTMLElement => {
  if (!snapshotId || snapshotId !== currentSnapshotId) {
    throw new Error("Page changed; take a new snapshot before acting.")
  }
  const cached = elementCache.get(elementId)
  if (!cached) {
    throw new Error("Target changed or disappeared; take a new snapshot.")
  }
  if (
    !cached.element.isConnected ||
    signatureFor(cached.element) !== cached.signature
  ) {
    throw new Error("Target changed or disappeared; take a new snapshot.")
  }
  if (!isVisible(cached.element))
    throw new Error("Target is no longer visible.")
  if (
    cached.element.matches(":disabled") ||
    cached.element.getAttribute("aria-disabled") === "true"
  ) {
    throw new Error("Target is disabled.")
  }
  return cached.element
}

export const clearAgentHighlight = (): void => {
  highlight?.remove()
  highlight = undefined
}

export const highlightAgentTarget = (
  snapshotId: string,
  elementId: number
): { name: string; role: string; url: string } => {
  const element = resolveTarget(snapshotId, elementId)
  clearAgentHighlight()
  element.scrollIntoView({ block: "center", inline: "center" })
  const rect = element.getBoundingClientRect()
  highlight = document.createElement("div")
  highlight.dataset.ollamaClientAgentHighlight = "true"
  Object.assign(highlight.style, {
    position: "fixed",
    pointerEvents: "none",
    zIndex: "2147483647",
    left: `${Math.max(0, rect.left - 4)}px`,
    top: `${Math.max(0, rect.top - 4)}px`,
    width: `${rect.width + 8}px`,
    height: `${rect.height + 8}px`,
    border: "3px solid #8b5cf6",
    borderRadius: "6px",
    boxShadow: "0 0 0 3px rgb(139 92 246 / 25%)"
  })
  document.documentElement.append(highlight)
  return {
    name: accessibleName(element),
    role: roleFor(element),
    url: location.href
  }
}

export const executeAgentAction = (
  request: AgentPageActionRequest
): { message: string; url: string } => {
  const element = resolveTarget(request.snapshotId, request.elementId)
  const failRestricted = (): never => {
    throw new Error("This control type is not supported for agent actions.")
  }

  if (request.action === "click") {
    if (
      element instanceof HTMLInputElement &&
      ["password", "file", "hidden"].includes(element.type)
    ) {
      failRestricted()
    }
    element.click()
  } else if (request.action === "type") {
    if (
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) ||
      (element instanceof HTMLInputElement &&
        ["password", "file", "hidden"].includes(element.type)) ||
      element.isContentEditable
    ) {
      failRestricted()
    }
    const text = request.text
    if (typeof text !== "string") throw new Error("Typing requires text.")
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    setter?.call(element, text)
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: text })
    )
    element.dispatchEvent(new Event("change", { bubbles: true }))
  } else {
    if (!(element instanceof HTMLSelectElement)) return failRestricted()
    const value = request.value
    const option = Array.from(element.options).find(
      (candidate) =>
        candidate.value === value || normalized(candidate.textContent) === value
    )
    if (!option) throw new Error("Requested option does not exist.")
    element.value = option.value
    element.dispatchEvent(new Event("input", { bubbles: true }))
    element.dispatchEvent(new Event("change", { bubbles: true }))
  }
  clearAgentHighlight()
  return { message: `${request.action} completed.`, url: location.href }
}

export const scrollAgentPage = (direction: unknown): string => {
  const amount = Math.max(240, Math.round(innerHeight * 0.8))
  const delta = direction === "up" ? -amount : amount
  scrollBy({ top: delta, behavior: "smooth" })
  return `Scrolled ${direction === "up" ? "up" : "down"}.`
}

export const findAgentText = (query: unknown): string => {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Search text is required.")
  }
  const needle = query.trim().toLocaleLowerCase()
  const { documents } = collectDocuments()
  for (const entry of documents) {
    if (!entry.document.body) continue
    const walker = entry.document.createTreeWalker(
      entry.document.body,
      NodeFilter.SHOW_TEXT
    )
    let node = walker.nextNode()
    while (node) {
      if (normalized(node.textContent).toLocaleLowerCase().includes(needle)) {
        const parent = node.parentElement
        if (parent && isVisible(parent)) {
          parent.scrollIntoView({ block: "center", behavior: "smooth" })
          return `Found “${query.trim()}” on the page.`
        }
      }
      node = walker.nextNode()
    }
  }
  return `Text “${query.trim()}” was not found on the page.`
}
