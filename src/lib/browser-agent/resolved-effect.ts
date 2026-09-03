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
 * Every part of a destination the model could have filled in. Path segments
 * count: a collector that reads its payload out of the path exfiltrates
 * exactly as well as one that reads it out of a query parameter.
 */
const modelSuppliedSpans = (url: URL): string[] =>
  [
    ...url.pathname.split("/"),
    ...url.searchParams.values(),
    url.hash.replace(/^#/, "")
  ]
    .map((span) => normalizeForComparison(decoded(span)))
    .filter((span) => span.length >= MINIMUM_EGRESS_SPAN)

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
    .map(normalizeForComparison)
    .filter((value) => value.length >= MINIMUM_EGRESS_SPAN)
  if (spans.some((span) => values.some((value) => value.includes(span)))) {
    return "field_value"
  }
  const text = normalizeForComparison(observation.visibleText)
  return spans.some((span) => text.includes(span)) ? "visible_text" : undefined
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
