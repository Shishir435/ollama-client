export type OptionalPermissionCapabilityId =
  | "bookmarks"
  | "history"
  | "downloads"
  | "tabGroups"
  | "sessions"
  | "reminders"
  | "browserAgent"

const HISTORY_INTENT = [
  /\b(?:my|our|browser|browsing|web)\b.{0,40}\bhistory\b/i,
  /\bhistory\b.{0,40}\b(?:browser|browsing|web|visited|sites?|pages?)\b/i,
  /\b(?:recently|last)\s+(?:visited|opened|viewed)\b/i,
  /\bwhat\s+(?:did\s+)?(?:i|we)\s+(?:recently\s+)?(?:visit|open|view)\b/i,
  /\bwhat\s+(?:sites?|websites?|pages?|urls?)\s+did\s+(?:i|we)\s+(?:recently\s+)?(?:visit|open|view)\b/i,
  /\b(?:sites?|websites?|pages?|urls?)\b.{0,40}\b(?:i|we)\s+(?:recently\s+)?(?:visited|opened|viewed)\b/i,
  /\b(?:last|recent)\s+\d*\s*(?:sites?|websites?|pages?|urls?)\b/i
]

const BOOKMARK_INTENT = [
  /\b(?:my|our)\b.{0,30}\bbookmarks?\b/i,
  /\b(?:search|find|show|list|access|read|check|look\s+(?:in|through))\b.{0,30}\bbookmarks?\b/i,
  /\b(?:search|find|show|list|access|read|check)\b.{0,30}\b(?:my|our)\s+(?:saved|bookmarked)\s+(?:pages?|sites?|websites?|links?|urls?)\b/i
]

const RECENT_SESSION_INTENT = [
  /\b(?:my|our)\b.{0,30}\brecently\s+closed\b/i,
  /\b(?:show|list|find|access|reopen|restore)\b.{0,30}\brecently\s+closed\b/i,
  /\b(?:show|list|find|access|reopen|restore)\b.{0,30}\bclosed\s+(?:tabs?|windows?|pages?)\b/i,
  /\b(?:reopen|restore)\b.{0,30}\b(?:tabs?|windows?|pages?|session)\b/i
]

const SYNCED_SESSION_INTENT = [
  /\b(?:tabs?|sessions?)\b.{0,30}\b(?:another|other|synced)\s+device\b/i,
  /\b(?:another|other|synced)\s+device\b.{0,30}\b(?:tabs?|sessions?)\b/i,
  /\bsynced\s+(?:tabs?|sessions?)\b/i
]

const TAB_GROUP_INTENT = [
  /\b(?:my|our)\b.{0,30}\btab\s+groups?\b/i,
  /\b(?:summarize|compare|read|list|show|access|check)\b.{0,30}\btab\s+groups?\b/i,
  /\b(?:summarize|compare|read|list|show|access|check)\b.{0,30}\bgrouped\s+tabs?\b/i,
  /\b(?:summarize|compare|read|list|show|access|check)\b.{0,30}\bgroups?\b.{0,20}\btabs?\b/i
]

/**
 * "Save it" alone is not asked about: with a browser agent in the chat, it
 * is as often the Save button on a page as a file on disk, and the notice
 * holds the whole message until the permission is on. Saving counts once it
 * names a file or a destination on this machine.
 */
const DOWNLOAD_INTENT = [
  /\b(?:download|export)\s+(?:this|it|that)\b/i,
  /\bsave\s+(?:this|it|that)\s+(?:as|to|into)\s+(?:an?\s+)?(?:file|markdown|md|html|pdf|json|txt|text\s+file|svg|csv|disk|downloads?|my\s+(?:computer|downloads?))\b/i,
  /\b(?:save|download|export)\b.{0,30}\b(?:your|the)\s+(?:answer|response|output)\b/i,
  /\b(?:save|download|export)\b.{0,30}\b(?:this|that)\s+(?:file|code|answer|response|report|document|markdown|html|svg|json|diagram)\b/i
]

const REMINDER_INTENT = [
  /\bremind\s+(?:me|us)\b/i,
  /\bnotify\s+(?:me|us)\b.{0,40}\b(?:at|in|after|when|once)\b/i,
  /\bset\b.{0,20}\b(?:a\s+)?reminder\b/i,
  /\bschedule\b.{0,20}\b(?:a\s+)?reminder\b/i
]

/**
 * A request to act in the browser rather than to read or answer: going to a
 * site, doing something there, pressing or filling a control. Used only to
 * say the experimental agent is off — never to offer a tool — so a miss costs
 * the old reply, and a match costs one card with "Continue without" on it.
 * A bare "open" or "click" is not enough; both are ordinary words in a
 * question about code or files.
 */
