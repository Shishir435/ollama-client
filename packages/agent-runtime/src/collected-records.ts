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

/** Letters and digits in any script: what a name boundary must not touch. */
const WORD = /[\p{L}\p{N}_]/u

/** `text` with every whole-word occurrence of `name` blanked out. */
const withoutName = (text: string, name: string): string => {
  const needle = name.trim().toLocaleLowerCase()
  if (!needle) return text
  const lower = text.toLocaleLowerCase()
  let out = ""
  let from = 0
  let at = lower.indexOf(needle)
  while (at !== -1) {
    const before = lower[at - 1]
    const after = lower[at + needle.length]
    if (
      (before === undefined || !WORD.test(before)) &&
      (after === undefined || !WORD.test(after))
    ) {
      out += `${text.slice(from, at)} `
      from = at + needle.length
    }
    at = lower.indexOf(needle, at + 1)
  }
  return out + text.slice(from)
}

/**
 * Every distinct number a text states, signed. Digits inside the item's own
 * name ("Invoice 2", "Plan 3") are not values, and the name is matched as a
 * whole word, so "Plan 3" leaves "Plan 30" alone. A minus is a sign only
 * where it stands before the number on its own — "-10", "(−4)" — never the
 * hyphen of an id such as ORD-1042 or a range such as 10-20. Thousands
 * separators count only in groups of three.
 */
export const agentQuotedNumbers = (text: string, item?: string): number[] => {
  const rest = item ? withoutName(text, item) : text
  const numbers: number[] = []
  for (const match of rest.matchAll(
    /([-\u2212])?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g
  )) {
    const index = match.index ?? 0
    const sign = match[1] !== undefined
    const before = rest[index - 1]
    const signed = sign && (before === undefined || !WORD.test(before))
    /** A digit run glued to a word (ORD-1042, 4K) is part of a name. */
    const glued = !sign && before !== undefined && WORD.test(before)
    if (glued) continue
    if (sign && !signed && before !== undefined && /\p{L}/u.test(before))
      continue
    const value = Number(match[2].replaceAll(",", ""))
    if (Number.isFinite(value)) numbers.push(signed ? -value : value)
  }
  return [...new Set(numbers)]
}

