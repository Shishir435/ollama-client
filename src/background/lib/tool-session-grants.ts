import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { approvalGrantKey } from "@/lib/tools/approval/approval-policy"

/**
 * "Allow for this chat" grants, keyed by chat session + tool × origin ×
 * input-trust generation — or, for a tool whose grant is the chat itself,
 * by chat and tool alone.
 *
 * Kept in `chrome.storage.session`, so a service-worker restart keeps them
 * and closing the browser clears them: a grant that vanished every time MV3
 * stopped an idle worker asked the user the same question again minutes
 * later, which teaches them to stop reading it. Where session storage is
 * missing they stay in memory and die with the worker, failing closed.
 */

const KEY = STORAGE_KEYS.TOOLS.SESSION_GRANTS
const MAX_GRANTS = 500

let grants: Promise<Set<string>> | undefined

const sessionArea = () => browser.storage?.session

const loaded = (): Promise<Set<string>> => {
  grants ??= (async () => {
    try {
      const stored = (await sessionArea()?.get(KEY))?.[KEY]
      return new Set(
        Array.isArray(stored)
          ? stored.filter((key): key is string => typeof key === "string")
          : []
      )
    } catch {
      return new Set<string>()
    }
  })()
  return grants
}

const persist = async (set: Set<string>): Promise<void> => {
  try {
    await sessionArea()?.set({ [KEY]: [...set].slice(-MAX_GRANTS) })
  } catch {
    /** Memory still holds it; a restart re-prompts, which fails closed. */
  }
}

/**
 * Where a grant is scoped. `chat` is for a tool whose own confirmation
 * already asks whenever its input could be the page's words: the grant means
 * "this kind of call in this chat", so neither the site nor a later read
 * page withdraws it.
 */
export interface SessionGrantScope {
  origin?: string
  taintGeneration?: number
  chat?: boolean
}

const sessionGrantKey = (
  sessionId: string,
  toolName: string,
  scope: SessionGrantScope
): string =>
  scope.chat
    ? `${sessionId}##${toolName}##chat`
    : `${sessionId}##${approvalGrantKey(toolName, scope.origin)}##${scope.taintGeneration ?? 0}`

export const addSessionGrant = async (
  sessionId: string,
  toolName: string,
  scope: SessionGrantScope = {}
): Promise<void> => {
  const set = await loaded()
  set.add(sessionGrantKey(sessionId, toolName, scope))
  await persist(set)
}

export const hasSessionGrant = async (
  sessionId: string | undefined,
  toolName: string,
  scope: SessionGrantScope = {}
): Promise<boolean> =>
  sessionId !== undefined &&
  (await loaded()).has(sessionGrantKey(sessionId, toolName, scope))

/** Drop one chat's grants (chat deleted), or everything (hard reset). */
export const clearSessionGrants = async (sessionId?: string): Promise<void> => {
  const set = await loaded()
  if (sessionId === undefined) set.clear()
  else {
    const prefix = `${sessionId}##`
    for (const key of set) if (key.startsWith(prefix)) set.delete(key)
  }
  await persist(set)
}

/** Forget the loaded copy; tests reload from storage as a fresh worker would. */
export const resetSessionGrantCacheForTests = (): void => {
  grants = undefined
}
