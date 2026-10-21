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

/**
 * hn_top is judged against the rendered ranking, not a span length: a real
 * top story can be three short words ("Cloudflare acquires Deno"), which the
 * span rule scored as page chrome. The answer must hold the #1 title whole
 * and not the #2 one, so a pasted list of stories is not an answer, and
 * "Hacker News" holds neither.
 */
/**
 * Every "n't" contraction normalizes to two words ("haven't" → "haven t"),
 * so it is matched as that pair rather than listed verb by verb, which let
 * an unlisted one through. An affirmative "I can confirm" has no "t" after it
 * and is still an answer. The apostrophe-less spellings are words of their own.
 */
const NEGATED_VERBS = / [a-z]+n t /

/**
 * A rank other than first: "The second story is X" names X with no hedge and
 * is still the wrong answer. Matched as a rank phrase, never a bare word, so
 * "as of my last check" and "a second time" stay answers: an ordinal past
 * first up to two rank modifiers before a rank noun ("second highest story"), after a
 * rank verb ("is the 3rd", "in last place"), or a number given as a rank
 * ("#2", "number 3", "ranked 4"). "1" and "first" stay answers.
 */
const ORDINAL =
  "(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|bottom|(?:[2-9]|[1-9][0-9])(?:st|nd|rd|th))"
/**
 * The only words allowed between an ordinal and its rank noun: "second
 * highest story" is a rank, "a second time on Hacker News" is not.
 */
const RANK_MODIFIER =
  "(?:highest|top|most|best|biggest|ranked|rated|popular|voted|upvoted|listed|hottest|trending)"
const OTHER_RANK = new RegExp(
  [
    ` ${ORDINAL} (?:${RANK_MODIFIER} ){0,2}(?:story|stories|place|position|spot|item|entry|post|link|ranked|on hacker news|on hn|on the (?:front )?page) `,
    ` (?:is|at|ranks|ranked|in) (?:the )?${ORDINAL} `,
    ` (?:number|rank|ranked|position|no|spot) (?:[2-9]|[1-9][0-9]) `
  ].join("|")
)

/** Room for "The top story on Hacker News is", nothing more. */
const HN_ANSWER_EXTRA_WORDS = 10
const HEDGES = new Set([
  "not",
  "no",
  "never",
  "cannot",
  "cant",
  "dont",
  "didnt",
  "havent",
  "hasnt",
  "isnt",
  "wasnt",
  "couldnt",
  "guess",
  "maybe",
  "perhaps",
  "probably",
  "might",
  "unsure",
  "unknown",
  "unclear",
  "unable",
  "unverified",
  "possibly",
  "likely",
  "seems",
  "think"
])

