import { approvalGrantKey } from "@/lib/tools/approval/approval-policy"

/**
 * In-memory "Allow for this chat" grants, keyed by chat session + tool ×
 * origin × input-trust generation. Same single-context Map pattern as the
 * abort-controller registry:
 * they live only as long as the service worker, so a SW restart re-prompts —
 * failing closed, which is the right direction for an approval boundary.
 */

const grants = new Set<string>()

const sessionGrantKey = (
  sessionId: string,
  toolName: string,
  origin: string | undefined,
  taintGeneration = 0
): string =>
  `${sessionId}##${approvalGrantKey(toolName, origin)}##${taintGeneration}`

export const addSessionGrant = (
  sessionId: string,
  toolName: string,
  origin?: string,
  taintGeneration = 0
): void => {
  grants.add(sessionGrantKey(sessionId, toolName, origin, taintGeneration))
}

export const hasSessionGrant = (
  sessionId: string | undefined,
  toolName: string,
  origin?: string,
  taintGeneration = 0
): boolean =>
  sessionId !== undefined &&
  grants.has(sessionGrantKey(sessionId, toolName, origin, taintGeneration))

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