const BROWSER_ACTION_INTENT = [
  /\b(?:open|go\s+to|navigate\s+to|visit|browse\s+to|head\s+(?:over\s+)?to|load)\b.{0,20}(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|ai|dev|app|co|edu|gov)\b)/i,
  /\b(?:open|go\s+to|navigate\s+to|visit|head\s+(?:over\s+)?to)\b.{1,40}\b(?:and|then)\s+(?:search|click|type|fill|sign\s+in|log\s+in|find|look\s+up|add|book|buy|order)\b/i,
  /\b(?:search|look\s+up|find)\b.{0,60}\b(?:on|in|using)\s+(?:duck\s*duck\s*go|google|bing|wikipedia|youtube|amazon|github|reddit|ebay)\b/i,
  /\b(?:click|press|tap)\s+(?:on\s+)?(?:the|that|this)\b.{0,40}\b(?:button|link|tab|menu|checkbox|icon)\b/i,
  /\bfill\s+(?:in|out)\b.{0,30}\b(?:form|fields?)\b/i
]

/**
 * Keywords whose misspelling would silently withhold a sensitive tool.
 *
 * Why only these: the gate exists so a model is offered browser-data tools only when
 * the user actually asked for that data, and the ask is carried by one word. A typo in
 * that word ("bookamrks") used to drop both the tool and the permission notice, so the
 * model answered that it had no such ability at all. Short words are left out — at one
 * edit they collide with unrelated ones.
 */
const CANONICAL_INTENT_KEYWORDS = [
  "bookmark",
  "bookmarks",
  "history",
  "download",
  "downloads",
  "reminder",
  "reminders",
  "session",
  "sessions",
  "synced",
  "visited"
]

const MIN_FUZZY_LENGTH = 6

/**
 * True when one edit — a substitution, insertion, deletion, or transposition of two
 * adjacent characters — turns `candidate` into `target`. Transpositions matter because
 * they are the most common real typo and cost two plain edits.
 */
const isOneEditApart = (candidate: string, target: string): boolean => {
  if (candidate === target) return false
  const lengthDifference = Math.abs(candidate.length - target.length)
  if (lengthDifference > 1) return false

  if (candidate.length === target.length) {
    const differences: number[] = []
    for (let index = 0; index < candidate.length; index += 1) {
      if (candidate[index] !== target[index]) differences.push(index)
      if (differences.length > 2) return false
    }
    if (differences.length === 1) return true
    if (differences.length !== 2) return false
    const [first, second] = differences as [number, number]
    return (
      second === first + 1 &&
      candidate[first] === target[second] &&
      candidate[second] === target[first]
    )
  }

  const longer = candidate.length > target.length ? candidate : target
  const shorter = candidate.length > target.length ? target : candidate
  let longerIndex = 0
  let shorterIndex = 0
  let edited = false
  while (longerIndex < longer.length && shorterIndex < shorter.length) {
    if (longer[longerIndex] === shorter[shorterIndex]) {
      longerIndex += 1
      shorterIndex += 1
      continue
    }
    if (edited) return false
    edited = true
    longerIndex += 1
  }
  return true
}

/**
 * Rewrite near-miss spellings of the intent keywords to their canonical form, so the
 * patterns below can stay readable regular expressions over correct English.
 */
export const canonicalizeIntentText = (text: string): string =>
  text.replace(/[a-z]{6,}/gi, (word) => {
    const lowered = word.toLowerCase()
    if (CANONICAL_INTENT_KEYWORDS.includes(lowered)) return word
    if (lowered.length < MIN_FUZZY_LENGTH) return word
    const corrected = CANONICAL_INTENT_KEYWORDS.find((keyword) =>
      isOneEditApart(lowered, keyword)
    )
    return corrected ?? word
  })

const matchesAny = (text: string, patterns: RegExp[]): boolean => {
  if (patterns.some((pattern) => pattern.test(text))) return true
  const corrected = canonicalizeIntentText(text)
  return (
    corrected !== text && patterns.some((pattern) => pattern.test(corrected))
  )
}

export const matchesOptionalPermissionIntent = (
  capabilityId: OptionalPermissionCapabilityId,
  text: string
): boolean => {
  switch (capabilityId) {
    case "bookmarks":
      return matchesAny(text, BOOKMARK_INTENT)
    case "history":
      return matchesAny(text, HISTORY_INTENT)
    case "downloads":
      return matchesAny(text, DOWNLOAD_INTENT)
    case "tabGroups":
      return matchesAny(text, TAB_GROUP_INTENT)
    case "sessions":
      return matchesAny(text, [
        ...RECENT_SESSION_INTENT,
        ...SYNCED_SESSION_INTENT
      ])
    case "reminders":
      return matchesAny(text, REMINDER_INTENT)
    case "browserAgent":
      return matchesAny(text, BROWSER_ACTION_INTENT)
  }
}

export const matchesToolPermissionIntent = (
  toolName: string,
  text: string
): boolean => {
  switch (toolName) {
    case "get_recent_history":
      return matchesAny(text, HISTORY_INTENT)
    case "search_bookmarks":
      return matchesAny(text, BOOKMARK_INTENT)
    case "list_recently_closed":
    case "restore_session":
      return matchesAny(text, RECENT_SESSION_INTENT)
    case "list_synced_sessions":
      return matchesAny(text, SYNCED_SESSION_INTENT)
    default:
      return true
  }
}
