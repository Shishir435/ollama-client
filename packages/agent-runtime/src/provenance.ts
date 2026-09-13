import type { AgentCommand, AgentRunState } from "@ollama-client/contracts"

import type { AgentStepReadout } from "./ports"

/**
 * Where the words in a destination came from.
 *
 * The egress rule exists to stop a model carrying data it could only have
 * learned by reading the user's page into a URL on some other site. It was
 * written against the page's field values alone, which is one span short of
 * the truth: a search box the run typed into holds a field value too, so a
 * run that entered the user's own query and then followed the site's own
 * search URL was killed as an exfiltration attempt. That is what happened on
 * duckduckgo.com — the run typed the goal's words, navigated to
 * `?q=ollama+browser+extension`, and the rule blocked the one thing the task
 * asked for.
 *
 * The distinction is authorship, and the run already knows it. The goal and
 * the user's answers are the user's own words. The text the run typed or
 * selected is on its own durable receipts. Anything else in a field is
 * something the page put there, which is the data the rule is about.
 *
 * One honest limit, stated rather than papered over: a value the run typed is
 * treated as its own, so a model that first copies a field value into a box
 * and then navigates with it is not blocked here. What still stands in front
 * of it is the risk raise — a model-composed destination carrying a query is
 * `high`, navigation is not a grantable class, so the user sees the complete
 * URL and approves it or does not.
 */

/**
 * Long enough to be evidence of copying rather than a coincidence, and the
 * same length the resolver used to decide a span was worth classifying: a
 * shorter span never reaches this rule, because it never earned the
 * `field_value` grade in the first place.
 */
const MINIMUM_EGRESS_SPAN = 12

const normalize = (value: string): string =>
  value.replaceAll(/\s+/g, " ").trim().toLocaleLowerCase()

const decoded = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Every reading of one piece of a URL, because the two sides of the
 * comparison arrive differently encoded and a query separates its words with
 * `+`. Decoding runs to a fixed point: percent-decoding either shrinks a
 * string or leaves it unchanged, so the walk ends on its own.
 */
const readings = (value: string): string[] => {
  const forms = new Set<string>()
  for (const start of new Set([value, value.replaceAll("+", " ")])) {
    let current = start
    let next = start
    do {
      current = next
      const normalized = normalize(current)
      if (normalized.length >= MINIMUM_EGRESS_SPAN) forms.add(normalized)
      next = decoded(current)
    } while (next.length < current.length)
  }
  return [...forms]
}

/**
 * Every part of a destination the model could have filled in, read
 * structurally rather than with `URL`: this package has no DOM, and widening
 * its lib to borrow one parser would open the whole surface it exists to stay
 * out of. The authority is dropped — a host is not a span the model composed
 * out of page data, and the destination's origin is judged on its own.
 */
const destinationSpans = (url: string): string[][] => {
  const withoutScheme = url.replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
  const pathStart = withoutScheme.search(/[/?#]/)
  if (pathStart < 0) return []
  return withoutScheme
    .slice(pathStart)
    .split(/[/?&=#]/)
    .map(readings)
    .filter((forms) => forms.length > 0)
}

/** The text a command writes into the page, which is the run's own words. */
const authoredByCommand = (
  command: AgentCommand | undefined
): string | undefined => {
  if (!command) return undefined
  /**
   * `replace_text.find` is deliberately absent: it is an exact quotation of
   * the value already in the control, so it is page data the model read, not
   * text it wrote.
   */
  if (
    command.type === "type" ||
    command.type === "clear_and_type" ||
    command.type === "replace_text"
  ) {
    return command.text
  }
  return command.type === "select" ? command.value : undefined
}

/**
 * The words this run may be said to have supplied itself: the user's goal,
 * every answer they gave it, and the text it has typed or selected.
 */
export const agentAuthoredText = (
  state: Pick<AgentRunState, "goal" | "answers">,
  steps: readonly AgentStepReadout[] = []
): string[] => {
  /**
   * A set, because a step is appended once per lifecycle change and every
   * receipt carries the command: one typed value arrives four times, and the
   * comparison would walk it four times for the same answer.
   */
  const authored = new Set<string>([
    state.goal,
    ...(state.answers ?? []).map((answer) => answer.text),
    ...(state.answers ?? []).flatMap((answer) =>
      answer.question ? [answer.question] : []
    )
  ])
  for (const step of steps) {
    const value = authoredByCommand(step.command)
    if (value) authored.add(value)
  }
  return [...authored].filter((value) => value.trim().length > 0)
}

/**
 * Whether every span of a destination long enough to matter is accounted for
 * by the run's own words.
 *
 * Every long span, not any: a URL that carries one phrase from the goal and
 * one account number off the page is the exfiltration this rule is for, and
 * reading it as authored because half of it was would be the whole bypass.
 * A destination with no long spans at all is authored by nobody and needs no
 * defence — it carried no page data, which is why it never reached here.
 */
export const isAgentAuthoredDestination = (
  url: string,
  authoredText: readonly string[] = []
): boolean => {
  const pieces = destinationSpans(url)
  if (pieces.length === 0) return true
  const authored = authoredText.map(normalize).filter((value) => value.length)
  if (authored.length === 0) return false
  /**
   * Every piece of the URL, but any reading of that piece: the readings are
   * alternative spellings of the same bytes — `ollama+browser+extension` and
   * `ollama browser extension` are one parameter, not two — so one of them
   * matching is the piece accounted for.
   *
   * Containment in one direction only. A span the run's own words contain is
   * the run's own words; a span that merely contains one of them is not — a
   * goal mentioning "ollama" would otherwise authorize a URL carrying
   * "ollama" and an account number in the same parameter.
   */
  return pieces.every((forms) =>
    forms.some((span) => authored.some((value) => value.includes(span)))
  )
}
