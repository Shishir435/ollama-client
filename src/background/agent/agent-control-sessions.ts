import { AgentControlFailedError } from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"

import type {
  AgentControlSession,
  AgentDomMutationInstruction,
  AgentScrollInstruction
} from "@/lib/browser-agent/control-port"
import { openAgentControlSession } from "@/lib/browser-agent/control-port"
import { logger } from "@/lib/logger"

/**
 * Run-scoped owner of the control sessions a run holds on the tabs it drives.
 *
 * A session is bound to one document: the moment the page navigates, its nonce
 * and documentId stop matching and the port closes. Reopening is therefore
 * normal rather than exceptional, so an observation retries once against a
 * fresh session. Execution never retries — a mutation whose port died may
 * already have run, and repeating it is how one click becomes two.
 *
 * A typed control failure is not reopened either: the content script answered,
 * so the port is healthy and the answer is deterministic. Observing the same
 * document again would fail identically and cost the run a second full
 * snapshot, so the reason is logged and raised for the controller to name.
 */
export interface AgentControlSessionRegistry {
  observe(
    input: { runId: string; tabId: number; minimumGeneration: number },
    signal?: AbortSignal
  ): Promise<AgentObservation>
  executeDomMutation(
    input: {
      runId: string
      tabId: number
      instruction: AgentDomMutationInstruction
    },
    signal?: AbortSignal
  ): Promise<string | undefined>
  executeScroll(
    input: {
      runId: string
      tabId: number
      instruction: AgentScrollInstruction
    },
    signal?: AbortSignal
  ): Promise<void>
  release(runId: string): void
}

type OpenSession = typeof openAgentControlSession

const key = (runId: string, tabId: number) => `${runId}::${tabId}`

export const createAgentControlSessionRegistry = (input?: {
  open?: OpenSession
}): AgentControlSessionRegistry => {
  const open = input?.open ?? openAgentControlSession
  const sessions = new Map<string, AgentControlSession>()

  const acquire = async (
    runId: string,
    tabId: number
  ): Promise<AgentControlSession> => {
    const existing = sessions.get(key(runId, tabId))
    if (existing) return existing
    const session = await open({ runId, tabId })
    sessions.set(key(runId, tabId), session)
    return session
  }

  const drop = (runId: string, tabId: number) => {
    const session = sessions.get(key(runId, tabId))
    if (!session) return
    sessions.delete(key(runId, tabId))
    try {
      session.disconnect()
    } catch {
      /* A closed port is already what we wanted. */
    }
  }

  return {
    async observe({ runId, tabId, minimumGeneration }, signal) {
      const session = await acquire(runId, tabId)
      try {
        return await session.observe(minimumGeneration, signal)
      } catch (error) {
        if (signal?.aborted) throw error
        drop(runId, tabId)
        if (error instanceof AgentControlFailedError) {
          logger.warn("Agent observation failed", "Agent", {
            runId,
            reason: error.reason,
            issues: error.issues
          })
          throw error
        }
        const reopened = await acquire(runId, tabId)
        return reopened.observe(minimumGeneration, signal)
      }
    },
    async executeDomMutation({ runId, tabId, instruction }, signal) {
      const session = await acquire(runId, tabId)
      try {
        return await session.executeDomMutation(instruction, signal)
      } catch (error) {
        drop(runId, tabId)
        throw error
      }
    },
    async executeScroll({ runId, tabId, instruction }, signal) {
      const session = await acquire(runId, tabId)
      try {
        await session.executeScroll(instruction, signal)
      } catch (error) {
        drop(runId, tabId)
        throw error
      }
    },
    release(runId) {
      for (const sessionKey of [...sessions.keys()]) {
        if (!sessionKey.startsWith(`${runId}::`)) continue
        const session = sessions.get(sessionKey)
        sessions.delete(sessionKey)
        try {
          session?.disconnect()
        } catch {
          /* Releasing a dead port is not a failure. */
        }
      }
    }
  }
}
