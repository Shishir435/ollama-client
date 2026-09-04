import type {
  AgentDestination,
  AgentSemanticEffect,
  ResolvedAgentEffect,
  ResolvedAgentTarget
} from "@ollama-client/agent-runtime"
import type {
  AgentCommand,
  AgentElement,
  AgentObservation
} from "@ollama-client/contracts"

import type { TabAccess } from "@/lib/browser-tab-access"

export const READ_ONLY_AGENT_ACTIONS = [
  "read",
  "wait",
  "scroll",
  "switch_tab",
  "back",
  "forward"
] as const

export type ReadOnlyAgentAction = (typeof READ_ONLY_AGENT_ACTIONS)[number]

export interface AgentEffectResolverAdapter {
  getTab(tabId: number): Promise<{ id?: number; url?: string } | undefined>
  classifyAccess(url?: string): Promise<TabAccess>
  resolveHistoryDestination(
    tabId: number,
    direction: "back" | "forward"
  ): Promise<string | undefined>
}

const isReadOnlyAction = (type: string): type is ReadOnlyAgentAction =>
  (READ_ONLY_AGENT_ACTIONS as readonly string[]).includes(type)

const destination = (url: string): AgentDestination => {
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Agent destination is not HTTP(S)")
  }
  return { url: parsed.href, origin: parsed.origin, source: "browser" }
}

const targetFromObservation = (
  command: AgentCommand,
  observation: AgentObservation
): ResolvedAgentTarget => {
  if (command.type !== "scroll" || !command.ref) {
    return { sensitive: false, maySubmit: false }
  }
  const element = observation.elements.find(
    (candidate) => candidate.ref === command.ref && candidate.frameId === 0
  )
  if (!element) throw new Error("Agent scroll target is stale")
  return {
    ref: element.ref,
    tag: element.tag,
    role: element.role,
    accessibleName: element.name,
    inputType: element.type,
    sensitive: element.sensitive,
    maySubmit: false
  }
}

/**
 * Shared grounding for every resolver: the command must name the observation
 * in hand, and that observation's page must still be one the run may read.
 */
const assertLiveObservation = async (
  command: AgentCommand,
  observation: AgentObservation,
  adapter: AgentEffectResolverAdapter
): Promise<AgentDestination> => {
  if (
    command.snapshotId !== observation.snapshotId ||
    command.generation !== observation.generation
  ) {
    throw new Error("Agent command references a stale observation")
  }
  const source = destination(observation.url)
  if (
    source.origin !== observation.origin ||
    (await adapter.classifyAccess(source.url)) !== "ok"
  ) {
    throw new Error("Agent observation is no longer readable")
  }
  return source
}

export const resolveReadOnlyAgentEffect = async (input: {
  command: AgentCommand
  observation: AgentObservation
  adapter: AgentEffectResolverAdapter
}): Promise<ResolvedAgentEffect> => {
  const { command, observation } = input
  if (!isReadOnlyAction(command.type)) {
    throw new Error(`Unsupported Agent action: ${command.type}`)
  }
  const source = await assertLiveObservation(
    command,
    observation,
    input.adapter
  )

  let resolvedDestination: AgentDestination | undefined
  if (command.type === "switch_tab") {
    const tab = await input.adapter.getTab(command.tabId)
    if (!tab?.url || tab.id !== command.tabId) {
      throw new Error("Agent switch-tab target is unavailable")
    }
    resolvedDestination = destination(tab.url)
  } else if (command.type === "back" || command.type === "forward") {
    const url = await input.adapter.resolveHistoryDestination(
      observation.tabId,
      command.type
    )
    if (!url) throw new Error("Agent history destination is not known safely")
    resolvedDestination = destination(url)
  }
  if (
    resolvedDestination &&
    (await input.adapter.classifyAccess(resolvedDestination.url)) !== "ok"
  ) {
    throw new Error("Agent destination is not readable")
  }

  return {
    command,
    target: targetFromObservation(command, observation),
    ...(resolvedDestination ? { destination: resolvedDestination } : {}),
    semanticEffects:
      command.type === "scroll"
        ? ["scroll"]
        : command.type === "switch_tab" ||
            command.type === "back" ||
            command.type === "forward"
          ? ["navigation"]
          : ["read"],
    snapshotIdentity: {
      snapshotId: observation.snapshotId,
      generation: observation.generation,
      tabId: observation.tabId,
      documentId: observation.documentId
    },
    sourceUrl: source.url,
    sourceOrigin: source.origin
  }
}

