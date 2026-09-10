import { AgentControlFailedError } from "@ollama-client/agent-runtime"
import type {
  AgentObservation,
  AgentSnapshotIdentity
} from "@ollama-client/contracts"

import type {
  AgentControlBrowserAdapter,
  AgentControlBrowserFrame,
  AgentControlSession,
  AgentDomMutationInstruction,
  AgentElementRectWire,
  AgentHitTestResult,
  AgentInputTraceWire,
  AgentNativeInputPreparedResult,
  AgentScrollInstruction
} from "@/lib/browser-agent/control-port"
import { openAgentControlSession } from "@/lib/browser-agent/control-port"
import {
  type AgentChildFrameResult,
  authorizeAgentFrame,
  composeAgentFrameObservations,
  remainingAgentElementBudget,
  selectAgentChildFrames
} from "@/lib/browser-agent/frame-observation"
import { browser } from "@/lib/browser-api"
import { classifyAgentTabAccess } from "@/lib/browser-tab-access"
import { logger } from "@/lib/logger"

/**
 * Run-scoped owner of the control sessions a run holds on the frames it drives.
 *
 * A session is bound to one document: the moment the page navigates, its nonce
 * and documentId stop matching and the port closes. Reopening is therefore
 * normal rather than exceptional, so a root observation retries once against a
 * fresh session. Execution never retries — a mutation whose port died may
 * already have run, and repeating it is how one click becomes two.
 *
 * A typed control failure is not reopened either: the content script answered,
 * so the port is healthy and the answer is deterministic. Observing the same
 * document again would fail identically and cost the run a second full
 * snapshot, so the reason is logged and raised for the controller to name.
 *
 * Child frames are read after the root, each through its own bound session,
 * and only once the run is known to be allowed to read them: the browser's
 * limits, the user's exclusions and the run's origin allowlist are all asked
 * before a frame's port is opened. A child that cannot be read is listed in the
 * observation as such rather than dropped, and a child that fails mid-read is
 * listed as unreadable rather than retried — the root is the page, and the run
 * can still act on it.
 */
