import {
  type AgentElement,
  type AgentObservation,
  AgentObservationSchema
} from "@ollama-client/contracts"

import type { AgentElementReferenceStore } from "./element-references"

export const AGENT_OBSERVATION_LIMITS = {
  elements: 2_000,
  visibleTextChars: 100_000,
  titleChars: 500,
  elementNameChars: 500,
  elementValueChars: 500,
  elementHrefChars: 2_048
} as const

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[role]",
  "[contenteditable='true']"
].join(",")

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : value.slice(0, limit)

const normalizedText = (value: string): string =>
  value.replaceAll(/\s+/g, " ").trim()

interface VisibleBounds {
  bottom: number
  left: number
  right: number
  top: number
}

const intersectBounds = (
  first: VisibleBounds,
  second: VisibleBounds
): VisibleBounds | undefined => {
  const intersection = {
    bottom: Math.min(first.bottom, second.bottom),
    left: Math.max(first.left, second.left),
    right: Math.min(first.right, second.right),
    top: Math.max(first.top, second.top)
  }
  return intersection.right > intersection.left &&
    intersection.bottom > intersection.top
    ? intersection
    : undefined
}

const clipsOverflow = (value: string): boolean =>
  ["auto", "clip", "hidden", "overlay", "scroll"].includes(value)

const isSemanticallyHidden = (element: Element): boolean =>
  element.hasAttribute("hidden") ||
  element.hasAttribute("inert") ||
  element.getAttribute("aria-hidden") === "true"

const isHiddenByStyle = (style: CSSStyleDeclaration): boolean =>
  style.display === "none" ||
  style.visibility === "hidden" ||
  style.visibility === "collapse" ||
  style.contentVisibility === "hidden" ||
  style.opacity === "0"

const isActiveClipValue = (
  value: string | null | undefined,
  defaults: readonly string[]
): boolean => Boolean(value && !defaults.includes(value))

const hasConservativeClip = (
  element: Element,
  style: CSSStyleDeclaration
): boolean => {
  const declared = (element as HTMLElement).style
  return (
    [style.clip, declared.clip].some((value) =>
      isActiveClipValue(value, ["auto", "none"])
    ) ||
    [style.clipPath, declared.clipPath].some((value) =>
      isActiveClipValue(value, ["none"])
    ) ||
    [
      style.maskImage,
      style.getPropertyValue("mask-image"),
      declared.maskImage,
      declared.getPropertyValue("mask-image")
    ].some((value) => isActiveClipValue(value, ["none"]))
  )
}

const clipBoundsByAncestor = (
  bounds: VisibleBounds[],
  ancestor: Element,
  style: CSSStyleDeclaration
): VisibleBounds[] => {
  const containPaint = style.contain
    .split(/\s+/)
    .some((value) => value === "paint" || value === "strict")
  const declared = (ancestor as HTMLElement).style
  const clipX =
    containPaint ||
    [
      style.overflow,
      style.overflowX,
      declared.overflow,
      declared.overflowX
    ].some(clipsOverflow)
  const clipY =
    containPaint ||
    [
      style.overflow,
      style.overflowY,
      declared.overflow,
      declared.overflowY
    ].some(clipsOverflow)
  if (!clipX && !clipY) return bounds

  const clippingRects = Array.from(ancestor.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  )
  return bounds.flatMap((visible) =>
    clippingRects
      .map((rect) =>
        intersectBounds(visible, {
          bottom: clipY ? rect.bottom : visible.bottom,
          left: clipX ? rect.left : visible.left,
          right: clipX ? rect.right : visible.right,
          top: clipY ? rect.top : visible.top
        })
      )
      .filter((rect): rect is VisibleBounds => Boolean(rect))
  )
}

const composedParent = (element: Element): Element | null => {
  const root = element.getRootNode()
  return (
    element.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  )
}

const isVisible = (element: Element): boolean => {
  if (
    element instanceof HTMLInputElement &&
    element.type.toLowerCase() === "hidden"
  ) {
    return false
  }

  const view = element.ownerDocument.defaultView
  const viewport = {
    bottom: view?.innerHeight ?? 0,
    left: 0,
    right: view?.innerWidth ?? 0,
    top: 0
  }
  let visibleBounds = Array.from(element.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => intersectBounds(rect, viewport))
    .filter((rect): rect is VisibleBounds => Boolean(rect))
  if (visibleBounds.length === 0) return false

  for (
    let current: Element | null = element;
    current;
    current = composedParent(current)
  ) {
    if (isSemanticallyHidden(current)) return false
    const style = view?.getComputedStyle(current)
    if (!style) return false
    if (isHiddenByStyle(style) || hasConservativeClip(current, style)) {
      return false
    }
    if (current !== element && style) {
      visibleBounds = clipBoundsByAncestor(visibleBounds, current, style)
      if (visibleBounds.length === 0) return false
    }
  }
  return true
}

