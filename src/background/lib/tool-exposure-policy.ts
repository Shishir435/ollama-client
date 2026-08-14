import { matchesToolPermissionIntent } from "@/lib/optional-permission-intent"
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
      return matchesToolPermissionIntent(definition.name, userText)
    })
  )

  return definitions.filter((_, index) => decisions[index])
}
