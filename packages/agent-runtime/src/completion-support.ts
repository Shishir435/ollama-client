import type {
  AgentEvidenceRecord,
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { agentNormalizedClaim } from "./observed-text"

const same = (a: string, b: string) =>
  agentNormalizedClaim(a) === agentNormalizedClaim(b)
const escapePattern = (text: string) =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
const namesRecord = (text: string | undefined, record: string) =>
  new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapePattern(agentNormalizedClaim(record))}(?:$|[^\\p{L}\\p{N}])`,
    "u"
  ).test(agentNormalizedClaim(text ?? ""))

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

/** Undefined is a semantic claim; false is a predicate we could not prove. */
export const checkCompletionState = (
  requirement: AgentTaskRequirement,
  observation: AgentObservation,
  ledger: readonly AgentEvidenceRecord[] | undefined,
  quote: string | undefined
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
        (element.role === "status" ||
          element.role === "alert" ||
          namesRecord(element.rowContext, check.record))
    )
    if (!status) return undefined
    // Exact identity and asserted state together. "not saved" and another
    // row's status cannot satisfy this predicate. Other phrasing needs review.
    return new RegExp(
      `^(?:${record}\\s*[:—–-]?\\s*(?:is\\s+)?${check.state}|${check.state}\\s*[:—–-]?\\s*${record})[.!]?$`,
      "u"
    ).test(agentNormalizedClaim(fact.quote ?? ""))
  }
  if (check.type === "row")
    return observation.elements.some(
      (element) =>
        !element.sensitive &&
        (element.visible || element.offscreen) &&
        (namesRecord(element.rowContext, check.record) ||
          ((element.role === "row" ||
            element.role === "listitem" ||
            element.tag === "tr") &&
            same(element.name ?? "", check.record)))
    )
  const matches = observation.elements.filter(
    (element) =>
      !element.sensitive &&
      (element.visible || element.offscreen) &&
      same(element.name ?? "", check.name) &&
      (check.frameId === undefined || element.frameId === check.frameId) &&
      (!check.record || namesRecord(element.rowContext, check.record))
  )
  if (matches.length !== 1) return false
  const element = matches[0]
  if (check.type === "checked") return element.checked === check.checked
  if (element.valueTruncated || element.value !== check.value) return false
  return (
    check.type !== "selected" ||
    element.options?.some(
      (option) => option.value === check.value && !option.disabled
    ) === true
  )
}
