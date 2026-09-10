import {
  type AgentDestination,
  type AgentDropTarget,
  AgentGroundingError,
  type AgentResolutionContext,
  type AgentSemanticEffect,
  AgentStaleObservationError,
  AgentUnreadablePageError,
  classifyAgentAffordance,
  type ResolvedAgentEffect,
  type ResolvedAgentTarget
} from "@ollama-client/agent-runtime"
import {
  type AgentCommand,
  type AgentElement,
  AgentElementSchema,
  type AgentObservation,
  type AgentScreenshot,
  type AgentSnapshotIdentity
} from "@ollama-client/contracts"

import type { TabAccess } from "@/lib/browser-tab-access"
import type { AgentHitTestResult } from "./control-port"
import { replaceAgentTextOnce } from "./editor-text"
import {
  agentFramePage,
  agentFrameSnapshotIdentity,
  rootAgentSnapshotIdentity
} from "./frame-identity"
import { imagePointToCss } from "./screenshot-geometry"

export const READ_ONLY_AGENT_ACTIONS = [
  "read",
  "inspect",
  "find",
  "extract_text",
  "zoom",
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
  /**
   * What lies under a root-frame CSS point in the live snapshot. Absent means
   * the host cannot ask the page, and visual targets are refused.
   */
  hitTest?(
    identity: AgentSnapshotIdentity,
    point: { x: number; y: number }
  ): Promise<AgentHitTestResult>
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
    (candidate) => candidate.ref === command.ref
  )
  if (!element)
    throw new AgentStaleObservationError("Agent scroll target is stale")
  return {
    ref: element.ref,
    frameId: element.frameId,
    frame: agentFrameSnapshotIdentity(observation, element),
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
    throw new AgentStaleObservationError(
      "Agent command references a stale observation"
    )
  }
  /**
   * A native dialog holds the document, so no other command can be grounded
   * in a page nobody can read. Refused here rather than per family, because
   * every family shares this function and the answer is the same for all of
   * them: answer the dialog first.
   */
  if (command.type !== "handle_dialog" && observation.dialogs.length > 0) {
    throw new AgentGroundingError({ refusal: { reason: "dialog_open" } })
  }
  const source = destination(observation.url)
  if (
    source.origin !== observation.origin ||
    (await adapter.classifyAccess(source.url)) !== "ok"
  ) {
    throw new AgentUnreadablePageError(
      "Agent observation is no longer readable"
    )
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
      throw new AgentUnreadablePageError(
        "Agent switch-tab target is unavailable"
      )
    }
    resolvedDestination = destination(tab.url)
  } else if (command.type === "back" || command.type === "forward") {
    const url = await input.adapter.resolveHistoryDestination(
      observation.tabId,
      command.type
    )
    if (!url) {
      throw new AgentUnreadablePageError(
        "Agent history destination is not known safely"
      )
    }
    resolvedDestination = destination(url)
  }
  if (
    resolvedDestination &&
    (await input.adapter.classifyAccess(resolvedDestination.url)) !== "ok"
  ) {
    throw new AgentUnreadablePageError("Agent destination is not readable")
  }

  const target = targetFromObservation(command, observation)
  /* A referenced scroll is bound to its target's frame; nothing else has one. */
  const frame = target.frame
    ? agentFramePage(observation, target.frame)
    : undefined
  return {
    command,
    target,
    ...(resolvedDestination ? { destination: resolvedDestination } : {}),
    semanticEffects:
      command.type === "scroll"
        ? ["scroll"]
        : command.type === "switch_tab" ||
            command.type === "back" ||
            command.type === "forward"
          ? ["navigation"]
          : ["read"],
    snapshotIdentity: rootAgentSnapshotIdentity(observation),
    sourceUrl: source.url,
    sourceOrigin: source.origin,
    ...(frame ? { frameUrl: frame.url, frameOrigin: frame.origin } : {})
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
  /**
   * Both the viewport and the rest of the document, because the model is
   * given both. Checking only what was on screen would let a destination
   * built from text below the fold escape the classification that the same
   * text carries when it happens to be visible.
   */
  const rendered = [
    observation.visibleText,
    ...(observation.documentText ? [observation.documentText] : [])
  ].map(normalizeForComparison)
  return spans.some((span) =>
    rendered.some((text) => containsCopiedText(span, text))
  )
    ? "visible_text"
    : undefined
}

const observedLink = (
  url: URL,
  observation: AgentObservation
): AgentElement | undefined =>
  observation.elements.find(
    (element) => element.visible && element.href === url.href
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
    snapshotIdentity: rootAgentSnapshotIdentity(observation),
    sourceUrl: source.url,
    sourceOrigin: source.origin
  }
}

