import type {
  AgentEvidenceRecord,
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { agentNormalizedClaim } from "./observed-text"
import type { AgentStepReadout } from "./ports"
import { agentRowContextBeyond, agentTextNamesRecord } from "./row-context"

const same = (a: string, b: string) =>
  agentNormalizedClaim(a) === agentNormalizedClaim(b)
/**
 * The controls a check names: those whose label is the name exactly, or,
 * when none is, those whose label holds the name as a whole phrase. A
 * planner shortens labels — the check said "terms" for a box labelled "I
 * accept the terms", and was never met on any page. Several phrase matches
 * stay several, so an ambiguous name is still no answer.
 */
const namedBy = <T>(
  items: readonly T[],
  label: (item: T) => string | undefined,
  name: string
): T[] => {
  const exact = items.filter((item) => {
    const text = label(item)
    return text !== undefined && same(text, name)
  })
  if (exact.length) return exact
  return items.filter((item) => {
    const text = label(item)
    return text !== undefined && agentTextNamesRecord(text, name)
  })
}

const escapePattern = (text: string) =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Only independently observed facts, never inputs or model/tool claims. */
export const groundedCompletionQuote = (
  quote: string | undefined,
  requirementId: string,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  current = false
) =>
  ledger?.find(
    (record) =>
      record.kind === "observed_fact" &&
      record.source &&
      record.quote &&
      quote &&
      (record.requirementId === undefined ||
        record.requirementId === requirementId) &&
      (record.validity === "current" ||
        (!current && record.validity === "historical")) &&
      same(record.quote, quote)
  )

/**
 * A read the model took off the screenshot it completed on, answered exactly
 * as it read it. Current only: a reading of an earlier picture describes a
 * page that may have moved since. Never independent support — the picture's
 * own words are the model's — so it settles a read as seen, not verified.
 */
export const visualCompletionRead = (
  quote: string | undefined,
  requirementId: string,
  ledger: readonly AgentEvidenceRecord[] | undefined
) =>
  ledger?.find(
    (record) =>
      record.kind === "visual_observation" &&
      record.validity === "current" &&
      record.source &&
      record.quote &&
      quote &&
      record.requirementId === requirementId &&
      same(record.quote, quote)
  )

/** A control write the verifier confirmed by the value it left behind. */
const FIELD_WRITE_KINDS = new Set(["field", "fields"])
/** The same for a box or switch, confirmed by the state it left behind. */
const CHECKED_WRITE_KINDS = new Set(["checked", "fields"])

/**
 * Whether a confirmed write left its control holding exactly the value the
 * requirement it advanced names. Decided when the step is verified, the one
 * moment both are known: a receipt redacts what was typed, and the control
 * may be gone from the page a later submission opened. A plain `type`
 * appends, so it holds the planned value only when its resolved result is
 * that value, which is what `expectedValue` already says. A batch holds it
 * only through the one field of that name it set; two of the same name are
 * no answer.
 */
export const agentWriteHeldPlannedValue = (
  requirement: AgentTaskRequirement | undefined,
  targets: readonly {
    accessibleName?: string
    expectedValue?: string
    expectedChecked?: boolean
    sensitive?: boolean
    frameId?: number
  }[],
  verification: { outcome: string; evidence: { kind: string } }
): boolean => {
  const check = requirement?.check
  if (
    !check ||
    (check.type !== "field" &&
      check.type !== "selected" &&
      check.type !== "checked") ||
    check.record ||
    verification.outcome !== "confirmed" ||
    !(check.type === "checked" ? CHECKED_WRITE_KINDS : FIELD_WRITE_KINDS).has(
      verification.evidence.kind
    )
  )
    return false
  /**
   * The check's frame, when it names one: a Name field written in the page
   * is not the Name field the requirement named inside a frame, and the
   * receipt that later stands for it keeps no frame to tell them apart.
   */
  const named = namedBy(
    targets.filter(
      (target) =>
        check.frameId === undefined || target.frameId === check.frameId
    ),
    (target) => target.accessibleName,
    check.name
  )
  return (
    named.length === 1 &&
    !named[0].sensitive &&
    (check.type === "checked"
      ? named[0].expectedChecked === check.checked
      : named[0].expectedValue === check.value)
  )
}

/**
 * What can take a filled control off the page: the form was sent, or the
 * page navigated. A confirmed click or key press that left the field in
 * place proves nothing about where it went.
 */
const PAGE_LEAVING_KINDS = new Set(["submission", "navigation", "tab"])

/**
 * A followed link is verified as an `activation`, and so is a click that
 * stayed put; only the verifier's own sentence tells them apart. These are
 * the runtime's fixed wording for a click whose destination committed or
 * whose page opened in a tab of its own — never page text.
 */
export const AGENT_PAGE_LEAVING_ACTIVATIONS = new Set([
  "Authorized destination is committed",
  "The site redirected its own link within its origin",
  "Control opened a new tab"
])

const leftThePage = (step: AgentStepReadout): boolean => {
  const verification = step.verification
  if (verification?.outcome !== "confirmed") return false
  /** A form the site turned away left its fields where they were. */
  if (
    verification.evidence.kind === "submission" &&
    verification.evidence.acceptance !== "accepted"
  )
    return false
  return (
    PAGE_LEAVING_KINDS.has(verification.evidence.kind) ||
    (verification.evidence.kind === "activation" &&
      AGENT_PAGE_LEAVING_ACTIVATIONS.has(verification.evidence.summary))
  )
}

/** Whether a confirmed write of either shape set a control of this name. */
const writesControlNamed = (step: AgentStepReadout, name: string): boolean => {
  const evidence = step.verification?.evidence
  if (evidence?.kind === "field" || evidence?.kind === "checked")
    return namedBy([step.target?.name], (label) => label, name).length === 1
  return (
    evidence?.kind === "fields" &&
    namedBy(evidence.fields ?? [], (field) => field.name, name).length === 1
  )
}

/**
 * A control the run filled and then moved on from is not on the page it moved
 * to. Its absence contradicts nothing when the run's last write to a control
 * of that name was verified holding exactly the planned value and a confirmed
 * submission or navigation came after it: the page left because the run
 * left it. A later write
 * to the same name replaces the earlier one, so a value cleared or retyped
 * before leaving is never credited.
 *
 * `credited` when it stands for the control, `unproven` when the run wrote
 * the control and left it without that record, undefined when the run never
 * left a control of that name behind.
 */
const plannedValueLeftBehind = (
  requirementId: string,
  name: string,
  changes: readonly AgentStepReadout[],
  currentUrl: string
): "credited" | "unproven" | undefined => {
  let last = -1
  for (const [index, step] of changes.entries())
    if (writesControlNamed(step, name)) last = index
  if (last < 0) return undefined
  const write = changes[last]
  const later = changes.slice(last + 1)
  /**
   * The page left when a later step says so, or when the run, after a later
   * change, is no longer on the page the write was made on. A save button
   * whose handler posts and then navigates is verified on the in-page change
   * it made first, so its own receipt never says it left; the address the
   * run is on now does.
   */
  const left =
    later.some(leftThePage) ||
    (later.length > 0 &&
      write.sourceUrl !== undefined &&
      !samePageAddress(write.sourceUrl, currentUrl))
  if (!left) return undefined
  return write.heldPlannedValue === true &&
    write.requirementId === requirementId
    ? "credited"
    : "unproven"
}

/** Same scheme, host and path, read by pattern: the package has no `URL`. */
const samePageAddress = (first: string, second: string): boolean => {
  const page = (url: string) => {
    const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([^?#]*)/i.exec(url)
    return match ? `${match[1].toLowerCase()}${match[2] || "/"}` : undefined
  }
  const a = page(first)
  return a !== undefined && a === page(second)
}

/**
 * A select is read by its option, and the planner names the option the way
 * the page shows it. `value` is what the page submits, which is often a
 * lowercase key behind a capitalized label; the label the user sees is the
 * same option, so either identifies it. The option must still be the one
 * selected and must not be disabled.
 */
const selectedOptionMatches = (
  element: AgentObservation["elements"][number],
  wanted: string
): boolean =>
  element.options?.some(
    (option) =>
      option.value === element.value &&
      !option.disabled &&
      (option.value === wanted || same(option.label, wanted))
  ) === true

/**
 * A control's on/off state, whichever way the page declares it: a native
 * checkbox, then a custom one's `aria-checked`, a toggle button's
 * `aria-pressed`, a tab's or option's `aria-selected`. "mixed" is neither.
 */
export const agentControlOnState = (
  element: AgentObservation["elements"][number]
): boolean | undefined => {
  for (const state of [
    element.checked,
    element.ariaChecked,
    element.pressed,
    element.selected
  ])
    if (typeof state === "boolean") return state
  return undefined
}

/**
 * A custom listbox has no native options to read: its choice is the one
 * option marked selected in the listbox the control owns, which the
 * observation reads where ownership is known. Never another listbox's
 * selection in the same frame, and never the text a combobox holds: typing
 * "Blue" into an autocomplete picks nothing.
 */
const ariaSelectionMatches = (
  element: AgentObservation["elements"][number],
  wanted: string
): boolean =>
  element.selectedOption !== undefined && same(element.selectedOption, wanted)

type ControlTransitionCheck = Extract<
  NonNullable<AgentTaskRequirement["check"]>,
  { type: "control_transition" }
>

const checkControlTransition = (
  requirementId: string,
  check: ControlTransitionCheck,
  observation: AgentObservation,
  changes: readonly AgentStepReadout[]
): boolean | undefined => {
  /**
   * Row context is whole-row text, so finding the record's name inside it
   * cannot tell "Record 1" from "Record 1 copy". A row proves ownership only
   * when what it says besides the control's own label is exactly the
   * record; anything less is left to independent review, never decided
   * either way.
   */
  const ownsRecord = (name: string | undefined, row: string | undefined) =>
    !check.record || same(agentRowContextBeyond(name, row) ?? "", check.record)
  const undecided = check.record ? undefined : false
  if (same(check.from, check.to)) return false
  const after = observation.elements.filter(
    (element) =>
      !element.sensitive &&
      (element.visible || element.offscreen) &&
      same(element.name ?? "", check.to) &&
      (check.frameId === undefined || element.frameId === check.frameId) &&
      ownsRecord(element.name, element.rowContext)
  )
  if (after.length !== 1) return undecided
  const proved = changes.some(
    (step) =>
      step.verification?.outcome === "confirmed" &&
      step.requirementId === requirementId &&
      same(
        step.verification.evidence.controlTransition?.from ?? "",
        check.from
      ) &&
      same(step.verification.evidence.controlTransition?.to ?? "", check.to) &&
      after[0].verificationId ===
        step.verification.evidence.controlTransition?.verificationId &&
      after[0].frameId ===
        step.verification.evidence.controlTransition?.frameId &&
      observation.documentId ===
        step.verification.evidence.controlTransition?.documentId &&
      ownsRecord(step.target?.name, step.target?.rowContext)
  )
  return proved || undecided
}

/** Undefined is a semantic claim; false is a predicate we could not prove. */
export const checkCompletionState = (
  requirement: AgentTaskRequirement,
  observation: AgentObservation,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  quote: string | undefined,
  changes: readonly AgentStepReadout[] = []
): boolean | undefined => {
  const check = requirement.check
  if (!check) return undefined
  if (check.type === "url") return observation.url === check.url
  if (check.type === "control_transition")
    return checkControlTransition(requirement.id, check, observation, changes)
  if (check.type === "record_state") {
    const fact = groundedCompletionQuote(quote, requirement.id, ledger, true)
    if (!fact?.source) return false
    const frame = observation.frames.find(
      (entry) => entry.frameId === fact.source?.frameId
    )
    if (
      fact.source.tabId !== observation.tabId ||
      frame?.access !== "ok" ||
      frame.documentId !== fact.source.documentId ||
      frame.snapshotId !== fact.source.snapshotId ||
      frame.generation !== fact.source.generation
    )
      return false
    const record = escapePattern(agentNormalizedClaim(check.record))
    const status = observation.elements.some(
      (element) =>
        !element.sensitive &&
        (element.visible || element.offscreen) &&
        element.frameId === fact.source?.frameId &&
        same(element.name ?? "", fact.quote ?? "") &&
        (element.role === "status" || element.role === "alert")
    )
    if (!status) return undefined
    // Exact identity and asserted state together. "not saved" and another
    // row's status cannot satisfy this predicate. Other phrasing needs review.
    const said = agentNormalizedClaim(fact.quote ?? "")
    if (
      new RegExp(
        `^(?:${record}\\s*[:—–-]?\\s*(?:is\\s+)?${check.state}|${check.state}\\s*[:—–-]?\\s*${record})[.!]?$`,
        "u"
      ).test(said)
    )
      return true
    /**
     * A status naming the record and saying it failed contradicts the
     * check. Any other wording — "Order placed for Blue Kettle" against
     * "Blue Kettle order is submitted" — is a phrasing no rule here reads,
     * not a contradiction, and goes to review.
     */
    return new RegExp(`\\b${record}\\b`, "u").test(said) &&
      /\b(?:not|failed|failure|error|unable|could not|cannot|rejected|declined)\b/u.test(
        said
      )
      ? false
      : undefined
  }
  if (check.type === "row") {
    if (
      observation.elements.some(
        (element) =>
          !element.sensitive &&
          (element.visible || element.offscreen) &&
          (element.role === "row" ||
            element.role === "listitem" ||
            element.tag === "tr") &&
          same(element.name ?? "", check.record)
      )
    )
      return true
    return undefined
  }
  // rowContext is bounded whole-row text, not a distinct record label.
  // It cannot prove a scoped control belongs to the requested record.
  if (check.record) return undefined
  const candidates = observation.elements.filter(
    (element) =>
      !element.sensitive &&
      (element.visible || element.offscreen) &&
      (check.frameId === undefined || element.frameId === check.frameId)
  )
  /**
   * The control left with the page: a box ticked before Continue is not on
   * the page Continue opened. Its own confirmed write, recorded as holding
   * the planned value or state, stands for it there, and nothing else does.
   * Decided before a shortened name is read as a phrase, or "Email me the
   * terms" on the new page would answer for the "terms" box the run ticked
   * on the old one.
   */
  if (!candidates.some((element) => same(element.name ?? "", check.name))) {
    const left = plannedValueLeftBehind(
      requirement.id,
      check.name,
      changes,
      observation.url
    )
    if (left) return left === "credited"
  }
  const matches = namedBy(candidates, (element) => element.name, check.name)
  if (matches.length !== 1) return false
  const element = matches[0]
  /** The page rejected what the control holds; it does not hold it as asked. */
  if (element.invalid) return false
  if (check.type === "checked")
    return agentControlOnState(element) === check.checked
  if (element.valueTruncated) return false
  if (check.type === "selected")
    return element.options
      ? selectedOptionMatches(element, check.value)
      : ariaSelectionMatches(element, check.value)
  return element.value === check.value
}
