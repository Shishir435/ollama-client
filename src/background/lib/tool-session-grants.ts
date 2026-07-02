import { approvalGrantKey } from "@/lib/tools/approval/approval-policy"

/**
 * In-memory "Allow for this chat" grants, keyed by chat session + tool ×
 * origin. Same single-context Map pattern as the abort-controller registry:
 * they live only as long as the service worker, so a SW restart re-prompts —
 * failing closed, which is the right direction for an approval boundary.
 */

const grants = new Set<string>()

const sessionGrantKey = (
  sessionId: string,
  toolName: string,
  origin?: string
): string => `${sessionId}##${approvalGrantKey(toolName, origin)}`

export const addSessionGrant = (
  sessionId: string,
  toolName: string,
  origin?: string
): void => {
  grants.add(sessionGrantKey(sessionId, toolName, origin))
}

export const hasSessionGrant = (
  sessionId: string | undefined,
  toolName: string,
  origin?: string
): boolean =>
  sessionId !== undefined &&
  grants.has(sessionGrantKey(sessionId, toolName, origin))

/** Drop one chat's grants (chat deleted), or everything (hard reset). */
export const clearSessionGrants = (sessionId?: string): void => {
  if (sessionId === undefined) {
    grants.clear()
    return
  }
  const prefix = `${sessionId}##`
  for (const key of grants) {
    if (key.startsWith(prefix)) grants.delete(key)
  }
}
