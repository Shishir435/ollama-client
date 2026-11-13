import type {
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import type { ResolvedAgentTarget } from "./ports"
import { agentTextNamesRecord } from "./row-context"

interface PriceLimit {
  cents: number
  unit: string
  basis: "night" | "day" | "item" | "total"
  inclusive: boolean
}
const amount =
  "(\\d+(?:\\.\\d{1,2})?)\\s+(credits?|USD|EUR|GBP)(?=\\s|$|[,;.!?])"
const period = "(?:\\s+(?:a|per)\\s+(night|day|item))?"
/**
 * Any displayed money, in any of the forms people write it: "$50", "USD 50",
 * "50 dollars". A second one in an offer may be a charge on top of the rate,
 * so it is counted even when its form could never satisfy a cap.
 */
const MONEY_MENTION =
  /[$€£¥₹]\s*\d|\b(?:USD|EUR|GBP)\s*\d|\d\s*(?:credits?|USD|EUR|GBP|dollars?|euros?|pounds?|bucks)\b/gi
/** A rate or recurrence the parser does not model: "per month", "/ guest". */
const UNREAD_RATE =
  /^\s*[([,;:–—-]?\s*(?:\/|(?:a|per|each|every)\s+\S|(?:nightly|daily|weekly|monthly|yearly|annually|hourly)\b)/i
const money = (value: string): number => {
  const [whole, fraction = ""] = value.split(".")
  // Parse the decimal digits as integer minor units; multiplying a decimal
  // float can lose a cent near the safe-integer boundary.
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
}
const unit = (value: string): string =>
  value.toLowerCase().replace(/^credits?$/, "credit")

/** Only a whole, unqualified clause has a deterministic monetary interpretation. */
export const agentPriceLimit = (text: string): PriceLimit | undefined => {
  const normalized = text
    .trim()
    .replace(/[.!]$/, "")
    .replaceAll("’", "'")
    .replaceAll(/\s+/g, " ")
  const negative = new RegExp(
    `^(?:do not|don't|never) (?:book|buy|purchase|pay|spend|reserve|order)(?: anything)? (?:over|above|more than) ${amount}${period}$`,
    "i"
  ).exec(normalized)
  const positive = new RegExp(
    `^(?:spend |pay )?(under|below|at most|no more than) ${amount}${period}$`,
    "i"
  ).exec(normalized)
  const match = negative ?? positive
  if (!match) return undefined
  const offset = negative ? 0 : 1
  const cents = money(match[1 + offset])
  if (!Number.isSafeInteger(cents) || cents <= 0) return undefined
  return {
    cents,
    unit: unit(match[2 + offset]),
    basis: (match[3 + offset]?.toLowerCase() as PriceLimit["basis"]) ?? "total",
    inclusive: !!negative || /^(at most|no more than)$/i.test(match[1])
  }
}

const clauses = (text: string) =>
  text
    .split(/\.(?=\s|$)|[!?;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)

/** A source can quote the surrounding request, but must contain exactly one cap. */
export const agentConstraintPriceLimit = (
  constraint: Pick<AgentTaskConstraint, "text" | "source">
): PriceLimit | undefined => {
  if (!constraint.source) return undefined
  const stated = agentPriceLimit(constraint.text)
  const source = clauses(constraint.source)
    .map(agentPriceLimit)
    .filter((cap) => cap !== undefined)
  return stated &&
    source.length === 1 &&
    JSON.stringify(stated) === JSON.stringify(source[0])
    ? stated
    : undefined
}

/** Visible control-scoped terms can check a cap; they never grant consent or prove a charge. */
export const agentPriceLimitHolds = (
  constraint: AgentTaskConstraint,
  target:
    | Pick<ResolvedAgentTarget, "offerScope" | "accessibleName">
    | undefined,
  requirement: AgentTaskRequirement | undefined,
  /**
   * The record the runtime computed the user's comparison to select ("book
   * the cheapest"), from grounded collected values; never the model's pick.
   */
  selected?: string
): boolean => {
  const cap = agentConstraintPriceLimit(constraint)
  const scope = target?.offerScope
  if (!cap || !scope || !scope.text.includes(scope.record)) return false
  if (!agentOfferBindsRequirement(scope.record, requirement, selected))
    return false
  // Multiple prices, extra charges and qualified rates need a human, not arithmetic.
  if (
    /\b(?:fees?|tax(?:es)?|deposit|from|starting|discount|excluding|extra|person|not|unavailable|estimate|estimated|approximately)\b/i.test(
      scope.text
    )
  )
    return false
  const amounts = [...scope.text.matchAll(new RegExp(amount, "gi"))]
  if (
    amounts.length !== 1 ||
    [...scope.text.matchAll(MONEY_MENTION)].length !== 1 ||
    unit(amounts[0][2]) !== cap.unit
  )
    return false
  /**
   * The label is a whole phrase ("Subtotal" is not "total"), and the price
   * must end where its unit or modelled period does: an unread "per month"
   * after it changes what the number means.
   */
  const price = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:nightly rate|price per night|daily rate|price per day|unit price|total)\\s*:\\s*${amount}(?:\\s+(?:a|per)\\s+(night|day|item))?`,
    "iu"
  ).exec(scope.text)
  if (!price) return false
  if (UNREAD_RATE.test(scope.text.slice(price.index + price[0].length)))
    return false
  const basis = /^(nightly|price per night)/i.test(price[0])
    ? "night"
    : /^(daily|price per day)/i.test(price[0])
      ? "day"
      : /^unit/i.test(price[0])
        ? "item"
        : "total"
  if (basis !== cap.basis || (price[3] && price[3].toLowerCase() !== basis))
    return false
  if (basis !== "total") {
    const countPattern = `\\b(one|two|three|four|five|six|seven|\\d+) ${basis}s?\\b`
    const requested = [
      ...(requirement?.source ?? "").matchAll(new RegExp(countPattern, "gi"))
    ]
    const fixedAction = new RegExp(
      `^(?:book|reserve|buy) (one|two|three|four|five|six|seven|\\d+) ${basis}s?$`,
      "i"
    ).exec(target?.accessibleName?.trim() ?? "")
    const action = fixedAction ? [fixedAction] : []
    const count = (value: string) =>
      ["one", "two", "three", "four", "five", "six", "seven"].indexOf(
        value.toLowerCase()
      ) + 1 || Number(value)
    if (
      requested.length !== 1 ||
      action.length !== 1 ||
      !Number.isSafeInteger(count(requested[0][1])) ||
      count(requested[0][1]) <= 0 ||
      count(requested[0][1]) !== count(action[0][1])
    )
      return false
  }
  const cents = money(price[1])
  return (
    Number.isSafeInteger(cents) &&
    (cap.inclusive ? cents <= cap.cents : cents < cap.cents)
  )
}

/**
 * Whether an offer is the one the step is about, proven rather than assumed.
 * Records the requirement names through its items or check must include it.
 * Otherwise the runtime's own comparison over grounded values, when it
 * selected one, decides ("book the cheapest"); without one, the requirement's
 * own words must name it ("book Garden Hotel"). That no other offer is named proves
 * nothing: a lone Other Hotel on the wrong page names no rival either. An
 * offer bound by none of these is unproven, and the cap refuses it.
 */
const agentOfferBindsRequirement = (
  record: string,
  requirement: AgentTaskRequirement | undefined,
  selected: string | undefined
): boolean => {
  const check = requirement?.check
  const named = [
    ...(requirement?.items ?? []),
    ...(check && "record" in check && check.record ? [check.record] : [])
  ]
  if (named.length > 0)
    return named.some((name) => agentTextNamesRecord(record, name))
  /**
   * A comparison winner outranks the words: "compare Garden and Other, then
   * book the cheapest" names both candidates but selects only one.
   */
  if (selected !== undefined)
    return (
      agentTextNamesRecord(record, selected) ||
      agentTextNamesRecord(selected, record)
    )
  return [requirement?.text, requirement?.source].some((text) =>
    agentTextNamesRecord(text, record)
  )
}

/**
 * Unknown money bounds still stop possible commits, even without model effect
 * flags: "under USD 120" or "120 dollars a night" is a cap the price check
 * cannot read, so it refuses rather than letting the step past unbounded.
 */
export const agentMonetaryConstraint = (
  constraint: AgentTaskConstraint
): boolean =>
  constraint.kind === "limit" &&
  /\d(?:[\d,]*\d)?(?:\.\d+)?\s*(?:credits?|USD|EUR|GBP|dollars?|euros?|pounds?|bucks)\b|\b(?:USD|EUR|GBP|credits?)\s*\d|[$€£¥₹]\s*\d/i.test(
    constraint.text
  )
