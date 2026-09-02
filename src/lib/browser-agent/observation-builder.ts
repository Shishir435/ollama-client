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
  elementValueChars: 500
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

const isVisible = (element: Element): boolean => {
  if (element.hasAttribute("hidden")) return false
  if (element.getAttribute("aria-hidden") === "true") return false
  const style = (element as HTMLElement).style
  return style?.display !== "none" && style?.visibility !== "hidden"
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

const accessibleName = (element: Element): string | undefined => {
  const labelled = element.getAttribute("aria-label")
  if (labelled) return labelled
  const text = normalizedText(element.textContent ?? "")
  if (text) return text
  const placeholder = element.getAttribute("placeholder")
  if (placeholder) return placeholder
  return undefined
}

const elementValue = (element: Element): string | undefined => {
  if (!("value" in element)) return undefined
  const value = String((element as HTMLInputElement).value ?? "")
  return value || undefined
}

const toAgentElement = (element: Element, ref: string): AgentElement => {
  const sensitive = isSensitiveAgentElement(element)
  const name = accessibleName(element)
  const value = sensitive ? undefined : elementValue(element)
  const control = element as HTMLInputElement
  return {
    ref,
    frameId: 0,
    role: element.getAttribute("role") || undefined,
    name: name
      ? truncate(name, AGENT_OBSERVATION_LIMITS.elementNameChars)
      : undefined,
    tag: element.tagName.toLowerCase(),
    type: control.type || undefined,
    ...(value
      ? {
          value: truncate(value, AGENT_OBSERVATION_LIMITS.elementValueChars)
        }
      : {}),
    visible: isVisible(element),
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
  const body = input.document.body
  const visibleText = normalizedText(
    body ? (body.innerText ?? body.textContent ?? "") : ""
  )
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
    visibleText: truncate(
      visibleText,
      AGENT_OBSERVATION_LIMITS.visibleTextChars
    ),
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
