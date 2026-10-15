import {
  type AgentTaskConstraint,
  type AgentTaskRequirement,
  MAX_AGENT_REQUIREMENT_CHARS,
  MAX_AGENT_REQUIREMENT_SOURCE_CHARS
} from "@ollama-client/contracts"

/**
 * The values a user named in their own message, and whether a plan carries
 * them.
 *
 * The rest of planning refuses entries nobody asked for; this refuses the
 * opposite omission, which no quote check can see. "Enter Ada and select
 * Blue" planned as one requirement about the name is a plan every entry of
 * which is quoted, and a run that types Ada and stops would complete it. A
 * value is read only where the user plainly named one: inside quotation
 * marks, or as the object of a verb that sets a control. Everything else is
 * the planner's to read, because guessing at it here would add outcomes the
 * user never asked for. English verbs only; quotation marks work in any
 * language.
 */

export interface AgentNamedValue {
  /** The value as the user wrote it. */
  value: string
  /** The verb that named it, when one did. */
  verb?: string
  /** The user's clause it came from, for the requirement's source. */
  clause: string
}

const MAX_NAMED_VALUES = 8
const MAX_VALUE_CHARS = 80

const URLS = /\bhttps?:\/\/\S+|\bwww\.\S+/giu
const QUOTED = /["“”„«»「『]([^"“”„«»」』\n]{1,80})["“”«»」』]/gu
/** Single quotes only where no letter touches them, so "don't" is no quote. */
const SINGLE_QUOTED =
  /(?<![\p{L}\p{N}])['‘]([^'‘’\n]{1,80})['’](?![\p{L}\p{N}])/gu
const CLAUSE_END = /[.;:!?\n]/u
/** Where a verb's object stops: a joining word or the clause's end. */
const OBJECT_END =
  "(?=\\s+(?:and|then|but|or|as|in|into|on|for|from|with|under|before|after|so|if|when|to)\\b|[.,;:!?\\n]|$)"
const SET_TO = new RegExp(
  `\\bset\\s+(?:the\\s+)?[^.,;:!?\\n]{1,40}?\\s+to\\s+([^.,;:!?\\n]{1,${MAX_VALUE_CHARS}}?)${OBJECT_END}`,
  "giu"
)
const VERB_OBJECT = new RegExp(
  `\\b(select|choose|pick|enter|type|tick|toggle|switch on|switch off|turn on|turn off)\\s+([^.,;:!?\\n]{1,${MAX_VALUE_CHARS}}?)${OBJECT_END}`,
  "giu"
)
const LEADING_ARTICLE =
  /^(?:a|an|the|my|your|our|their|this|that|these|those|some)\s+/iu
/**
 * An object that opens like a question is a read ("check whether it ships"),
 * not a value, and the planner already words reads.
 */
const NOT_A_VALUE =
  /^(?:if|whether|what|which|how|when|where|who|why|it|them|that|this|out|up|on|off|of)\b/iu

/** A clause that asks for something to be found or reported. */
const READ_CUE =
  /^(?:find|look up|look for|tell me|show me|what|which|how|when|where|who|compare|read|get me|list)\b/iu

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "then",
  "its",
  "all",
  "any",
  "each",
  "one",
  "box",
  "field",
  "option",
  "button"
])

const normalized = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}$€£₹]+/gu, " ")
    .trim()

/** Numbers exactly; words of three letters or more, by shared prefix. */
const tokens = (text: string): string[] =>
  normalized(text)
    .split(" ")
    .filter(
      (word) =>
        /\p{N}/u.test(word) || (word.length >= 3 && !STOP_WORDS.has(word))
    )

const clauseAround = (text: string, index: number): string => {
  let start = index
  while (start > 0 && !CLAUSE_END.test(text[start - 1])) start -= 1
  let end = index
  while (end < text.length && !CLAUSE_END.test(text[end])) end += 1
  return text.slice(start, end).trim()
}

const cleanValue = (raw: string): string | undefined => {
  const value = raw.trim().replace(LEADING_ARTICLE, "").trim()
  if (!value || NOT_A_VALUE.test(value)) return undefined
  return tokens(value).length > 0 ? value : undefined
}

