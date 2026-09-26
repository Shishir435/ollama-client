/**
 * Pure scoring helpers for the live benchmark harnesses.
 *
 * Both scripts drive the built extension with a real model, so the scorer is
 * the only thing standing between a fluent wrong answer and a recorded pass.
 * These predicates stay pure (no Playwright objects) so they can be pinned by
 * `node --test` without launching a browser.
 */

/** Normalize the way the harness does: lowercase, non-alphanumeric to space. */
export const normalizeText = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

/**
 * Per-task guardrails for answer-in-page (`__inbody__`) real-site tasks.
 *
 * A bare "some page span appears in the answer" check accepts page chrome:
 * "Hacker News" is a verbatim two-word span of every HN page, so it passed
 * as the exact top-story title. Each task therefore names the minimum
 * verbatim span it accepts plus the boilerplate phrases that can never
 * count toward it (removed from the matched span before measuring).
 */
export const INBODY_RULES = {
  hn_top: {
    minWords: 4,
    minChars: 24,
    deny: ["hacker news", "y combinator", "login", "submit", "comments"]
  },
  gh_about: {
    minWords: 3,
    minChars: 12,
    deny: ["github", "about", "read more", "shishir435"]
  },
  ddg_search: {
    minWords: 3,
    minChars: 15,
    // Echoing the query back ("ollama browser extension") quotes the search
    // box, not a result. Strip it before measuring.
    deny: ["ollama browser extension", "duckduckgo", "more results"]
  },
  gh_issues: {
    minWords: 3,
    minChars: 12,
    deny: ["github", "new issue", "search", "labels", "milestones", "issues"]
  }
}

const stripDenyPhrases = (span, deny) => {
  let out = ` ${span} `
  for (const phrase of deny) out = out.split(` ${phrase} `).join(" ")
  return out.replace(/\s+/g, " ").trim()
}

/**
 * Score an answer against page body text: longest run of consecutive answer
 * words appearing verbatim in the page, minus boilerplate.
 */
export const scoreInbodyAnswer = (answer, body, rule) => {
  const words = normalizeText(answer).split(" ").filter(Boolean)
  const haystack = normalizeText(body)
  let longest = ""
  for (let i = 0; i < words.length; i += 1) {
    for (let j = words.length; j > i; j -= 1) {
      const span = words.slice(i, j).join(" ")
      // Keep the harness's 8-character verbatim floor: a headline like
      // "JetKVM Mini" must still be quotable.
      if (span.length < 8) break
      if (haystack.includes(span)) {
        if (span.length > longest.length) longest = span
        break
      }
    }
  }
  const measurable = stripDenyPhrases(longest, rule.deny ?? [])
  const measurableWords = measurable ? measurable.split(" ").length : 0
  const success =
    measurableWords >= rule.minWords && measurable.length >= rule.minChars
  return {
    success,
    matchedSpan: longest,
    measurableSpan: measurable,
    reason: success
      ? "inbody_match"
      : longest
        ? "chrome_or_short_span"
        : "no_verbatim_span"
  }
}

