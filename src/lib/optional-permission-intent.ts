export type OptionalPermissionCapabilityId =
  | "bookmarks"
  | "history"
  | "downloads"
  | "tabGroups"
  | "sessions"
  | "reminders"

const HISTORY_INTENT = [
  /\b(?:my|browser|browsing|web|recent)\b.{0,40}\bhistory\b/i,
  /\bhistory\b.{0,40}\b(?:browser|browsing|web|visited|sites?|pages?)\b/i,
  /\b(?:recently|last)\s+(?:visited|opened|viewed)\b/i,
  /\bwhat\s+(?:did\s+)?(?:i|we)\s+(?:recently\s+)?(?:visit|open|view)\b/i,
  /\bwhat\s+(?:sites?|websites?|pages?|urls?)\s+did\s+(?:i|we)\s+(?:recently\s+)?(?:visit|open|view)\b/i,
  /\b(?:sites?|websites?|pages?|urls?)\b.{0,40}\b(?:i|we)\s+(?:recently\s+)?(?:visited|opened|viewed)\b/i,
  /\b(?:last|recent)\s+\d*\s*(?:sites?|websites?|pages?|urls?)\b/i
]

const BOOKMARK_INTENT = [
  /\bbookmarks?\b/i,
  /\b(?:saved|bookmarked)\s+(?:pages?|sites?|websites?|links?|urls?)\b/i
]

const RECENT_SESSION_INTENT = [
  /\brecently\s+closed\b/i,
  /\bclosed\s+(?:tabs?|windows?|pages?)\b/i,
  /\b(?:reopen|restore)\b.{0,30}\b(?:tabs?|windows?|pages?|session)\b/i
]

const SYNCED_SESSION_INTENT = [
  /\b(?:tabs?|sessions?)\b.{0,30}\b(?:another|other|synced)\s+device\b/i,
  /\b(?:another|other|synced)\s+device\b.{0,30}\b(?:tabs?|sessions?)\b/i,
  /\bsynced\s+(?:tabs?|sessions?)\b/i
]

const TAB_GROUP_INTENT = [
  /\btab\s+groups?\b/i,
  /\bgrouped\s+tabs?\b/i,
  /\b(?:summarize|compare|read|list|show)\b.{0,30}\bgroups?\b.{0,20}\btabs?\b/i
]

const DOWNLOAD_INTENT = [
  /\b(?:save|download|export)\s+(?:this|it|that)\b/i,
  /\b(?:save|download|export)\b.{0,50}\b(?:files?|code|answers?|responses?|reports?|documents?|markdown|html|svg|json|diagrams?)\b/i
]

const REMINDER_INTENT = [
  /\bremind\s+(?:me|us)\b/i,
  /\bnotify\s+(?:me|us)\b.{0,40}\b(?:at|in|after|when|once)\b/i,
  /\bset\b.{0,20}\b(?:a\s+)?reminder\b/i,
  /\bschedule\b.{0,20}\b(?:a\s+)?reminder\b/i
]

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text))

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
