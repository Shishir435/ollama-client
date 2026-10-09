import type {
  AgentEvidenceRecord,
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { agentNormalizedClaim } from "./observed-text"
import type { AgentStepReadout } from "./ports"

const same = (a: string, b: string) =>
  agentNormalizedClaim(a) === agentNormalizedClaim(b)
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
    sensitive?: boolean
  }[],
  verification: { outcome: string; evidence: { kind: string } }
): boolean => {
  const check = requirement?.check
  if (
    !check ||
    (check.type !== "field" && check.type !== "selected") ||
    check.record ||
    verification.outcome !== "confirmed" ||
    !FIELD_WRITE_KINDS.has(verification.evidence.kind)
  )
    return false
  const named = targets.filter(
    (target) =>
      target.accessibleName !== undefined &&
      same(target.accessibleName, check.name)
  )
  return (
    named.length === 1 &&
    !named[0].sensitive &&
    named[0].expectedValue === check.value
  )
}

/** Whether a confirmed write of either shape set a control of this name. */
const writesControlNamed = (step: AgentStepReadout, name: string): boolean => {
  const evidence = step.verification?.evidence
  if (evidence?.kind === "field")
    return step.target?.name !== undefined && same(step.target.name, name)
  return (
    evidence?.kind === "fields" &&
    (evidence.fields ?? []).some(
      (field) => field.name !== undefined && same(field.name, name)
    )
  )
}

/**
 * A control the run filled and then moved on from is not on the page it moved
 * to. Its absence contradicts nothing when the run's last write to a control
 * of that name was verified holding exactly the planned value and a confirmed
 * change came after it: the page left because the run left it. A later write
 * to the same name replaces the earlier one, so a value cleared or retyped
 * before leaving is never credited.
 */
const plannedValueLeftBehind = (
  requirementId: string,
  name: string,
  changes: readonly AgentStepReadout[]
): boolean => {
  let last = -1
  for (const [index, step] of changes.entries())
    if (writesControlNamed(step, name)) last = index
  if (last < 0) return false
  const write = changes[last]
  return (
    write.heldPlannedValue === true &&
    write.requirementId === requirementId &&
    changes
      .slice(last + 1)
      .some((later) => later.verification?.outcome === "confirmed")
  )
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
    return new RegExp(
      `^(?:${record}\\s*[:—–-]?\\s*(?:is\\s+)?${check.state}|${check.state}\\s*[:—–-]?\\s*${record})[.!]?$`,
      "u"
    ).test(agentNormalizedClaim(fact.quote ?? ""))
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
  const matches = observation.elements.filter(
    (element) =>
      !element.sensitive &&
      (element.visible || element.offscreen) &&
      same(element.name ?? "", check.name) &&
      (check.frameId === undefined || element.frameId === check.frameId)
  )
  if (
    matches.length === 0 &&
    check.type !== "checked" &&
    plannedValueLeftBehind(requirement.id, check.name, changes)
  )
    return true
  if (matches.length !== 1) return false
  const element = matches[0]
  if (check.type === "checked") return element.checked === check.checked
  if (element.valueTruncated) return false
  if (check.type === "selected")
    return selectedOptionMatches(element, check.value)
  return element.value === check.value
}
