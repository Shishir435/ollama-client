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
  /** Quotation marks explicitly delimit a literal, including criterion words. */
  quoted?: true
  /** The control explicitly bound to the value by "set … to …". */
  control?: string
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
  `\\bset\\s+(?:the\\s+)?([^.,;:!?\\n]{1,40}?)\\s+to\\s+([^.,;:!?\\n]{1,${MAX_VALUE_CHARS}}?)${OBJECT_END}`,
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
  /^(?:if|whether|what|which|how|when|where|who|why|it|them|that|this|out|up|on|off|of|and|then|or|but|to|wait)\b/iu

/**
 * A word before the verb that makes it a noun or a key: "account type",
 * "sort by type", "press Enter". The verb names a value only where it is
 * a command.
 */
const NOT_A_COMMAND =
  /(?:\b(?:the|a|an|by|of|press|hit|account|your|my|this|that|its|their|file|input|key|blood|data|field)\s+)$/iu

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
  "button",
  /**
   * Words that pick by a criterion rather than name a value: "pick the right
   * account" asks the run to find one, and the account it finds is the value.
   */
  "right",
  "correct",
  "best",
  "cheapest",
  "first",
  "last",
  "latest",
  "newest",
  "oldest",
  "appropriate",
  "matching"
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

/** Explicit assignments retain literal articles, punctuation and short codes. */
const assignmentValue = (raw: string): string | undefined =>
  raw.trim() || undefined

const literalValue = (value: string): string =>
  value.normalize("NFKC").replaceAll(/\s+/gu, " ").trim()