export const isSensitiveAgentElement = (element: Element): boolean => {
  const input = element as HTMLInputElement
  const type = input.type?.toLowerCase()
  if (["password", "file"].includes(type)) return true
  const evidence = [
    element.getAttribute("autocomplete"),
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("aria-label")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return /(?:one-time|otp|verification|passcode|password|card|cc-|cvv|cvc|captcha)/.test(
    evidence
  )
}

const elementValue = (element: Element): string | undefined => {
  if (!("value" in element)) return undefined
  const value = String((element as HTMLInputElement).value ?? "")
  return value || undefined
}

const collectVisibleText = (root: Element, limit: number): string => {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let result = ""
  for (
    let node = walker.nextNode();
    node && result.length < limit;
    node = walker.nextNode()
  ) {
    const parent = node.parentElement
    if (!parent || !isVisible(parent)) continue
    const text = normalizedText(node.textContent ?? "")
    if (!text) continue
    const addition = `${result ? " " : ""}${text}`
    result += truncate(addition, limit - result.length)
  }
  return result
}

const accessibleName = (element: Element): string | undefined => {
  const labelled = element.getAttribute("aria-label")
  if (labelled) return labelled
  const text = collectVisibleText(
    element,
    AGENT_OBSERVATION_LIMITS.elementNameChars
  )
  if (text) return text
  const placeholder = element.getAttribute("placeholder")
  if (placeholder) return placeholder
  return undefined
}

/**
 * Observed destinations exist so navigation can be grounded in a link the page
 * actually rendered rather than a URL the model composed. Anything the user
 * cannot see contributes none: a hidden link is page content the observation
 * boundary already withholds, and `javascript:`/`data:` targets are refused
 * here so they never become a destination the run has to reason about.
 */
const elementHref = (element: Element): string | undefined => {
  const href = element.getAttribute("href")
  if (!href) return undefined
  try {
    const resolved = new URL(href, element.ownerDocument.location.href)
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return undefined
    }
    return resolved.href.length <= AGENT_OBSERVATION_LIMITS.elementHrefChars
      ? resolved.href
      : undefined
  } catch {
    return undefined
  }
}

const toAgentElement = (element: Element, ref: string): AgentElement => {
  const visible = isVisible(element)
  const sensitive = !visible || isSensitiveAgentElement(element)
  const name = visible ? accessibleName(element) : undefined
  const value = sensitive ? undefined : elementValue(element)
  const href = visible ? elementHref(element) : undefined
  const control = element as HTMLInputElement
  return {
    ref,
    frameId: 0,
    role: element.getAttribute("role") || undefined,
    ...(name
      ? { name: truncate(name, AGENT_OBSERVATION_LIMITS.elementNameChars) }
      : {}),
    tag: element.tagName.toLowerCase(),
    type: control.type || undefined,
    ...(value
      ? {
          value: truncate(value, AGENT_OBSERVATION_LIMITS.elementValueChars)
        }
      : {}),
    ...(href ? { href } : {}),
    ...(href && element.hasAttribute("download") ? { download: true } : {}),
    visible,
    enabled: !(control.disabled ?? false),
    editable:
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      (element as HTMLElement).isContentEditable,
    sensitive
  }
}

export const buildAgentObservation = (input: {
  document: Document
  tabId: number
  documentId: string
  frameId?: number
  minimumGeneration: number
  references: AgentElementReferenceStore
  capturedAt?: number
  createSnapshotId?: () => string
}): AgentObservation => {
  if ((input.frameId ?? 0) !== 0 || input.document.defaultView?.frameElement) {
    throw new Error("Agent observations are main-frame only")
  }
  const url = new URL(input.document.location.href)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Agent observations require an HTTP(S) document")
  }
  const snapshot = input.references.beginSnapshot({
    minimumGeneration: input.minimumGeneration,
    createSnapshotId:
      input.createSnapshotId ?? (() => globalThis.crypto.randomUUID())
  })
  const candidates = Array.from(
    input.document.querySelectorAll(INTERACTIVE_SELECTOR)
  ).slice(0, AGENT_OBSERVATION_LIMITS.elements)
  const elements = candidates.map((element) =>
    toAgentElement(element, snapshot.reference(element))
  )
  const visibleText = input.document.body
    ? collectVisibleText(
        input.document.body,
        AGENT_OBSERVATION_LIMITS.visibleTextChars
      )
    : ""
  const view = input.document.defaultView
  const root = input.document.documentElement

  return AgentObservationSchema.parse({
    snapshotId: snapshot.snapshotId,
    generation: snapshot.generation,
    tabId: input.tabId,
    documentId: input.documentId,
    url: url.href,
    origin: url.origin,
    title: truncate(input.document.title, AGENT_OBSERVATION_LIMITS.titleChars),
    elements,
    visibleText,
    scroll: {
      x: view?.scrollX ?? 0,
      y: view?.scrollY ?? 0,
      viewportWidth: view?.innerWidth ?? root.clientWidth,
      viewportHeight: view?.innerHeight ?? root.clientHeight,
      documentWidth: Math.max(root.scrollWidth, root.clientWidth),
      documentHeight: Math.max(root.scrollHeight, root.clientHeight)
    },
    dialogs: [],
    capturedAt: input.capturedAt ?? Date.now()
  })
}