export const DIALOG_AGENT_ACTIONS = ["handle_dialog"] as const

export type DialogAgentAction = (typeof DIALOG_AGENT_ACTIONS)[number]

/**
 * Resolves `handle_dialog` against the dialog the observation reported.
 *
 * The dialog's identity travels so the executor answers the prompt this
 * decision was taken against and no other. Its message travels as the
 * target's accessible name, which is the channel page evidence already
 * reaches an approval through — page text, bounded and shown, never trusted.
 *
 * Dismissal is the safe direction and is priced as such. Accepting is not:
 * a `confirm` is how a page asks before deleting something and a
 * `beforeunload` is how it says work would be lost, and neither says which
 * from the outside — so an accepted confirmation, prompt or unload carries
 * `destructive`, which is critical and never grantable. An `alert` has only
 * one button and commits to nothing, so closing it costs no prompt: a run
 * that had to ask before dismissing an alert could not get past one.
 */
export const resolveDialogAgentEffect = async (input: {
  command: AgentCommand
  observation: AgentObservation
  adapter: AgentEffectResolverAdapter
}): Promise<ResolvedAgentEffect> => {
  const { command, observation } = input
  if (command.type !== "handle_dialog") {
    throw new Error(`Unsupported Agent dialog action: ${command.type}`)
  }
  const source = await assertLiveObservation(
    command,
    observation,
    input.adapter
  )
  const refused = classifyAgentAffordance(command, observation)
  if (refused) throw new AgentGroundingError({ refusal: refused })
  const dialog = observation.dialogs.find(
    (open) => open.id === command.dialogId
  )
  if (!dialog) {
    throw new AgentGroundingError({ refusal: { reason: "unknown_dialog" } })
  }
  const effects: AgentSemanticEffect[] = ["dialog"]
  if (command.accept && dialog.type !== "alert") effects.push("destructive")
  if (command.accept && dialog.type === "prompt") effects.push("form_mutation")
  return {
    command,
    target: {
      sensitive: false,
      maySubmit: false,
      ...(dialog.message ? { accessibleName: dialog.message } : {})
    },
    dialog: { id: dialog.id, type: dialog.type },
    semanticEffects: effects,
    snapshotIdentity: rootAgentSnapshotIdentity(observation),
    sourceUrl: source.url,
    sourceOrigin: source.origin,
    /**
     * A dialog raised by an embedded frame is an effect on that frame's
     * site, not on the page the tab shows: it is the frame that asked and
     * the frame that acts on the answer. Carried the same way a child-frame
     * element's is, so policy judges the answer, its grant offer and its
     * origin allowlist against the site that owns the prompt.
     */
    ...(dialog.origin === source.origin ? {} : { frameOrigin: dialog.origin })
  }
}

export const DOM_MUTATION_AGENT_ACTIONS = [
  "click",
  "click_point",
  "double_click",
  "hover",
  "type",
  "clear_and_type",
  "replace_text",
  "drag",
  "select",
  "check",
  "uncheck",
  "press_key"
] as const

export type DomMutationAgentAction = (typeof DOM_MUTATION_AGENT_ACTIONS)[number]

/** The most a field may hold for its value to remain verifiable. */
const MAX_VERIFIABLE_VALUE_CHARS = 500

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

/**
 * The element the command names, refused through the shared classifier rather
 * than through a second copy of its rules. The classifier answers the same
 * question the parser asked, so a command that reached execution cannot be
 * refused here for a reason the model was never told.
 */
const findMutationElement = (
  command: AgentCommand,
  observation: AgentObservation
): AgentElement => {
  if (!("ref" in command)) throw new Error("Agent action has no element ref")
  const refused = classifyAgentAffordance(command, observation)
  if (refused) throw new AgentGroundingError({ refusal: refused })
  const element = observation.elements.find(
    (candidate) => candidate.ref === command.ref
  )
  if (!element)
    throw new AgentGroundingError({ refusal: { reason: "unknown_ref" } })
  return element
}