/** What the user named, in order, without the addresses they pasted. */
export const agentNamedValues = (utterance: string): AgentNamedValue[] => {
  const text = utterance.replace(URLS, (url) => " ".repeat(url.length))
  const found: AgentNamedValue[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined, index: number, verb?: string) => {
    if (!value) return
    const key = normalized(value)
    if (seen.has(key)) return
    seen.add(key)
    found.push({
      value: value.slice(0, MAX_VALUE_CHARS),
      ...(verb ? { verb: verb.toLowerCase() } : {}),
      clause: clauseAround(text, index)
    })
  }
  const matches: { index: number; value?: string; verb?: string }[] = []
  for (const pattern of [QUOTED, SINGLE_QUOTED])
    for (const match of text.matchAll(pattern))
      matches.push({ index: match.index, value: cleanValue(match[1]) })
  for (const match of text.matchAll(SET_TO))
    matches.push({
      index: match.index,
      value: cleanValue(match[1]),
      verb: "set"
    })
  for (const match of text.matchAll(VERB_OBJECT)) {
    /** A quoted object is already counted as a quotation. */
    if (/^["“”„«»「『'‘]/u.test(match[2].trim())) continue
    matches.push({
      index: match.index,
      value: cleanValue(match[2]),
      verb: match[1]
    })
  }
  for (const match of matches.sort((a, b) => a.index - b.index))
    add(match.value, match.index, match.verb)
  return found.slice(0, MAX_NAMED_VALUES)
}

const planText = (
  requirements: readonly AgentTaskRequirement[],
  constraints: readonly AgentTaskConstraint[]
): Set<string> =>
  new Set(
    tokens(
      [
        ...requirements.flatMap((requirement) => [
          requirement.text,
          ...(requirement.items ?? []),
          ...(requirement.check
            ? Object.values(requirement.check).filter(
                (value): value is string => typeof value === "string"
              )
            : [])
        ]),
        ...constraints.map((constraint) => constraint.text)
      ].join(" ")
    )
  )

const tokenIn = (token: string, plan: ReadonlySet<string>): boolean => {
  if (/\p{N}/u.test(token)) return plan.has(token)
  for (const word of plan)
    if (
      !/\p{N}/u.test(word) &&
      (word.startsWith(token) || token.startsWith(word))
    )
      return true
  return false
}

/** The named values no requirement, item, check or limit of the plan names. */
export const agentUncoveredValues = (
  utterance: string,
  requirements: readonly AgentTaskRequirement[],
  constraints: readonly AgentTaskConstraint[]
): AgentNamedValue[] => {
  const plan = planText(requirements, constraints)
  return agentNamedValues(utterance).filter(
    (named) => !tokens(named.value).every((token) => tokenIn(token, plan))
  )
}

/** What the planner is told when it left a named value out. */
export const agentCoverageFeedback = (
  missing: readonly AgentNamedValue[]
): string =>
  `The user's message names ${missing
    .map((named) => `"${named.value}"`)
    .join(
      ", "
    )}, and no requirement or constraint in your plan mentions ${missing.length === 1 ? "it" : "them"}. Return the whole plan again with an outcome for each, quoting the user's message in source, unless the user's message plainly says it is not part of this task.`

/**
 * The requirement a named value becomes when the planner left it out twice:
 * the user's verb and value, resting on the clause they wrote it in. It has
 * no check, so nothing deterministic can complete it; the run has to show it
 * was done like any other outcome.
 */
export const agentCoverageRequirement = (
  named: AgentNamedValue,
  id: string
): AgentTaskRequirement => ({
  id,
  text: (named.verb
    ? `${named.verb} ${named.value}`
    : `${named.clause || named.value}`
  ).slice(0, MAX_AGENT_REQUIREMENT_CHARS),
  kind: !named.verb && READ_CUE.test(named.clause) ? "read" : "change",
  source: (named.clause || named.value).slice(
    0,
    MAX_AGENT_REQUIREMENT_SOURCE_CHARS
  ),
  origin: "coverage"
})
