import { hasPermission, type OptionalApiPermission } from "@/lib/permissions"
import type { ToolDefinition } from "@/lib/tools"

/**
 * Browser data tools need two independent gates before a provider can see them:
 * the browser permission must already be granted, and the current user request
 * must explicitly ask for the matching sensitive data. Provider-side
 * `tool_choice: auto` is not a privacy boundary, especially for small models
 * that can select an unrelated tool from a large inventory.
 */
const REQUIRED_PERMISSION_BY_TOOL: Partial<
  Record<string, OptionalApiPermission>
> = {
  get_recent_history: "history",
  search_bookmarks: "bookmarks",
  list_recently_closed: "sessions",
  restore_session: "sessions",
  list_synced_sessions: "sessions"
}

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

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text))

const hasExplicitIntent = (toolName: string, userText: string): boolean => {
  switch (toolName) {
    case "get_recent_history":
      return matchesAny(userText, HISTORY_INTENT)
    case "search_bookmarks":
      return matchesAny(userText, BOOKMARK_INTENT)
    case "list_recently_closed":
    case "restore_session":
      return matchesAny(userText, RECENT_SESSION_INTENT)
    case "list_synced_sessions":
      return matchesAny(userText, SYNCED_SESSION_INTENT)
    default:
      return true
  }
}

/**
 * Return the turn-scoped inventory shared by native and non-native tool loops.
 * This runs in the background before any provider adapter receives tools.
 */
export const filterToolsForTurn = async (
  definitions: ToolDefinition[],
  latestUserText: string | undefined
): Promise<ToolDefinition[]> => {
  const userText = latestUserText?.trim() ?? ""
  const permissionResults = new Map<OptionalApiPermission, Promise<boolean>>()

  const permissionGranted = (permission: OptionalApiPermission) => {
    let result = permissionResults.get(permission)
    if (!result) {
      result = hasPermission(permission)
      permissionResults.set(permission, result)
    }
    return result
  }

  const decisions = await Promise.all(
    definitions.map(async (definition) => {
      const permission = REQUIRED_PERMISSION_BY_TOOL[definition.name]
      if (permission && !(await permissionGranted(permission))) return false
      return hasExplicitIntent(definition.name, userText)
    })
  )

  return definitions.filter((_, index) => decisions[index])
}