const targetFromElement = (
  element: AgentElement,
  observation: AgentObservation,
  expected?: { value?: string; checked?: boolean }
): ResolvedAgentTarget => ({
  ref: element.ref,
  verificationId: element.verificationId,
  frameId: element.frameId,
  frame: agentFrameSnapshotIdentity(observation, element),
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

/**
 * The commands whose whole effect is a changed value, and which therefore
 * have to say whether that change is already persisted.
 */
const FORM_MUTATION_ACTIONS = new Set([
  "type",
  "clear_and_type",
  "replace_text",
  "select",
  "check",
  "uncheck"
])

/**
 * Whether the edited control has no submission step behind it.
 *
 * A form is filled in and then submitted, and the submission is where the
 * user is asked. A control belonging to no form — an editing host, or a bare
 * field in an application that saves on input — has no such step, so this
 * approval is the only one there will be. It says nothing about whether the
 * page stored anything, which the run cannot see. Read from the observation's
 * own facts: a control on a submit path reports `maySubmit`, and one
 * belonging to a form reports that form's fingerprint.
 */
const hasNoSubmitStep = (
  command: AgentCommand,
  element: AgentElement
): boolean =>
  FORM_MUTATION_ACTIONS.has(command.type) &&
  !element.maySubmit &&
  element.formFingerprint === undefined

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
  destination?: AgentDestination,
  frame?: URL
): void => {
  const paths = [`${source.pathname}${source.search}`]
  if (frame) paths.push(`${frame.pathname}${frame.search}`)
  if (destination) {
    const parsed = new URL(destination.url)
    paths.push(`${parsed.pathname}${parsed.search}`)
  }
  if (paths.some((path) => AUTHENTICATION_PATH.test(path))) {
    effects.push("authentication")
  }
  if (paths.some((path) => PAYMENT_PATH.test(path))) effects.push("payment")
}

/**
 * Only semantics remain here: which effects a click carries and where it goes.
 * Whether the control accepts the command at all was settled by the shared
 * classifier in `findMutationElement`.
 */
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
  if (element.submitter) {
    return {
      destination: formDestination(element),
      effects: ["form_mutation", "submission"]
    }
  }
  if (element.tag === "input" && element.type?.toLowerCase() === "reset") {
    return { effects: ["form_mutation"] }
  }
  /** A file input's click is a request for the user's files, nothing else. */
  if (element.tag === "input" && element.type?.toLowerCase() === "file") {
    return { effects: ["file_selection"] }
  }
  return { effects: ["activation"] }
}

/**
 * The value an edit should leave behind, or a refusal when the observation
 * cannot say. A value at the observation's cap may have been cut, so nothing
 * computed from it is a fact about the field; a result past the cap could not
 * be read back either way.
 */
const expectedTextValue = (
  element: AgentElement,
  compute: (current: string) => string | undefined
): string => {
  const current = element.value ?? ""
  if (current.length >= MAX_VERIFIABLE_VALUE_CHARS) {
    throw new Error("Agent text target exceeds the verifiable value limit")
  }
  const next = compute(current)
  if (next === undefined) {
    throw new AgentGroundingError({
      refusal: { reason: "text_not_found", ref: element.ref, tag: element.tag }
    })
  }
  if (next.length > MAX_VERIFIABLE_VALUE_CHARS) {
    throw new Error("Agent text result exceeds the verifiable value limit")
  }
  return next
}

/**
 * The destination of a drag, grounded through the same classifier that
 * accepted the command, then carried in the terms its recheck compares. A
 * drop is an effect on the destination as much as on the source, so its
 * facts are part of what the user approves.
 */
const dropTargetOf = (
  command: Extract<AgentCommand, { type: "drag" }>,
  observation: AgentObservation
): { element: AgentElement; drop: AgentDropTarget } => {
  const element = observation.elements.find(
    (candidate) => candidate.ref === command.to
  )
  if (!element) {
    throw new AgentGroundingError({
      refusal: { reason: "unknown_destination", ref: command.to }
    })
  }
  return {
    element,
    drop: {
      ref: element.ref,
      ...(element.verificationId
        ? { verificationId: element.verificationId }
        : {}),
      frameId: element.frameId,
      tag: element.tag,
      ...(element.role ? { role: element.role } : {}),
      ...(element.name ? { accessibleName: element.name } : {})
    }
  }
}

/**
 * The screenshot a `click_point` is grounded in, or the reason there is none.
 * A picture from another generation is a stale observation — the decision was
 * sound when made — while a command aimed at a picture that never travelled
 * is the model's own mistake and is told so.
 */
const groundingScreenshot = (
  command: Extract<AgentCommand, { type: "click_point" }>,
  observation: AgentObservation,
  context: AgentResolutionContext | undefined
): AgentScreenshot => {
  const screenshot = context?.screenshot
  if (!screenshot) {
    throw new AgentGroundingError({ refusal: { reason: "no_screenshot" } })
  }
  if (
    screenshot.snapshotId !== command.snapshotId ||
    screenshot.generation !== command.generation ||
    screenshot.documentId !== observation.documentId ||
    screenshot.tabId !== observation.tabId ||
    screenshot.scroll.x !== observation.scroll.x ||
    screenshot.scroll.y !== observation.scroll.y
  ) {
    throw new AgentStaleObservationError(
      "Agent screenshot is not the one this observation was taken with"
    )
  }
  return screenshot
}