export const NAVIGATION_AGENT_ACTIONS = ["navigate", "open_tab"] as const

export type NavigationAgentAction = (typeof NAVIGATION_AGENT_ACTIONS)[number]

const DOWNLOAD_EXTENSIONS = new Set([
  "7z",
  "apk",
  "bin",
  "csv",
  "deb",
  "dmg",
  "doc",
  "docx",
  "exe",
  "gz",
  "iso",
  "msi",
  "pdf",
  "pkg",
  "ppt",
  "pptx",
  "rpm",
  "tar",
  "xls",
  "xlsx",
  "zip"
])

/**
 * Supplemental, raise-only evidence. The extension ships nine locales, so an
 * unrecognized word must never make a destination look safer: the baselines
 * that carry this class are new-origin approval and full-URL display, both of
 * which hold when none of these patterns match.
 */
const AUTHENTICATION_PATH =
  /(?:^|\/)(?:login|log-in|signin|sign-in|sign_in|auth|authorize|oauth2?|sso|saml|mfa|2fa|session)(?:\/|$)/i
const PAYMENT_PATH =
  /(?:^|\/)(?:checkout|payment|payments|pay|billing|purchase|subscribe|subscription)(?:\/|$)/i

const MINIMUM_EGRESS_SPAN = 12

/**
 * Rendered text is repetitive, so a window long enough to be evidence of
 * copying is longer than one that identifies a value the user typed.
 */
const MINIMUM_TEXT_EGRESS_SPAN = 24

const normalizeForComparison = (value: string): string =>
  value.replaceAll(/\s+/g, " ").trim().toLocaleLowerCase()

const decoded = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Every reading of a string, because the two sides of the comparison arrive
 * differently encoded: a query parameter is decoded once by `URL` already, a
 * path segment is not decoded at all, and a value the user typed may itself
 * contain a literal `%20`. Decoding only one side is what lets an encoded
 * value slip past the comparison, so each side offers every form it has.
 *
 * Decoding runs to a fixed point rather than to a depth limit: percent-decoding
 * either shrinks a string or leaves it unchanged, so the walk terminates on its
 * own, and any limit would simply tell an attacker how many layers to add.
 */
const comparisonForms = (value: string): string[] => {
  const forms = new Set<string>()
  let current = value
  let next = value
  do {
    current = next
    const normalized = normalizeForComparison(current)
    if (normalized.length >= MINIMUM_EGRESS_SPAN) forms.add(normalized)
    next = decoded(current)
  } while (next.length < current.length)
  return [...forms]
}

/**
 * Every part of a destination the model could have filled in. Path segments
 * count: a collector that reads its payload out of the path exfiltrates
 * exactly as well as one that reads it out of a query parameter.
 */
