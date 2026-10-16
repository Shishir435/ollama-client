import {
  AGENT_ROUTINE_GRANT_EFFECTS,
  type AgentGrant,
  MAX_AGENT_GRANTS
} from "@ollama-client/contracts"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"

/**
 * Routine consent a chat carries from one browser task to the next.
 *
 * A run's grants used to die with it, so the second task in a chat asked
 * again for every click on a site the user had already let the first one
 * click through, and every search the start prompt had covered. What carries
 * is the routine part only — clicks, typing and searches, per site — never a
 * submission widened for one run and never anything critical, which no grant
 * can cover anyway. A carried grant covers a site only once the new run is
 * there legitimately: it adds no site to the run's allowlist.
 *
 * `chrome.storage.session`, so it survives a worker restart and ends with
 * the browser. Without it, memory, which fails closed on restart.
 */

const KEY = STORAGE_KEYS.TOOLS.CHAT_AGENT_CONSENT
/** Chats remembered at once; the oldest is forgotten first. */
const MAX_CHATS = 50

type Consent = Record<string, AgentGrant[]>

export interface AgentChatConsent {
  read(sessionId: string): Promise<AgentGrant[]>
  remember(sessionId: string, grants: readonly AgentGrant[]): Promise<void>
  forget(sessionId?: string): Promise<void>
}

/** The routine part of a grant, or nothing when it has none. */
const routinePart = (grant: AgentGrant): AgentGrant | undefined => {
  const effects = grant.effects.filter((effect) =>
    (AGENT_ROUTINE_GRANT_EFFECTS as readonly string[]).includes(effect)
  )
  if (effects.length === 0) return undefined
  return {
    origin: grant.origin,
    effects,
    grantedAt: grant.grantedAt,
    ...(grant.searches ? { searches: true as const } : {})
  }
}

/**
 * One grant per site: classes and search consent joined, newest time kept.
 * Bounded by the run's own grant cap, newest sites first.
 */
export const mergeAgentGrants = (
  ...lists: readonly (readonly AgentGrant[])[]
): AgentGrant[] => {
  const byOrigin = new Map<string, AgentGrant>()
  for (const grant of lists.flat()) {
    const seen = byOrigin.get(grant.origin)
    byOrigin.set(
      grant.origin,
      seen
        ? {
            origin: grant.origin,
            effects: [...new Set([...seen.effects, ...grant.effects])],
            grantedAt: Math.max(seen.grantedAt, grant.grantedAt),
            ...(seen.searches || grant.searches
              ? { searches: true as const }
              : {})
          }
        : grant
    )
  }
  return [...byOrigin.values()]
    .sort((a, b) => b.grantedAt - a.grantedAt)
    .slice(0, MAX_AGENT_GRANTS)
}

/** The two calls this needs from `chrome.storage.session`. */
export interface AgentConsentArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export const createAgentChatConsent = (
  area: AgentConsentArea | undefined = browser.storage?.session as
    | AgentConsentArea
    | undefined
): AgentChatConsent => {
  let memory: Consent = {}
  const load = async (): Promise<Consent> => {
    if (!area) return memory
    try {
      const stored = (await area.get(KEY))?.[KEY]
      return stored && typeof stored === "object" ? (stored as Consent) : {}
    } catch {
      return memory
    }
  }
  const save = async (consent: Consent): Promise<void> => {
    memory = consent
    if (!area) return
    try {
      await area.set({ [KEY]: consent })
    } catch {
      /** Memory still holds it until the worker stops. */
    }
  }
  return {
    async read(sessionId) {
      return ((await load())[sessionId] ?? []).flatMap((grant) => {
        const routine =
          typeof grant?.origin === "string" && Array.isArray(grant.effects)
            ? routinePart(grant)
            : undefined
        return routine ? [routine] : []
      })
    },
    async remember(sessionId, grants) {
      const routine = grants.flatMap((grant) => {
        const part = routinePart(grant)
        return part ? [part] : []
      })
      if (routine.length === 0) return
      const consent = await load()
      const { [sessionId]: previous = [], ...others } = consent
      const kept = Object.entries(others).slice(-(MAX_CHATS - 1))
      await save({
        ...Object.fromEntries(kept),
        [sessionId]: mergeAgentGrants(routine, previous)
      })
    },
    async forget(sessionId) {
      if (sessionId === undefined) return save({})
      const { [sessionId]: _dropped, ...others } = await load()
      await save(others)
    }
  }
}