/** The one number a quote states, or none when it states several or none. */
export const agentQuotedValue = (
  quote: string,
  item?: string
): number | undefined => {
  const numbers = agentQuotedNumbers(quote, item)
  return numbers.length === 1 ? numbers[0] : undefined
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
  /\b(?:most expensive|priciest|highest|largest|biggest|most|maximum|greatest)\b/i
/** The words that name a price, for a superlative that implies one. */
const PRICE_WORDS = [
  "price",
  "cost",
  "charge",
  "fee",
  "fare",
  "rate",
  "credit",
  "dollar",
  "euro",
  "pound",
  "rupee",
  "yen"
]

/**
 * The other eight locales' words, as stems. A stem in a spaced script must
 * begin a word and may run on, so one stem covers its inflections
 * ("günstigste", "günstigsten"); Japanese and Chinese have no word edge, so
 * theirs match where they stand. The first two lists name a price by
 * themselves, as "cheapest" does.
 */
const localeStems = (spaced: readonly string[], unspaced: readonly string[]) =>
  new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(?:${spaced.join("|")})|${unspaced.join("|")}`,
    "iu"
  )
const LOCALE_CHEAPEST = localeStems(
  [
    "günstigst",
    "billigst",
    "preiswertest",
    "más barat",
    "moins ch[eè]re?",
    "più economic",
    "meno car(?:o|a|i|e)(?![\\p{L}])",
    "самы\\p{L}* деш[её]в",
    "дешевле всего",
    "सबसे सस्त"
  ],
  ["最安", "一番安", "最も安", "いちばん安", "最便宜"]
)
const LOCALE_PRICIEST = localeStems(
  [
    "teuerst",
    "más car(?:o|a|os|as)(?![\\p{L}])",
    "plus ch[eè]re?",
    "più car(?:o|a|i|e)(?![\\p{L}])",
    "самы\\p{L}* дорог",
    "дороже всего",
    "सबसे महंग",
    "सबसे मँहग"
  ],
  ["最も高価", "一番高価", "最贵"]
)
const LOCALE_LOWEST = localeStems(
  [
    "niedrigst",
    "kleinst",
    "wenigst",
    "geringst",
    "más baj",
    "menor",
    "mínim",
    "plus bas",
    "plus petit",
    "più bass",
    "minor",
    "minim",
    "наименьш",
    "минимальн",
    "самы\\p{L}* низк",
    "самы\\p{L}* мал",
    "सबसे कम",
    "न्यूनतम"
  ],
  ["最低", "最小", "最少", "一番低", "最も低", "一番少な", "最も少な"]
)
const LOCALE_HIGHEST = localeStems(
  [
    "höchst",
    "größt",
    "meist",
    "más alt",
    "mayor",
    "máxim",
    "plus élevé",
    "plus haut",
    "plus grand",
    "più alt",
    "maggior",
    "massim",
    "наибольш",
    "максимальн",
    "самы\\p{L}* высок",
    "самы\\p{L}* больш",
    "सबसे ज़्याद",
    "सबसे ज्याद",
    "सबसे अधिक",
    "अधिकतम",
    "सबसे बड़"
  ],
  ["最高", "最大", "最多", "一番高", "最も高", "一番多", "最も多"]
)
const LOCALE_PRICE = localeStems(
  [
    "preis",
    "kosten",
    "kostet",
    "gebühr",
    "tarif",
    "precio",
    "coste",
    "costo",
    "cuota",
    "prix",
    "coût",
    "frais",
    "prezz",
    "цен(?:а|ы|у|ой|е|ам|ами|ах)?(?![\\p{L}])",
    "стоимост",
    "рубл",
    "कीमत",
    "दाम",
    "मूल्य",
    "शुल्क",
    "रुपय",
    "रुपए"
  ],
  [
    "価格",
    "値段",
    "料金",
    "費用",
    "円",
    "价格",
    "价钱",
    "价位",
    "售价",
    "单价",
    "费用"
  ]
)

/** Which direction a question's superlative asks for, in any locale. */
const directionOf = (text: string) => ({
  lowest:
    LOWEST.test(text) || LOCALE_CHEAPEST.test(text) || LOCALE_LOWEST.test(text),
  highest:
    HIGHEST.test(text) ||
    LOCALE_PRICIEST.test(text) ||
    LOCALE_HIGHEST.test(text)
})

/**
 * What a superlative compares: price for "cheapest" or "most expensive",
 * otherwise the word after the superlative ("highest rating" is rating).
 * The other locales put the measure on either side of the superlative
 * ("el precio más bajo", "最も安い価格"), so there a price word anywhere in
 * the question names price, and any other measure is not read. Undefined
 * when the question names no measure, which leaves it to review.
 */
const measureOf = (text: string): readonly string[] | undefined => {
  if (/\b(?:cheapest|least expensive|most expensive|priciest)\b/i.test(text))
    return PRICE_WORDS
  if (LOCALE_CHEAPEST.test(text) || LOCALE_PRICIEST.test(text))
    return PRICE_WORDS
  const named =
    /\b(?:highest|lowest|largest|smallest|biggest|greatest|most|fewest|least|maximum|minimum)\s+([\p{L}]{3,})/iu.exec(
      text
    )?.[1]
  if (!named) return LOCALE_PRICE.test(text) ? PRICE_WORDS : undefined
  const word = named.toLocaleLowerCase()
  return PRICE_WORDS.some((entry) => word === entry || word === `${entry}s`)
    ? PRICE_WORDS
    : [word]
}

/** Whether a read's own text says it measures one of `measure`'s words. */
const measures = (text: string, measure: readonly string[]): boolean => {
  if (measure === PRICE_WORDS && LOCALE_PRICE.test(text)) return true
  const words = text.toLocaleLowerCase().split(/[^\p{L}\p{M}]+/u)
  return measure.some((entry) => {
    const stem = entry.slice(0, Math.max(4, entry.length - 2))
    return words.some((word) => word.startsWith(stem))
  })
}

/**
 * What a superlative read asks for, computed from the table rather than
 * taken from the model: the item whose collected value is lowest or
 * highest. Only when the question reads as one direction over a measure
 * the one itemized read covering at least two items says it collected,
 * every one of its items has a number, and the winner is unique — anything
 * less is not a computation, and the read stays with the reviewer. A plan
 * that collected prices cannot answer "which has the highest rating" from
 * them.
 */
export const agentComparedAnswer = (
  requirement: AgentTaskRequirement,
  collected: readonly AgentCollectedRecord[],
  requirements: readonly AgentTaskRequirement[]
): AgentCollectedRecord | undefined => {
  if (requirement.kind !== "read" || requirement.items?.length) return undefined
  const { lowest, highest } = directionOf(requirement.text)
  if (lowest === highest) return undefined
  const measure = measureOf(requirement.text)
  if (!measure) return undefined
  const sources = requirements.filter(
    (entry) => entry.kind === "read" && (entry.items?.length ?? 0) >= 2
  )
  if (sources.length !== 1) return undefined
  const source = sources[0]
  if (!measures(source.text, measure)) return undefined
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
 * A period ends a sentence unless a digit follows it, as in 35.50; so do
 * the full-width stops Japanese and Chinese write.
 */
const SENTENCES = /[;!?\n。！？；]+|\.(?!\d)/
/**
 * One entry of a list a sentence makes: a comma, an ideographic comma, or a
 * spaced "and" in any of the nine locales.
 */
const CLAUSES = /,\s+|[、，]\s*|\s+(?:and|und|y|et|e|и|और)\s+/iu

/**
 * The parts of an answer that speak of `item` alone: a sentence naming it
 * and no rival, or, in a sentence that lists several, the clauses from its
 * name up to the next item named ("Shop B at 35, Shop A at 41").
 */
const partsAbout = (
  answer: string,
  item: string,
  rivals: readonly string[]
): string[] => {
  const names = (text: string, name: string) => agentTextNamesRecord(text, name)
  return answer.split(SENTENCES).flatMap((sentence) => {
    if (!names(sentence, item)) return []
    if (!rivals.some((rival) => names(sentence, rival))) return [sentence]
    let subject: string | undefined
    return sentence.split(CLAUSES).filter((clause) => {
      if (names(clause, item)) subject = item
      else if (rivals.some((rival) => names(clause, rival))) subject = undefined
      return subject === item && !rivals.some((rival) => names(clause, rival))
    })
  })
}

/**
 * How an answer stands against the computed one.
 *
 * - `agrees`: it names the winning item, and the clauses about that item
 *   state exactly one number, the winning one.
 * - `disagrees`: those clauses state exactly one other number, or the
 *   answer names another collected item and not the winner.
 * - `named`: it names the winner but states no number for it — right as
 *   far as it goes, not a computed match for a question that also asked
 *   for the value.
 * - `unrelated`: anything else, including clauses stating several numbers
 *   ("Shop B costs 99 credits for 2 units"), which no rule here can read.
 */
export const agentAnswerAgainstCompared = (
  answer: string | undefined,
  winner: AgentCollectedRecord,
  collected: readonly AgentCollectedRecord[]
): "agrees" | "disagrees" | "named" | "unrelated" => {
  const text = answer ? agentNormalizedClaim(answer) : ""
  if (!text) return "unrelated"
  const rivals = collected.filter(
    (record) =>
      record.requirementId === winner.requirementId &&
      record.item !== winner.item
  )
  if (agentTextNamesRecord(text, winner.item)) {
    const about = partsAbout(
      answer ?? "",
      winner.item,
      rivals.map((record) => record.item)
    )
    const numbers = [
      ...new Set(about.flatMap((part) => agentQuotedNumbers(part, winner.item)))
    ]
    if (numbers.length === 0) return "named"
    if (numbers.length > 1) return "unrelated"
    return numbers[0] === winner.value ? "agrees" : "disagrees"
  }
  return rivals.some((record) => agentTextNamesRecord(text, record.item))
    ? "disagrees"
    : "unrelated"
}