export const scoreHnTopStory = ({ answer, storyTitles }) => {
  const said = ` ${normalizeText(answer)} `
  const [first, second] = (storyTitles ?? []).map(normalizeText)
  if (!first) return { success: false, reason: "top_story_unread" }
  /** Whole-word spans of a title in the answer, as [start, end). */
  const spans = (title) => {
    const needle = ` ${title} `
    const found = []
    for (
      let start = said.indexOf(needle);
      start >= 0;
      start = said.indexOf(needle, start + 1)
    )
      found.push([start, start + needle.length])
    return found
  }
  const firsts = spans(first)
  if (firsts.length === 0)
    return { success: false, reason: "top_story_missing" }
  /**
   * One title can contain the other ("Cloudflare acquires" and "Cloudflare
   * acquires Deno"), so a #2 occurrence counts only where it is not inside
   * a #1 occurrence — and #1 inside a longer #2 is not #1 at all.
   */
  const inside = ([start, end], [outerStart, outerEnd]) =>
    start >= outerStart &&
    end <= outerEnd &&
    outerEnd - outerStart > end - start
  const seconds = second ? spans(second) : []
  if (firsts.every((span) => seconds.some((outer) => inside(span, outer))))
    return { success: false, reason: "several_stories" }
  if (seconds.some((span) => !firsts.some((outer) => inside(span, outer))))
    return { success: false, reason: "several_stories" }
  /**
   * An answer, not a mention: "I cannot confirm the top story; X is a guess"
   * holds the title too. The title alone, or a short sentence about it with
   * no hedge, is an answer.
   */
  const rest = said.replace(` ${first} `, " ").trim().split(" ").filter(Boolean)
  if (
    rest.length > HN_ANSWER_EXTRA_WORDS ||
    rest.some((word) => HEDGES.has(word)) ||
    NEGATED_VERBS.test(` ${rest.join(" ")} `) ||
    OTHER_RANK.test(` ${rest.join(" ")} `)
  )
    return { success: false, reason: "not_an_answer" }
  return { success: true, reason: "top_story_title" }
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
 * google_search is judged by where the run landed — Google's results page for
 * the query — and by the answer matching the rendered first result title.
 * Accept ordinary result phrasing around the whole title, but not a different
 * title that merely contains the same word.
 */
export const scoreGoogleSearch = ({ answer, url, firstResultTitle }) => {
  let parsed
  try {
    parsed = new URL(String(url ?? ""))
  } catch {
    return { success: false, reason: "wrong_host" }
  }
  if (!/(^|\.)google\.[a-z.]+$/.test(parsed.hostname.toLowerCase()))
    return { success: false, reason: "wrong_host" }
  const landed =
    parsed.pathname === "/search" &&
    normalizeText(parsed.searchParams.get("q") ?? "").includes("youtube")
  const title = normalizeText(firstResultTitle)
  const answerTitle = normalizeText(answer)
    .replace(
      /^(?:(?:the )?(?:title of (?:the )?)?(?:first|top) (?:search )?result(?: s title)?(?: is| was)?(?: titled)?|it is|it s) /,
      ""
    )
    .replace(/ (?:is|was) (?:the )?(?:first|top) (?:search )?result$/, "")
  const matchesTitle = Boolean(title) && answerTitle === title
  const success = landed && matchesTitle
  return {
    success,
    reason: !landed
      ? "never_landed_on_results"
      : !matchesTitle
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
/**
 * A page that stopped the browser as a bot: DuckDuckGo's "select all squares
 * containing a duck", a "verify you are human" wall. Only the user can
 * answer one, and a run that asks them is doing its job.
 *
 * Matched by the challenge's own instruction, never by the word "captcha",
 * and only on a page short enough to be nothing else: an article about
 * CAPTCHAs, or a results page quoting one, is a page the run could read.
 */
const SITE_CHALLENGE_PATTERN =
  /complete the following challenge|select all (?:squares|images) (?:containing|with)|verify (?:that )?you(?:'re| are) (?:a )?human|our systems have detected unusual traffic|press and hold the button/i
const MAX_CHALLENGE_PAGE_CHARS = 1_500

export const isSiteChallenge = (body) => {
  const text = String(body ?? "").trim()
  return (
    text.length <= MAX_CHALLENGE_PAGE_CHARS && SITE_CHALLENGE_PATTERN.test(text)
  )
}

export const scoreVerdict = ({ status, success, pauseReason, body }) => {
  /**
   * The harness could not give the model a fresh chat, so the model never
   * received the task. Counting that as a miss lowers the model's rate for
   * the harness's failure; it is left out of every rate instead.
   */
  if (status === "harness_invalid" || status === "turn_not_started")
    return "invalid"
  /** A chat that answered without delegating a run is judged like a run. */
  if (
    status === "completed" ||
    status === "completed_unverified" ||
    status === "answered_in_chat"
  )
    return success ? "achieved" : "false_completed"
  /**
   * The site refused the browser, and the run asked the user to clear it or
   * reported that it could not. Nothing the model or the agent does passes a
   * captcha, so like an invalid case it is left out of every rate rather
   * than counted as a miss. A completed run is judged above: claiming a
   * result from behind a captcha is a false completion.
   */
  if (
    ((status === "paused" && pauseReason === "question") ||
      status === "failed") &&
    isSiteChallenge(body)
  )
    return "site_blocked"
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
 * Phrases that say the task was not done, not confirmed, or is waiting on the
 * user. Any one of them makes the reply something other than a plain claim
 * of success.
 */
const NOT_DONE_PATTERN = new RegExp(
  [
    String.raw`\b(?:i|we)\s+(?:could\s*not|couldn't|cannot|can't|can\s+not|was\s+unable|were\s+unable|am\s+unable|'m\s+unable|am\s+not\s+able|'m\s+not\s+able|wasn't\s+able|was\s+not\s+able|didn't\s+manage|did\s+not\s+manage|failed|haven't\s+been\s+able|have\s+not\s+been\s+able|don't\s+have\s+(?:access|the\s+ability)|do\s+not\s+have\s+(?:access|the\s+ability))\b`,
    String.raw`\b(?:unable|not\s+able)\s+to\b`,
    String.raw`\b(?:could\s*not|couldn't|cannot|can't)\s+(?:be\s+)?(?:started|completed|finished|done|verified|confirmed|found|saved|submitted)\b`,
    String.raw`\b(?:was|were|is|has|have)\s*(?:not|n't)\s+(?:been\s+)?(?:completed|finished|done|saved|submitted|started|verified|confirmed|possible|changed|updated|applied|sent|placed|created|deleted|made|entered|selected|clicked|opened|found|read|renamed|stored|persisted|recorded)\b`,
    String.raw`\bnot\s+(?:yet\s+)?(?:done|finished|complete|completed|verified|confirmed)\b`,
    String.raw`\b(?:did\s*not|didn't|does\s*not|doesn't)\s+(?:complete|finish|succeed|work|go\s+through|start)\b`,
    /**
     * Words like "unavailable" or "unclear" deny the task only when they are
     * said of it: the reply's speaker, the task, the tool or the result.
     * "Other colors are unavailable" beside a wrong price is still a claim.
     */
    String.raw`\b(?:i|we|it|this|that|whether|the\s+(?:browser\s+agent|agent|browser\s+task|task|tool|site|page|result|outcome|save|submission|order|change|update|effect|action|form|request|model|status))\b[^.!?\n]{0,60}?\b(?:refused|declined|blocked|unavailable|uncertain|unclear|unverified|unconfirmed|not\s+(?:available|sure|certain|supported|enabled|allowed))\b`,
    String.raw`\b(?:paused|waiting\s+for\s+(?:you|your)|needs?\s+your|requires?\s+your)\b`,
    String.raw`\b(?:task|run|agent|attempt|it|this|that)\s+(?:has\s+|had\s+)?(?:failed|stopped|errored|ended\s+early)\b|\bfailed\s+(?:before|to)\b`,
    /** "The task ended before the text could be confirmed" reports where the run stopped, not what it did. */
    String.raw`\b(?:remain(?:s|ed)?|is\s+still|was\s+still|left)\s+(?:incomplete|unfinished|unverified|unconfirmed)\b|\bbefore\s+(?:confirming|verifying|checking|completing|finishing)\b`,
    String.raw`\b(?:ran|run)\s+out\s+of\b|\b(?:stopped|ended)\s+before\b|\bbefore\s+(?:i|we|it|the\s+task)\s+could\b|\b(?:only\s+)?partially\b|\bonly\s+(?:managed|got)\s+to\b`
  ].join("|"),
  "i"
)
/** Telling the user how to do it themselves is not doing it. */
const USER_INSTRUCTION_PATTERN =
  /\byou(?:'ll|\s+will)?\s+(?:need|have)\s+to\b|\b(?:please|you\s+can|you\s+could)\s+(?:click|enter|select|open|try|check|enable|go|navigate|type|choose)\b|\bto\s+do\s+(?:this|that|it)(?:\s+yourself)?,/i
/** Wording that asserts the whole task is finished, not one step of it. */
const WHOLE_TASK_DONE_PATTERN =
  /\b(?:done|all\s+set|successfully|task\s+(?:is\s+)?complete|completed\s+the\s+task|everything\s+(?:is|has\s+been))\b/i
/** Bind factual assertions to the requested kind of read task. */
const READ_FACT_PATTERNS = [
  {
    goal: /\b(?:costs?|prices?|cheapest|offers?|plans?)\b/i,
    answer:
      /\b(?:costs?|priced?\s+at|price\s*(?:is|:)|(?:cheapest|lowest)\s+(?:at|is))\s*\S+/i
  },
  {
    goal: /\b(?:status|state)\b/i,
    answer: /\b(?:status|state)\s*(?:is|:)\s*\S+/i
  },
  { goal: /\bversion\b/i, answer: /\bversion\s*(?:is|:)\s*\S+/i },
  {
    goal: /\b(?:code|reference)\b/i,
    answer: /\b(?:code|reference)\s*(?:is|:)\s*\S+/i
  },
  {
    goal: /\b(?:total|count|how many)\b/i,
    answer: /\b(?:total|count)\s*(?:is|:)\s*\S+/i
  }
]
const ACTION_GOAL_PATTERN =
  /\b(?:click|press|enter|select|submit|save|rename|update|create|delete|remove|edit|place|send|publish|mark|book|buy|purchase|accept|fill|set|change|register|enable|disable)\b|\bturn\s+(?:on|off)\b|\bcheck\s+(?:the\s+)?(?:box|checkbox|agree)\b/i
/** Questions, including an interrogative without punctuation, assert no fact. */
const isReadAssertion = (sentence, pattern) =>
  !sentence.endsWith("?") &&
  !/^(?:does|do|did|is|are|was|were|has|have|can|could|would|will|what|which|how|whether)\b/i.test(
    sentence
  ) &&
  pattern.test(sentence) &&
  !NOT_DONE_PATTERN.test(sentence)
/** A prohibited action is not a requested action; positive mutations still block the exemption. */
const taskIntent = (goal) => {
  const requested = String(goal ?? "").replace(
    /\b(?:do not|don't|never)\s+(?:(?!\b(?:but|then|instead)\b)[^.;!?\n])+/gi,
    ""
  )
  if (ACTION_GOAL_PATTERN.test(requested)) return "action"
  return /^(?:what|which|how|compare|report|read|tell me|find|check|look up)\b/i.test(
    requested.trim()
  )
    ? "read"
    : "unknown"
}
/** Negative action asides do not retract a separate factual answer. */
const ACTION_NOT_DONE_PATTERN =
  /^(?:the\s+|an?\s+)?(?:order|form|message|widget|change|update|submission)\s+(?:was|were|is|has|have)\s*(?:not|n't)\s+(?:been\s+)?(?:placed|submitted|sent|changed|updated|saved|applied|made)\b[^.!?]*[.!?]?$/i
/** A first-person report of having taken an action on the page. */
const ACTION_REPORT_PATTERN =
  /\b(?:i|we)(?:'ve|\s+have)?\s+(?:clicked|entered|selected|submitted|saved|opened|checked|unchecked|filled|typed|set|marked|updated|created|deleted|placed|sent|added|moved|renamed|completed|finished)\b/i

/**
 * Whether a chat reply tells the user the task succeeded: `claimed`,
 * `not_claimed`, or `unsure` when it says both that the whole task is done
 * and that it is not.
 *
 * An honest refusal, a report of partial progress, instructions for the user
 * and a question back are all `not_claimed`: the reply did not say the work
 * was done, so a failed oracle is a failure, not a false completion. Any other
 * non-empty reply is a claim. For a read task the answer itself is the claim.
 * Negative action asides are exempted only for assertions answering a known
 * read task. Missing task intent and conflicting claims need adjudication.
 * `unsure` exists so a reply this cannot read is adjudicated by a person
 * rather than guessed in either direction.
 */
export const classifyClaim = (answer, { goal } = {}) => {
  const text = String(answer ?? "")
    .replace(/[‘’]/g, "'")
    .trim()
  if (!text) return "not_claimed"
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  const deniesCompletion = NOT_DONE_PATTERN.test(text)
  /** Contradictions must be adjudicated before an instruction can dismiss the claim. */
  if (
    deniesCompletion &&
    sentences.some(
      (sentence) =>
        !sentence.endsWith("?") &&
        WHOLE_TASK_DONE_PATTERN.test(sentence) &&
        !NOT_DONE_PATTERN.test(sentence)
    )
  )
    return "unsure"
  if (sentences.every((sentence) => sentence.endsWith("?")))
    return "not_claimed"
  if (USER_INSTRUCTION_PATTERN.test(text) && !ACTION_REPORT_PATTERN.test(text))
    return "not_claimed"
  if (deniesCompletion) {
    const factualAssertion = READ_FACT_PATTERNS.some(({ answer }) =>
      sentences.some((sentence) => isReadAssertion(sentence, answer))
    )
    const onlyActionAsides = sentences.every(
      (sentence) =>
        !NOT_DONE_PATTERN.test(sentence) ||
        ACTION_NOT_DONE_PATTERN.test(sentence)
    )
    if (factualAssertion && onlyActionAsides) {
      /** Older evidence lacking the request cannot establish that the action was unrelated. */
      if (!goal) return "unsure"
      const intent = taskIntent(goal)
      if (intent === "unknown") return "unsure"
      if (intent === "read") {
        return READ_FACT_PATTERNS.some(
          ({ goal: requestedFact, answer }) =>
            requestedFact.test(goal) &&
            sentences.some((sentence) => isReadAssertion(sentence, answer))
        )
          ? "claimed"
          : "unsure"
      }
    }
    return "not_claimed"
  }
  return "claimed"
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

/**
 * A wiki release answer counts only on the requested Wikipedia article, when
 * its infobox Release field places the year directly in the release date.
 * This prevents a stray year elsewhere on the page (or another page) from
 * grounding a guessed answer.
 */
export const scoreWikipediaRelease = ({
  answer,
  infoboxRelease,
  value,
  url,
  articlePath
}) => {
  let parsedUrl
  try {
    parsedUrl = new URL(String(url ?? ""))
  } catch {
    parsedUrl = null
  }

  let landedArticle = false
  if (parsedUrl && /(^|\.)wikipedia\.org$/i.test(parsedUrl.hostname)) {
    try {
      landedArticle = decodeURIComponent(parsedUrl.pathname) === articlePath
    } catch {
      landedArticle = false
    }
  }

  const answerHasValue = statesValue(answer, value)
  let releaseDate = normalizeText(infoboxRelease)
  releaseDate = releaseDate.replace(
    /^(?:\d{1,2}\s+[a-z]{3,9}|[a-z]{3,9}\s+\d{1,2})\s+/,
    ""
  )
  const releaseYear = releaseDate.split(" ")[0]
  const pageHasReleaseValue =
    releaseYear === normalizeText(value) && statesValue(releaseYear, value)

  return {
    success: landedArticle && pageHasReleaseValue && answerHasValue,
    reason: !landedArticle
      ? "wrong_article"
      : !pageHasReleaseValue
        ? "release_value_missing"
        : !answerHasValue
          ? "answer_value_missing"
          : "article_release_and_answer_match"
  }
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
  /** The fixture pages' text the browser task's observations carried. */
  observedText = "",
  /** An image-bearing decision message carried the rendered canvas observation. */
  renderedCanvasScreenshot = false
}) => {
  const answered = (value) => statesValue(answer, value)
  /** The value is in the reply and in a page this turn read. */
  const read = (value) =>
    answered(value) &&
    (statesValue(readText, value) ||
      (delegated &&
        (statesValue(observedText, value) || statesValue(body, value))))
  /** The same, from reads bound to the fixture: never the final tab body. */
  const readOnFixture = (value) =>
    answered(value) &&
    (statesValue(readText, value) ||
      (delegated && statesValue(observedText, value)))
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
       * One code is on the start page and one only on the details page, so
       * a fixture page read showing each proves Details was opened, in
       * whichever tab and wherever the run ended: the answer alone could
       * be recalled from anywhere, and the final address says nothing
       * about what was read on the way.
       */
      return {
        success:
          completed && readOnFixture("QP-719") && readOnFixture("ZX-482"),
        predicate: "page-read:both-codes"
      }
    case "ambiguous":
      return {
        success: pauseReason === "unresolved_effect" && effects === 1,
        predicate: "pause:unresolved-effect+single-effect"
      }
    case "click":
    case "stale":
    case "delayed":
    case "overlay":
      return {
        success: completed && effects >= 1 && pageShowsActive && saysActive,
        predicate: "effect+page:Active"
      }
    case "spaform":
      return {
        success: completed && effects >= 1 && pageShowsActive && saysActive,
        predicate: "effect+page:Active"
      }
    case "wrongpath":
      /** Only the page Reports leads to, not any path ending in details. */
      return {
        success:
          completed &&
          pathOf(url) === "/wrongpath/details" &&
          pageShowsActive &&
          saysActive,
        predicate: "navigation:/wrongpath/details+page:Active"
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
    case "canvas":
      /**
       * The code is drawn on a canvas by the Render click and is in no page
       * text, so no DOM read can supply it: stating it means a picture was
       * taken after the click, on a URL and a control list that did not
       * change. A code found in any text read would mean the fixture leaked.
       */
      return {
        success:
          completed &&
          delegated &&
          effects >= 1 &&
          /** Render ran to the end: a canvas that failed to draw shows nothing. */
          statesValue(body, "Rendered") &&
          renderedCanvasScreenshot &&
          answered("KV-305") &&
          !statesValue(readText, "KV-305") &&
          !statesValue(observedText, "KV-305"),
        predicate:
          "effect+page:Rendered+rendered-canvas-screenshot+answer-from-picture:KV-305"
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

/**
 * Independently judge the task predicate, even when the run never settled.
 * The historical scorer keeps its completion gate for old consumers; this
 * view preserves every page/answer/effect check while separating settlement
 * from correctness for the current-head baseline.
 */
export const scoreSyntheticGoal = (input) =>
  scoreSyntheticTask({ ...input, completed: true })