/** A prohibition names a forbidden assignment, not another requested value. */
const negatedCommand = (text: string, index: number): boolean =>
  /(?:\bdo\s+not|\bdon['’]?t|\bnever)(?:\s+[\p{L}-]+){0,2}\s+$/iu.test(
    text.slice(Math.max(0, index - 60), index)
  )

/** What the user named, in order, without the addresses they pasted. */
export const agentNamedValues = (utterance: string): AgentNamedValue[] => {
  const text = utterance.replace(URLS, (url) => " ".repeat(url.length))
  const found: AgentNamedValue[] = []
  const seen = new Map<string, AgentNamedValue>()
  const add = (
    value: string | undefined,
    index: number,
    verb?: string,
    control?: string,
    quoted = false
  ) => {
    if (!value) return
    const key = control
      ? `${normalized(control)}:${literalValue(value)}`
      : normalized(value)
    const existing = seen.get(key)
    if (existing) {
      if (quoted) existing.quoted = true
      return
    }
    const named: AgentNamedValue = {
      value: value.slice(0, MAX_VALUE_CHARS),
      ...(verb ? { verb: verb.toLowerCase() } : {}),
      ...(control ? { control } : {}),
      ...(quoted ? { quoted: true as const } : {}),
      clause: clauseAround(text, index)
    }
    found.push(named)
    seen.set(key, named)
  }
  const matches: {
    index: number
    value?: string
    verb?: string
    control?: string
    quoted?: true
  }[] = []
  for (const pattern of [QUOTED, SINGLE_QUOTED])
    for (const match of text.matchAll(pattern)) {
      const assignment =
        /\bset\s+(?:the\s+)?((?:(?!\bset\b)[^.,;:!?\n]){1,40}?)\s+to\s*$/iu.exec(
          text.slice(0, match.index)
        )
      const command =
        /\b(select|choose|pick|enter|type|tick|toggle|switch on|switch off|turn on|turn off)\s*$/iu.exec(
          text.slice(0, match.index)
        )
      if (assignment && negatedCommand(text, assignment.index)) continue
      if (
        command &&
        (negatedCommand(text, command.index) ||
          NOT_A_COMMAND.test(text.slice(0, command.index)))
      )
        continue
      matches.push({
        index: match.index,
        quoted: true,
        value:
          assignment || command
            ? assignmentValue(match[1])
            : cleanValue(match[1]),
        ...(assignment
          ? { verb: "set", control: assignment[1].trim() }
          : command
            ? { verb: command[1] }
            : {})
      })
    }
  for (const match of text.matchAll(SET_TO)) {
    if (negatedCommand(text, match.index)) continue
    // Quoted values are read whole above, including punctuation inside them.
    if (/^["“”„«»「『'‘]/u.test(match[2].trim())) continue
    const rest = text.slice(match.index + match[0].length)
    // A comma or period may belong to an unquoted date, address or decimal.
    // Keep the old value-coverage check, but do not assert a literal binding
    // from that incomplete prefix. Quoted values above have no such ambiguity.
    const incomplete =
      /^[.,]\S|^[.,]\s+\S/u.test(rest) &&
      !/^\.\s+(?:set|enter|select|do not|don['’]?t|never)\b/iu.test(rest)
    matches.push({
      index: match.index,
      value: assignmentValue(match[2]),
      verb: "set",
      ...(incomplete ? {} : { control: match[1].trim() })
    })
  }
  for (const match of text.matchAll(VERB_OBJECT)) {
    /** A quoted object is already counted as a quotation. */
    if (/^["“”„«»「『'‘]/u.test(match[2].trim())) continue
    if (NOT_A_COMMAND.test(text.slice(0, match.index))) continue
    if (negatedCommand(text, match.index)) continue
    matches.push({
      index: match.index,
      value: cleanValue(match[2]),
      verb: match[1]
    })
  }
  for (const match of matches.sort((a, b) => a.index - b.index))
    add(match.value, match.index, match.verb, match.control, match.quoted)
  return found.slice(0, MAX_NAMED_VALUES)
}

/** A typed predicate may not swap a value explicitly assigned to its control. */
export const agentControlValueConflicts = (
  sources: string | readonly string[],
  control: string,
  value: string
): boolean => {
  const texts = typeof sources === "string" ? [sources] : sources
  // Later user answers may replace an earlier value for the same control.
  for (const source of [...texts].reverse()) {
    const assignments = agentNamedValues(source).filter(
      (named) =>
        named.control && normalized(named.control) === normalized(control)
    )
    if (assignments.length > 0)
      return !assignments.some(
        (named) => literalValue(named.value) === literalValue(value)
      )
  }
  return false
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

/**
 * The same word, or the same word inflected: a shared stem of five letters or
 * more ("select" and "selected"). A shorter prefix is not the word —
 * "blueprint" does not name Blue, and "exp" does not name Express — and
 * reading it as one would cover a value nothing tracks.
 */
const tokenIn = (token: string, plan: ReadonlySet<string>): boolean => {
  if (plan.has(token)) return true
  if (/\p{N}/u.test(token) || token.length < 5) return false
  for (const word of plan)
    if (
      !/\p{N}/u.test(word) &&
      word.length >= 5 &&
      word.slice(0, 5) === token.slice(0, 5) &&
      Math.abs(word.length - token.length) <= 3
    )
      return true
  return false
}

/** The named values no requirement, item, check or limit of the plan names. */
export const agentUncoveredValues = (
  utterance: string,
  requirements: readonly AgentTaskRequirement[],
  constraints: readonly AgentTaskConstraint[],
  laterUserTexts: readonly string[] = []
): AgentNamedValue[] => {
  const plan = planText(requirements, constraints)
  const texts = [utterance, ...laterUserTexts].map(agentNamedValues)
  const latestAssignment = new Map<string, number>()
  for (const [index, values] of texts.entries())
    for (const named of values)
      if (named.control) latestAssignment.set(normalized(named.control), index)
  const namedValues = texts.flatMap((values, index) =>
    values.filter(
      (named) =>
        !named.control ||
        latestAssignment.get(normalized(named.control)) === index
    )
  )
  return namedValues.filter((named) => {
    const control = named.control
    if (!control) {
      // An unbound "set" value is an ambiguous punctuation prefix (for
      // example "$1" from "$1,000"); retain its existing token coverage.
      if (
        !named.verb ||
        named.verb === "set" ||
        (!named.quoted &&
          /^(?:right|correct|best|cheapest|first|last|latest|newest|oldest|appropriate|matching)\b/iu.test(
            named.value
          ))
      )
        return !tokens(named.value).every((token) => tokenIn(token, plan))
      // A typed check covers its own value, not every value mentioned in the
      // requirement's prose. A limit is not affirmative work either.
      return !requirements.some((requirement) => {
        if (requirement.kind !== "change") return false
        const check = requirement.check
        if (check?.type === "field" || check?.type === "selected")
          return literalValue(check.value) === literalValue(named.value)
        if (named.quoted)
          return [requirement.text, ...(requirement.items ?? [])].some((text) =>
            ` ${normalized(text)} `.includes(` ${normalized(named.value)} `)
          )
        const words = planText([requirement], [])
        return tokens(named.value).every((token) => tokenIn(token, words))
      })
    }
    // A value elsewhere in the plan cannot cover this control's assignment.
    return !requirements.some((requirement) => {
      const words = planText([requirement], [])
      const namesControl = (text: string) => {
        const controlTokens = tokens(control)
        return controlTokens.length > 0
          ? controlTokens.every((token) =>
              tokenIn(token, new Set(tokens(text)))
            )
          : ` ${normalized(text)} `.includes(` ${normalized(control)} `)
      }
      if (
        !namesControl(
          [requirement.text, ...(requirement.items ?? [])].join(" ") +
            " " +
            (requirement.check && "name" in requirement.check
              ? requirement.check.name
              : "")
        )
      )
        return false
      const check = requirement.check
      if (check?.type === "field" || check?.type === "selected")
        return (
          literalValue(check.value) === literalValue(named.value) &&
          namesControl(check.name)
        )
      const valueTokens = tokens(named.value)
      return valueTokens.length > 0
        ? valueTokens.every((token) => tokenIn(token, words))
        : normalized(named.value)
          ? ` ${normalized(requirement.text)} `.includes(
              ` ${normalized(named.value)} `
            )
          : literalValue(requirement.text).includes(literalValue(named.value))
    })
  })
}

/** What the planner is told when it left a named value out. */
export const agentCoverageFeedback = (
  missing: readonly AgentNamedValue[]
): string =>
  `The user's message names ${missing
    .map(
      (named) =>
        `"${named.value}"${named.control ? ` for "${named.control}"` : ""}`
    )
    .join(
      ", "
    )}, and your plan does not cover ${missing.length === 1 ? "it" : "them"} with the requested control/value relationships. Return the whole plan again with an outcome for each, quoting the user's message in source. If one belongs to the chat conversation rather than this browser task, list it exactly in notForBrowser instead.`

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
    ? `${named.verb} ${named.control ? `${named.control} to ` : ""}${named.value}`
    : `${named.clause || named.value}`
  ).slice(0, MAX_AGENT_REQUIREMENT_CHARS),
  kind: !named.verb && READ_CUE.test(named.clause) ? "read" : "change",
  source: (named.clause || named.value).slice(
    0,
    MAX_AGENT_REQUIREMENT_SOURCE_CHARS
  ),
  origin: "coverage"
})

/**
 * Outcomes about tabs that the user's own words state, and a plan must carry
 * as change requirements: opening into a tab of its own, leaving tabs open,
 * returning to the tab the user began on. Each is state the browser reports
 * and the judge checks from the run's tab list, but only a requirement is
 * judged. A planner filed "open every source link in a separate tab and
 * leave the source tabs open" as a scope constraint, and the run was never
 * asked to do either.
 */
const TAB_OUTCOMES = [
  /\bopen\b[^.,;:!?\n]*?\bin\s+(?:a\s+|an\s+|its\s+own\s+|their\s+own\s+)?(?:new|separate|another|own|different)\s+(?:browser\s+)?tabs?\b/giu,
  /\b(?:leave|keep)\b[^.,;:!?\n]*?\btabs?\b[^.,;:!?\n]*?\bopen\b/giu,
  /\b(?:return|go\s+back|switch\s+back|come\s+back)\b[^.,;:!?\n]*?\b(?:home|original|first|starting|start|initial|main)\s+(?:browser\s+)?tab\b/giu
]

/**
 * "Don't open it in a new tab" states no outcome to carry, nor "Don’t open"
 * with a typographic apostrophe, nor "do not automatically open": up to two
 * words may stand between the negation and the verb, within the clause.
 */
const NEGATED_BEFORE =
  /(?:^|[^\p{L}])(?:not|don['’]t|dont|never|no|without)(?:\s+[\p{L}-]+){0,2}\s+$/iu

/**
 * The tab outcomes the user's message states that no change requirement of
 * the plan states, each as the user's words. A constraint does not carry
 * one: it is never judged as met.
 */
export const agentUncoveredTabOutcomes = (
  utterance: string,
  requirements: readonly AgentTaskRequirement[]
): string[] =>
  TAB_OUTCOMES.flatMap((pattern) => {
    const covered = requirements.some((requirement) => {
      pattern.lastIndex = 0
      return requirement.kind === "change" && pattern.test(requirement.text)
    })
    if (covered) return []
    /** `matchAll` starts where the last `test` left off. */
    pattern.lastIndex = 0
    return [...utterance.matchAll(pattern)]
      .filter(
        (match) =>
          !NEGATED_BEFORE.test(
            utterance
              .slice(Math.max(0, match.index - 40), match.index)
              .split(/[.,;:!?\n]/u)
              .at(-1) ?? ""
          )
      )
      .slice(0, 1)
      .map((match) => match[0].trim())
  })

/** What the planner is told when it left a tab outcome out. */
export const agentTabCoverageFeedback = (missing: readonly string[]): string =>
  `The user's message asks for ${missing
    .map((outcome) => `"${outcome}"`)
    .join(
      ", "
    )}, and no change requirement in your plan states it. Which tabs are open is checked from the browser only for a requirement, never a constraint. Return the whole plan again with a change requirement for each, quoting the user's message in source.`

/** A tab outcome the planner left out twice, in the user's own words. */
export const agentTabCoverageRequirement = (
  outcome: string,
  id: string
): AgentTaskRequirement => ({
  id,
  text: outcome.slice(0, MAX_AGENT_REQUIREMENT_CHARS),
  kind: "change",
  source: outcome.slice(0, MAX_AGENT_REQUIREMENT_SOURCE_CHARS),
  origin: "coverage"
})
