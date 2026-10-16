import type {
  AgentEvidenceRecord,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import type { AgentCompletionOutcomeClaim } from "./completion"
import { groundedCompletionQuote } from "./completion-support"
import { agentNormalizedClaim } from "./observed-text"
import { agentTextNamesRecord } from "./row-context"

/**
 * One thing the run gathered for one item of a planned read: the item, the
 * quote the page showed for it, the number that quote holds, and the ledger
 * record that grounds it. A record exists only where the quote is one the
 * runtime itself read — the model's mapping of a quote to its item is its
 * own, but the words and the number are the page's.
 */
export interface AgentCollectedRecord {
  requirementId: string
  itemIndex: number
  item: string
  quote: string
  /** The one number the quote holds besides any in the item's own name. */
  value?: number
  ledgerId: string
  origin?: string
  observedAt: number
}

/** The most records one run's table holds; one per planned item at most. */
export const MAX_AGENT_COLLECTED_RECORDS = 40

/**
 * The one number a quote states, or none when it states several or none.
 * Digits inside the item's own name ("Invoice 2", "Plan 3") are not the
 * value. Thousands separators are read as such only in groups of three.
 */
export const agentQuotedValue = (
  quote: string,
  item?: string
): number | undefined => {
  let text = quote
  if (item) {
    const name = item.trim()
    if (name) text = text.split(name).join(" ")
  }
  const numbers = [
    ...text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)
  ].map((match) => Number(match[0].replaceAll(",", "")))
  const distinct = [...new Set(numbers.filter(Number.isFinite))]
  return distinct.length === 1 ? distinct[0] : undefined
}

/**
 * The table, built from the run's own claim and its grounded ledger: for
 * every item of a planned read the run says it met, the grounded quote it
 * cited. Kept apart from the prompt history, which is trimmed, so a price
 * read on the first of three sites is still here when the third is read.
 */
export const agentCollectedRecords = (
  requirements: readonly AgentTaskRequirement[],
  claims: readonly AgentCompletionOutcomeClaim[] | undefined,
  ledger: readonly AgentEvidenceRecord[] | undefined
): AgentCollectedRecord[] => {
  const byId = new Map((claims ?? []).map((claim) => [claim.id, claim]))
  const records: AgentCollectedRecord[] = []
  for (const requirement of requirements) {
    if (requirement.kind !== "read" || !requirement.items?.length) continue
    for (const answer of byId.get(requirement.id)?.items ?? []) {
      const item = requirement.items[answer.index]
      const quote = answer.evidence?.trim()
      if (!answer.met || item === undefined || !quote) continue
      const fact = groundedCompletionQuote(quote, requirement.id, ledger)
      if (!fact) continue
      const value = agentQuotedValue(quote, item)
      records.push({
        requirementId: requirement.id,
        itemIndex: answer.index,
        item,
        quote,
        ...(value !== undefined ? { value } : {}),
        ledgerId: fact.id,
        ...(fact.source ? { origin: fact.source.origin } : {}),
        observedAt: fact.observedAt
      })
    }
  }
  return records.slice(0, MAX_AGENT_COLLECTED_RECORDS)
}

const LOWEST =
  /\b(?:cheapest|lowest|least expensive|smallest|fewest|minimum|least)\b/i
const HIGHEST =
  /\b(?:most expensive|highest|largest|biggest|most|maximum|greatest)\b/i

/**
 * What a superlative read asks for, computed from the table rather than
 * taken from the model: the item whose collected value is lowest or
 * highest. Only when the question reads as one direction, one itemized read
 * covers at least two items, every one of its items has a number, and the
 * winner is unique — anything less is not a computation, and the read stays
 * with the reviewer.
 */
export const agentComparedAnswer = (
  requirement: AgentTaskRequirement,
  collected: readonly AgentCollectedRecord[],
  requirements: readonly AgentTaskRequirement[]
): AgentCollectedRecord | undefined => {
  if (requirement.kind !== "read" || requirement.items?.length) return undefined
  const lowest = LOWEST.test(requirement.text)
  const highest = HIGHEST.test(requirement.text)
  if (lowest === highest) return undefined
  const sources = requirements.filter(
    (entry) => entry.kind === "read" && (entry.items?.length ?? 0) >= 2
  )
  if (sources.length !== 1) return undefined
  const source = sources[0]
  const rows = collected.filter((record) => record.requirementId === source.id)
  if (
    rows.length !== source.items?.length ||
    rows.some((record) => record.value === undefined)
  )
    return undefined
  const best = rows.reduce((winner, record) =>
    lowest
      ? (record.value as number) < (winner.value as number)
        ? record
        : winner
      : (record.value as number) > (winner.value as number)
        ? record
        : winner
  )
  return rows.filter((record) => record.value === best.value).length === 1
    ? best
    : undefined
}

/**
 * How an answer stands against the computed one: it names the winning item
 * (and, if it states a number, the winning number), it names another
 * collected item or the wrong number, or it names none of them.
 */
export const agentAnswerAgainstCompared = (
  answer: string | undefined,
  winner: AgentCollectedRecord,
  collected: readonly AgentCollectedRecord[]
): "agrees" | "disagrees" | "unrelated" => {
  const text = answer ? agentNormalizedClaim(answer) : ""
  if (!text) return "unrelated"
  if (agentTextNamesRecord(text, winner.item)) {
    /** The right item at the wrong price is not the computed answer. */
    const stated = agentQuotedValue(answer ?? "", winner.item)
    return stated === undefined || stated === winner.value
      ? "agrees"
      : "disagrees"
  }
  return collected.some(
    (record) =>
      record.requirementId === winner.requirementId &&
      record.item !== winner.item &&
      agentTextNamesRecord(text, record.item)
  )
    ? "disagrees"
    : "unrelated"
}