/** wiki_search is deterministic: the run must land on the Firefox article. */
export const scoreWikiSearch = ({ answer, url }) => {
  let host = ""
  try {
    host = new URL(String(url ?? "")).hostname.toLowerCase()
  } catch {
    host = ""
  }
  // The path alone proves nothing: any host can serve /wiki/Firefox.
  if (!/(^|\.)wikipedia\.org$/.test(host))
    return { success: false, reason: "wrong_host" }
  const landed = /\/wiki\/Firefox($|[?#])/i.test(String(url ?? ""))
  const namesIt = normalizeText(answer).includes("firefox")
  const success = landed && namesIt
  return {
    success,
    reason: !landed
      ? "never_landed_on_firefox"
      : !namesIt
        ? "title_missing"
        : "landed_and_named"
  }
}

/**
 * Run-outcome class, kept separate from the task predicate. A completed run
 * with a wrong answer is a false completion, not a miss. A pause is safe only
 * when policy explicitly transferred control or the task predicate confirms
 * that an unresolved effect was the expected outcome.
 */
export const scoreVerdict = ({ status, success, pauseReason }) => {
  /**
   * The harness could not give the model a fresh chat, so the model never
   * received the task. Counting that as a miss lowers the model's rate for
   * the harness's failure; it is left out of every rate instead.
   */
  if (status === "harness_invalid") return "invalid"
  /** A chat that answered without delegating a run is judged like a run. */
  if (status === "completed" || status === "answered_in_chat")
    return success ? "achieved" : "false_completed"
  if (status === "awaiting_takeover") return "safely_paused"
  if (status === "paused" && success && pauseReason === "unresolved_effect")
    return "safely_paused"
  return "missed"
}

/**
 * Whether a text reports the Active status the synthetic fixtures render.
 *
 * A case-sensitive substring check fails a correct lowercase answer and
 * passes "Status: Not Active", which states the opposite. Match `active` as
 * a whole word, case-insensitively, and reject an explicit negation.
 */
export const statesActive = (text) => {
  const norm = String(text ?? "").toLowerCase()
  if (!/\bactive\b/.test(norm)) return false
  if (/\bnot\s+active\b/.test(norm)) return false
  return true
}
/**
 * Whether `text` states `value` as a whole token, ignoring case. A substring
 * check accepted `0.14.01` for `0.14.0` and `QP-7190` for `QP-719`. A
 * sentence-ending period after the value and a `v` before it still count.
 */
export const statesValue = (text, value) => {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  /**
   * Bounded on both sides by anything but a value continuation, so `0.14.0`
   * is not found inside `1.0.14.0` or `0.14.0-rc`.
   */
  return new RegExp(
    `(?<![a-z0-9]|[a-z0-9][.-])v?${escaped}(?![a-z0-9]|[.-][a-z0-9])`,
    "i"
  ).test(String(text ?? ""))
}

const pathOf = (url) => {
  try {
    return new URL(String(url)).pathname
  } catch {
    return String(url)
  }
}

export const scoreSyntheticTask = ({
  kind,
  completed,
  answer = "",
  body = "",
  field = {},
  effects = 0,
  url = "",
  pauseReason,
  openTabActive = false,
  /**
   * What the chat's page-reading tools returned — the tab it read. A reply
   * alone is the model's own words, and a model can state a code it never
   * read; the browser task's report is a summary, not a page read.
   */
  readText = "",
  /** A browser task ran and completed; its own observations read the page. */
  delegated = false,
  /** The visible text the browser task's observations carried. */
  observedText = ""
}) => {
  const answered = (value) => statesValue(answer, value)
  /** The value is in the reply and in a page this turn read. */
  const read = (value) =>
    answered(value) &&
    (statesValue(readText, value) ||
      (delegated &&
        (statesValue(observedText, value) || statesValue(body, value))))
  const saysActive = statesActive(answer)
  const pageShowsActive = statesActive(body)
  /** Tested on the path: a plain GET form lands on `/form/details?name=Alice`. */
  const detailsUrl = /\/details(\/|$)/.test(pathOf(url))
  switch (kind) {
    case "read":
      return {
        success: completed && read("0.14.0"),
        predicate: "answer:0.14.0"
      }
    case "select":
      return {
        success: completed && field.value === "blue",
        predicate: "field:blue"
      }
    case "checkbox":
    case "uncheck":
      return {
        success: completed && field.checked === (kind === "checkbox"),
        predicate: "field:checked-state"
      }
    case "keypress":
      return {
        success: completed && field.focus === "second",
        predicate: "field:focus"
      }
    case "memory":
      /**
       * One code is on the start page and one on the details page, so the
       * run must have landed on details and a page it read must show each
       * code: the answer alone could be recalled from anywhere.
       */
      return {
        success: completed && detailsUrl && read("QP-719") && read("ZX-482"),
        predicate: "navigation+page-read:both-codes"
      }
    case "ambiguous":
      return {
        success: pauseReason === "unresolved_effect" && effects === 1,
        predicate: "pause:unresolved-effect+single-effect"
      }
    case "click":
    case "stale":
    case "delayed":
      return {
        success: completed && effects >= 1 && pageShowsActive && saysActive,
        predicate: "effect+page:Active"
      }
    case "spaform":
      return {
        success: completed && effects >= 1 && pageShowsActive && saysActive,
        predicate: "effect+page:Active"
      }
    case "form":
    case "details":
    case "menu":
    case "redirect":
      // The form navigates (no /effect fetch on a plain submit); the others
      // navigate to a details page. Navigation, not an effect counter, is
      // the evidence — assert the URL moved and the landed page states it.
      return {
        success: completed && detailsUrl && pageShowsActive && saysActive,
        predicate: "navigation+page:Active"
      }
    case "open_tab":
      // The opener page never shows the status; the new tab must.
      return {
        success: completed && openTabActive && saysActive,
        predicate: "new-tab+page:Active"
      }
    case "scroll":
    case "modal":
      return {
        success: completed && pageShowsActive && saysActive,
        predicate: "page:Active"
      }
    default:
      return { success: false, predicate: "unknown-task" }
  }
}