const modelSuppliedSpans = (url: URL): string[] =>
  [
    ...url.pathname.split("/"),
    ...url.searchParams.values(),
    url.hash.replace(/^#/, "")
  ].flatMap(comparisonForms)

/**
 * Overlap in either direction is evidence. A span wrapping an observed value
 * in padding hides it exactly as well as a span equal to it, and a span the
 * observed value contains is a partial leak — half an account number is still
 * an account number.
 */
const overlaps = (span: string, observed: string): boolean =>
  span.includes(observed) || observed.includes(span)

/**
 * A run of page text long enough to be evidence of copying, wherever it sits
 * inside the span. Checking the span's windows rather than the span itself is
 * what keeps a prefix or suffix from concealing the copied run; the search
 * stops at the first window that matches.
 */
const containsCopiedText = (span: string, text: string): boolean => {
  if (text.includes(span)) return true
  for (
    let start = 0;
    start + MINIMUM_TEXT_EGRESS_SPAN <= span.length;
    start += 1
  ) {
    if (text.includes(span.slice(start, start + MINIMUM_TEXT_EGRESS_SPAN))) {
      return true
    }
  }
  return false
}

/**
 * Two grades, because they cost different things. A span matching something a
 * user typed into the page is data the model could only have read off their
 * screen; a span matching rendered text is also what an ordinary research task
 * carries into a search. Policy decides; this only reports the strongest match.
 */
const pageDataEvidence = (
  url: URL,
  observation: AgentObservation
): AgentDestination["pageDataEvidence"] => {
  const spans = modelSuppliedSpans(url)
  if (spans.length === 0) return undefined
  const values = observation.elements
    .map((element) => element.value)
    .filter((value): value is string => value !== undefined)
    .flatMap(comparisonForms)
  if (spans.some((span) => values.some((value) => overlaps(span, value)))) {
    return "field_value"
  }
  const text = normalizeForComparison(observation.visibleText)
  return spans.some((span) => containsCopiedText(span, text))
    ? "visible_text"
    : undefined
}

const observedLink = (
  url: URL,
  observation: AgentObservation
): AgentElement | undefined =>
  observation.elements.find(
    (element) =>
      element.frameId === 0 && element.visible && element.href === url.href
  )

const isDownloadDestination = (url: URL, link?: AgentElement): boolean => {
  if (link?.download) return true
  const extension = url.pathname.split(".").pop()?.toLocaleLowerCase()
  return extension !== undefined && DOWNLOAD_EXTENSIONS.has(extension)
}

/**
 * A navigation destination is resolved without refusing an unsupported scheme:
 * blocking is a policy decision the user can see recorded, and a thrown
 * resolver error would report the same attempt as a run failure instead.
 */
const navigationDestination = (
  command: Extract<AgentCommand, { type: "navigate" | "open_tab" }>,
  observation: AgentObservation
): { destination: AgentDestination; effects: AgentSemanticEffect[] } => {
  const url = new URL(command.url)
  const link = observedLink(url, observation)
  const effects: AgentSemanticEffect[] = ["navigation"]
  if (isDownloadDestination(url, link)) effects.push("download")
  const path = `${url.pathname}${url.search}`
  if (AUTHENTICATION_PATH.test(path)) effects.push("authentication")
  if (PAYMENT_PATH.test(path)) effects.push("payment")
  const evidence = link ? undefined : pageDataEvidence(url, observation)
  return {
    destination: {
      url: url.href,
      origin: url.origin,
      source: link ? "observed" : "model",
      ...(evidence ? { pageDataEvidence: evidence } : {})
    },
    effects
  }
}

/**
 * Resolves `navigate` and `open_tab`. The run's allowlist is not consulted
 * here and no origin is added to it: an origin the page offered is a
 * destination to judge, never an authority to travel there.
 */
export const resolveNavigationAgentEffect = async (input: {
  command: AgentCommand
  observation: AgentObservation
  adapter: AgentEffectResolverAdapter
}): Promise<ResolvedAgentEffect> => {
  const { command, observation } = input
  if (command.type !== "navigate" && command.type !== "open_tab") {
    throw new Error(`Unsupported Agent navigation action: ${command.type}`)
  }
  const source = await assertLiveObservation(
    command,
    observation,
    input.adapter
  )
  const { destination, effects } = navigationDestination(command, observation)

  return {
    command,
    target: { sensitive: false, maySubmit: false },
    destination,
    semanticEffects: effects,
    snapshotIdentity: {
      snapshotId: observation.snapshotId,
      generation: observation.generation,
      tabId: observation.tabId,
      documentId: observation.documentId
    },
    sourceUrl: source.url,
    sourceOrigin: source.origin
  }
}

export const DOM_MUTATION_AGENT_ACTIONS = [
  "click",
  "type",
  "clear_and_type",
  "select",
  "check",
  "uncheck",
  "press_key"
] as const

export type DomMutationAgentAction = (typeof DOM_MUTATION_AGENT_ACTIONS)[number]

const DESTRUCTIVE_LABELS = [
  /\b(?:delete|remove|erase|destroy|discard)\b/i,
  /\b(?:löschen|entfernen|vernichten)\b/i,
  /\b(?:eliminar|borrar|suprimir)\b/i,
  /\b(?:supprimer|effacer|détruire)\b/i,
  /(?:हटाएं|हटायें|मिटाएं|नष्ट)/u,
  /\b(?:elimina|eliminare|cancella)\b/i,
  /(?:削除|消去)/u,
  /(?:удалить|стереть|уничтожить)/iu,
  /(?:删除|移除|清除)/u
] as const

const isDomMutationAction = (type: string): type is DomMutationAgentAction =>
  (DOM_MUTATION_AGENT_ACTIONS as readonly string[]).includes(type)

const isDestructiveLabel = (value?: string): boolean =>
  Boolean(value && DESTRUCTIVE_LABELS.some((pattern) => pattern.test(value)))

const findMutationElement = (
  command: AgentCommand,
  observation: AgentObservation
): AgentElement => {
  if (!("ref" in command)) throw new Error("Agent action has no element ref")
  const candidates = observation.elements.filter(
    (element) => element.ref === command.ref && element.frameId === 0
  )
  if (candidates.length !== 1) {
    throw new Error("Agent mutation target is stale or ambiguous")
  }
  const element = candidates[0]
  if (!element?.visible || !element.enabled) {
    throw new Error("Agent mutation target is not actionable")
  }
  return element
}

const targetFromElement = (
  element: AgentElement,
  expected?: { value?: string; checked?: boolean }
): ResolvedAgentTarget => ({
  ref: element.ref,
  frameId: 0,
  tag: element.tag,
  role: element.role,
  accessibleName: element.name,
  inputType: element.type,
  observedValue: element.value,
  observedChecked: element.checked,
  observedFocused: element.focused,
  href: element.href,
  formAction: element.formAction,
  formMethod: element.formMethod,
  formFingerprint: element.formFingerprint,
  formHasSensitiveControl: element.formHasSensitiveControl,
  submitter: element.submitter,
  expectedValue: expected?.value,
  expectedChecked: expected?.checked,
  sensitive: element.sensitive,
  maySubmit: Boolean(element.maySubmit)
})

const formDestination = (
  element: AgentElement
): AgentDestination | undefined => {
  if (!element.formAction) return undefined
  const url = new URL(element.formAction)
  return { url: url.href, origin: url.origin, source: "observed" }
}

const linkDestination = (
  element: AgentElement
): AgentDestination | undefined => {
  if (!element.href) return undefined
  const url = new URL(element.href)
  return { url: url.href, origin: url.origin, source: "observed" }
}

const addPageClassifications = (
  effects: AgentSemanticEffect[],
  source: URL,
  destination?: AgentDestination
): void => {
  const paths = [`${source.pathname}${source.search}`]
  if (destination) {
    const parsed = new URL(destination.url)
    paths.push(`${parsed.pathname}${parsed.search}`)
  }
  if (paths.some((path) => AUTHENTICATION_PATH.test(path))) {
    effects.push("authentication")
  }
  if (paths.some((path) => PAYMENT_PATH.test(path))) effects.push("payment")
}

const assertTextTarget = (element: AgentElement): void => {
  if (
    element.sensitive &&
    (element.tag === "input" || element.tag === "textarea") &&
    element.editable
  ) {
    return
  }
  const supportedTextTypes = ["email", "number", "search", "tel", "text", "url"]
  const supportedInput =
    element.tag === "input" &&
    supportedTextTypes.includes(element.type?.toLowerCase() ?? "text")
  if ((!supportedInput && element.tag !== "textarea") || !element.editable) {
    throw new Error("Agent text action targets an unsupported control")
  }
}

const assertSelectTarget = (element: AgentElement, value: string): void => {
  if (element.tag !== "select" || !element.editable || !element.options) {
    throw new Error("Agent select action targets an unsupported control")
  }
  const matches = element.options.filter(
    (option) => option.value === value && !option.disabled
  )
  if (matches.length !== 1) {
    throw new Error("Agent select option is unavailable or ambiguous")
  }
}

const assertCheckTarget = (
  element: AgentElement,
  action: "check" | "uncheck"
): void => {
  const type = element.type?.toLowerCase()
  if (element.tag !== "input" || !["checkbox", "radio"].includes(type ?? "")) {
    throw new Error("Agent check action targets an unsupported control")
  }
  if (action === "uncheck" && type === "radio") {
    throw new Error("Agent cannot uncheck a radio control")
  }
}

const clickSemantics = (
  element: AgentElement
): {
  destination?: AgentDestination
  effects: AgentSemanticEffect[]
} => {
  if (element.href) {
    const destination = linkDestination(element)
    const effects: AgentSemanticEffect[] = ["navigation"]
    if (
      destination &&
      isDownloadDestination(new URL(destination.url), element)
    ) {
      effects.push("download")
    }
    return { destination, effects }
  }
  const clickable =
    element.tag === "button" ||
    (element.tag === "input" &&
      ["button", "image", "reset", "submit"].includes(
        element.type?.toLowerCase() ?? ""
      )) ||
    ["button", "link", "menuitem"].includes(element.role?.toLowerCase() ?? "")
  if (!clickable) {
    throw new Error("Agent click targets an unsupported control")
  }
  if (element.submitter) {
    return {
      destination: formDestination(element),
      effects: ["form_mutation", "submission"]
    }
  }
  if (element.tag === "input" && element.type?.toLowerCase() === "reset") {
    return { effects: ["form_mutation"] }
  }
  return { effects: ["activation"] }
}

/**
 * Resolves mutation semantics from the exact element the observation exposed.
 * The command contributes intent, never authority: target type, form action,
 * submission behavior, and destination all come from the observed control.
 */
export const resolveDomMutationAgentEffect = async (input: {
  command: AgentCommand
  observation: AgentObservation
  adapter: AgentEffectResolverAdapter
}): Promise<ResolvedAgentEffect> => {
  const { command, observation } = input
  if (!isDomMutationAction(command.type)) {
    throw new Error(`Unsupported Agent DOM mutation action: ${command.type}`)
  }
  const source = await assertLiveObservation(
    command,
    observation,
    input.adapter
  )
  const element = findMutationElement(command, observation)
  const effects: AgentSemanticEffect[] = []
  let destination: AgentDestination | undefined
  let expected: { value?: string; checked?: boolean } | undefined

  switch (command.type) {
    case "click": {
      const semantics = clickSemantics(element)
      effects.push(...semantics.effects)
      destination = semantics.destination
      break
    }
    case "type": {
      assertTextTarget(element)
      if (!element.sensitive) {
        const current = element.value ?? ""
        if (current.length + command.text.length > 500) {
          throw new Error(
            "Agent text result exceeds the verifiable value limit"
          )
        }
        expected = { value: `${current}${command.text}` }
      }
      effects.push("form_mutation")
      break
    }
    case "clear_and_type":
      assertTextTarget(element)
      if (!element.sensitive) expected = { value: command.text }
      effects.push("form_mutation")
      break
    case "select":
      assertSelectTarget(element, command.value)
      expected = { value: command.value }
      effects.push("form_mutation")
      break
    case "check":
    case "uncheck":
      assertCheckTarget(element, command.type)
      expected = { checked: command.type === "check" }
      effects.push("form_mutation")
      break
    case "press_key":
      if (!element.focused) {
        throw new Error("Agent key action target is not focused")
      }
      if (command.key === "Enter" && element.maySubmit) {
        destination = formDestination(element)
        effects.push("form_mutation", "submission")
      } else {
        effects.push("activation")
      }
      break
  }

  if (element.sensitive || element.formHasSensitiveControl) {
    effects.push("sensitive_input")
  }
  if (isDestructiveLabel(element.name)) effects.push("destructive")
  addPageClassifications(effects, new URL(source.url), destination)

  return {
    command,
    target: targetFromElement(element, expected),
    ...(destination ? { destination } : {}),
    semanticEffects: [...new Set(effects)],
    snapshotIdentity: {
      snapshotId: observation.snapshotId,
      generation: observation.generation,
      tabId: observation.tabId,
      documentId: observation.documentId
    },
    sourceUrl: source.url,
    sourceOrigin: source.origin
  }
}