/**
 * Turns a pixel in the screenshot into the control under it. The point is
 * converted through the screenshot's own geometry and asked of the live page;
 * what comes back is an observed element like any other, so every rule that
 * governs a click — sensitivity, links, submitters, checkboxes — governs a
 * visual click too. Only "not an activatable control" is waived: a canvas or
 * a bare region is exactly what a point exists to reach.
 */
const findVisualElement = async (
  command: Extract<AgentCommand, { type: "click_point" }>,
  observation: AgentObservation,
  context: AgentResolutionContext | undefined,
  adapter: AgentEffectResolverAdapter
): Promise<{ element: AgentElement; point: { x: number; y: number } }> => {
  const screenshot = groundingScreenshot(command, observation, context)
  const point = imagePointToCss(screenshot, { x: command.x, y: command.y })
  if (!point) {
    throw new AgentGroundingError({
      refusal: { reason: "point_outside_image" }
    })
  }
  if (!adapter.hitTest) {
    throw new AgentGroundingError({ refusal: { reason: "visual_unavailable" } })
  }
  const hit = await adapter.hitTest(
    rootAgentSnapshotIdentity(observation),
    point
  )
  if (!hit) {
    throw new AgentGroundingError({ refusal: { reason: "point_on_nothing" } })
  }
  if (hit.frameElement || !hit.element) {
    throw new AgentGroundingError({ refusal: { reason: "point_in_frame" } })
  }
  const element = AgentElementSchema.parse(hit.element)
  const refused = classifyAgentAffordance(
    { ...command, type: "click", ref: element.ref } as AgentCommand,
    {
      ...observation,
      elements: [
        ...observation.elements.filter((known) => known.ref !== element.ref),
        element
      ]
    }
  )
  if (refused && refused.reason !== "not_clickable") {
    throw new AgentGroundingError({ refusal: refused })
  }
  return { element, point }
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
  context?: AgentResolutionContext
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
  let point: { x: number; y: number } | undefined
  let element: AgentElement
  if (command.type === "click_point") {
    const visual = await findVisualElement(
      command,
      observation,
      input.context,
      input.adapter
    )
    element = visual.element
    point = visual.point
  } else {
    element = findMutationElement(command, observation)
  }
  const effects: AgentSemanticEffect[] = []
  let destination: AgentDestination | undefined
  let expected: { value?: string; checked?: boolean } | undefined
  let drop: { element: AgentElement; drop: AgentDropTarget } | undefined

  switch (command.type) {
    case "click":
    case "click_point": {
      const semantics = clickSemantics(element)
      effects.push(...semantics.effects)
      destination = semantics.destination
      break
    }
    /** The classifier refused links and submitters; what is left activates. */
    case "double_click":
      effects.push("activation")
      break
    case "hover":
      effects.push("hover")
      break
    case "type": {
      if (!element.sensitive) {
        expected = {
          value: expectedTextValue(
            element,
            (current) => `${current}${command.text}`
          )
        }
      }
      effects.push("form_mutation")
      break
    }
    case "clear_and_type":
      if (!element.sensitive) expected = { value: command.text }
      effects.push("form_mutation")
      break
    case "replace_text":
      if (!element.sensitive) {
        expected = {
          value: expectedTextValue(element, (current) =>
            replaceAgentTextOnce(current, command.find, command.text)
          )
        }
      }
      effects.push("form_mutation")
      break
    /**
     * A drop lands on the destination, so its label is read for destructive
     * intent too: dragging an item onto "Trash" deletes it as surely as a
     * button would.
     */
    case "drag":
      drop = dropTargetOf(command, observation)
      effects.push("drag")
      if (isDestructiveLabel(drop.element.name)) effects.push("destructive")
      break
    case "select":
      expected = { value: command.value }
      effects.push("form_mutation")
      break
    case "check":
    case "uncheck":
      expected = { checked: command.type === "check" }
      effects.push("form_mutation")
      break
    case "press_key":
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
  const frame = agentFramePage(observation, element)
  addPageClassifications(
    effects,
    new URL(source.url),
    destination,
    frame ? new URL(frame.url) : undefined
  )

  return {
    command,
    target: {
      ...targetFromElement(element, observation, expected),
      ...(point ? { point } : {}),
      ...(drop ? { drop: drop.drop } : {}),
      ...(hasNoSubmitStep(command, element) ? { noSubmitStep: true } : {})
    },
    ...(destination ? { destination } : {}),
    semanticEffects: [...new Set(effects)],
    snapshotIdentity: rootAgentSnapshotIdentity(observation),
    sourceUrl: source.url,
    sourceOrigin: source.origin,
    ...(frame ? { frameUrl: frame.url, frameOrigin: frame.origin } : {})
  }
}