export interface AgentControlSessionRegistry {
  observe(
    input: {
      runId: string
      tabId: number
      minimumGeneration: number
      allowedOrigins: readonly string[]
    },
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
  /**
   * Native input's page-side halves. Preparation rechecks the target and arms
   * the document's input record; settlement reads that record back once the
   * debugger has sent the plan. Neither retries: a preparation whose port died
   * is stale, and a settlement whose port died is a document that navigated —
   * reported as such, so the verifier reads page evidence instead.
   */
  prepareNativeInput(
    input: {
      runId: string
      tabId: number
      instruction: AgentDomMutationInstruction
    },
    signal?: AbortSignal
  ): Promise<AgentNativeInputPreparedResult>
  settleNativeInput(
    input: { runId: string; tabId: number; frameId: number },
    signal?: AbortSignal
  ): Promise<AgentInputTraceWire | undefined>
  /** Read-only questions about the live snapshot of one frame. */
  measureElements(
    input: {
      runId: string
      tabId: number
      frame: AgentSnapshotIdentity
      refs: readonly string[]
    },
    signal?: AbortSignal
  ): Promise<AgentElementRectWire[]>
  hitTest(
    input: {
      runId: string
      tabId: number
      frame: AgentSnapshotIdentity
      point: { x: number; y: number }
    },
    signal?: AbortSignal
  ): Promise<AgentHitTestResult>
  release(runId: string): void
}

type OpenSession = typeof openAgentControlSession

/** Frame discovery and access, separable from the port itself for tests. */
export type AgentControlFrameAdapter = Pick<
  AgentControlBrowserAdapter,
  "listFrames" | "classifyAccess"
>

const key = (runId: string, tabId: number, frameId: number) =>
  `${runId}::${tabId}::${frameId}`

const defaultFrameAdapter = (): AgentControlFrameAdapter => ({
  async listFrames(tabId) {
    const frames = (await browser.webNavigation.getAllFrames({ tabId })) as
      | {
          frameId: number
          parentFrameId?: number
          documentId?: string
          url: string
        }[]
      | null
    return (frames ?? []).map((frame) => ({
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId ?? -1,
      ...(frame.documentId ? { documentId: frame.documentId } : {}),
      url: frame.url
    }))
  },
  classifyAccess: classifyAgentTabAccess
})

export const createAgentControlSessionRegistry = (input?: {
  open?: OpenSession
  frames?: AgentControlFrameAdapter
}): AgentControlSessionRegistry => {
  const open = input?.open ?? openAgentControlSession
  const frameAdapter = input?.frames ?? defaultFrameAdapter()
  const sessions = new Map<string, AgentControlSession>()

  const acquire = async (
    runId: string,
    tabId: number,
    frameId: number
  ): Promise<AgentControlSession> => {
    const existing = sessions.get(key(runId, tabId, frameId))
    if (existing) return existing
    const session = await open({ runId, tabId, frameId })
    sessions.set(key(runId, tabId, frameId), session)
    return session
  }

  const drop = (runId: string, tabId: number, frameId: number) => {
    const session = sessions.get(key(runId, tabId, frameId))
    if (!session) return
    sessions.delete(key(runId, tabId, frameId))
    try {
      session.disconnect()
    } catch {
      /* A closed port is already what we wanted. */
    }
  }

  const observeRoot = async (
    runId: string,
    tabId: number,
    minimumGeneration: number,
    signal?: AbortSignal
  ): Promise<AgentObservation> => {
    const session = await acquire(runId, tabId, 0)
    try {
      return await session.observe(minimumGeneration, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      drop(runId, tabId, 0)
      if (error instanceof AgentControlFailedError) {
        logger.warn("Agent observation failed", "Agent", {
          runId,
          reason: error.reason,
          issues: error.issues
        })
        throw error
      }
      const reopened = await acquire(runId, tabId, 0)
      return reopened.observe(minimumGeneration, signal)
    }
  }

  const listFrames = async (
    tabId: number
  ): Promise<AgentControlBrowserFrame[]> => {
    try {
      return await frameAdapter.listFrames(tabId)
    } catch {
      /* A tab whose frames cannot be listed is observed as its root alone. */
      return []
    }
  }

  const observeChild = async (
    runId: string,
    tabId: number,
    frame: AgentControlBrowserFrame,
    minimumGeneration: number,
    allowedOrigins: readonly string[],
    elementLimit: number,
    signal?: AbortSignal
  ): Promise<AgentChildFrameResult | undefined> => {
    const authorized = await authorizeAgentFrame(frame, {
      allowedOrigins,
      classifyAccess: (url) => frameAdapter.classifyAccess(url)
    })
    if (!authorized) return undefined
    const result: AgentChildFrameResult = { frame, ...authorized }
    if (result.access !== "ok") return result
    if (elementLimit <= 0) return { ...result, access: "element_budget" }
    try {
      const session = await acquire(runId, tabId, frame.frameId)
      const observation = await session.observe(
        minimumGeneration,
        signal,
        elementLimit
      )
      return { ...result, observation }
    } catch (error) {
      if (signal?.aborted) throw error
      drop(runId, tabId, frame.frameId)
      logger.warn("Agent child frame observation failed", "Agent", {
        runId,
        frameId: frame.frameId,
        name: error instanceof Error ? error.name : typeof error
      })
      return { ...result, access: "unreadable" }
    }
  }

  return {
    async observe({ runId, tabId, minimumGeneration, allowedOrigins }, signal) {
      const root = await observeRoot(runId, tabId, minimumGeneration, signal)
      const { selected, omitted } = selectAgentChildFrames(
        await listFrames(tabId)
      )
      const children: AgentChildFrameResult[] = []
      for (const frame of selected) {
        const child = await observeChild(
          runId,
          tabId,
          frame,
          minimumGeneration,
          allowedOrigins,
          remainingAgentElementBudget(root, children),
          signal
        )
        if (child) children.push(child)
      }
      return composeAgentFrameObservations({ root, children, omitted })
    },
    async executeDomMutation({ runId, tabId, instruction }, signal) {
      const frameId = instruction.frame.frameId
      const session = await acquire(runId, tabId, frameId)
      try {
        return await session.executeDomMutation(instruction, signal)
      } catch (error) {
        drop(runId, tabId, frameId)
        throw error
      }
    },
    async executeScroll({ runId, tabId, instruction }, signal) {
      const frameId = instruction.frame.frameId
      const session = await acquire(runId, tabId, frameId)
      try {
        await session.executeScroll(instruction, signal)
      } catch (error) {
        drop(runId, tabId, frameId)
        throw error
      }
    },
    async prepareNativeInput({ runId, tabId, instruction }, signal) {
      const frameId = instruction.frame.frameId
      const session = await acquire(runId, tabId, frameId)
      try {
        return await session.prepareNativeInput(instruction, signal)
      } catch (error) {
        drop(runId, tabId, frameId)
        throw error
      }
    },
    async settleNativeInput({ runId, tabId, frameId }, signal) {
      const session = sessions.get(key(runId, tabId, frameId))
      if (!session) return undefined
      try {
        return await session.settleNativeInput(signal)
      } catch (error) {
        drop(runId, tabId, frameId)
        throw error
      }
    },
    async measureElements({ runId, tabId, frame, refs }, signal) {
      const session = await acquire(runId, tabId, frame.frameId)
      try {
        return await session.measureElements(frame, refs, signal)
      } catch (error) {
        drop(runId, tabId, frame.frameId)
        throw error
      }
    },
    async hitTest({ runId, tabId, frame, point }, signal) {
      const session = await acquire(runId, tabId, frame.frameId)
      try {
        return await session.hitTest(frame, point, signal)
      } catch (error) {
        drop(runId, tabId, frame.frameId)
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
