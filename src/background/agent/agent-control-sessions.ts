import { AgentControlFailedError } from "@ollama-client/agent-runtime"
import {
  type AgentObservation,
  type AgentObservationScope,
  type AgentSnapshotIdentity,
  MAX_AGENT_LOOKUP_MATCHES,
  MAX_AGENT_OBSERVED_ELEMENTS
} from "@ollama-client/contracts"

import type {
  AgentControlBrowserAdapter,
  AgentControlBrowserFrame,
  AgentControlSession,
  AgentDomMutationInstruction,
  AgentFormFillInstruction,
  AgentFormFillOutcome,
  AgentHitTestResult,
  AgentInputTraceWire,
  AgentNativeInputPreparedResult,
  AgentScrollInstruction,
  AgentSensitiveRegions
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
      extraction?: { offset: number; frameId: number }
      /**
       * A scoped read of the root frame. Child frames keep contributing their
       * overview: a scope is a question about one document, and answering it
       * from several at once would return refs the model cannot tell apart.
       */
      scope?: AgentObservationScope
      /**
       * Several scoped questions asked at once, of the root frame and of
       * every child frame the run may read. Unlike a scope, a lookup answer
       * composes: its groups name refs, a ref carries its frame in its
       * prefix, and an empty group is read as "the page holds no such
       * control" — which would be a lie about a control sitting in an
       * authorized iframe.
       */
      lookup?: { queries: readonly string[] }
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
  /**
   * A batch of value edits, applied in the page in one exchange. Never
   * retried for the same reason a mutation is not: a batch whose port died
   * may have written some of its fields, and repeating it writes them twice.
   */
  executeFormFill(
    input: {
      runId: string
      tabId: number
      instruction: AgentFormFillInstruction
    },
    signal?: AbortSignal
  ): Promise<AgentFormFillOutcome>
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
  sensitiveRegions(
    input: { runId: string; tabId: number; frame: AgentSnapshotIdentity },
    signal?: AbortSignal
  ): Promise<AgentSensitiveRegions>
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
    signal?: AbortSignal,
    textOffset?: number,
    scope?: AgentObservationScope,
    lookup?: { queries: readonly string[] },
    elementLimit?: number
  ): Promise<AgentObservation> => {
    const session = await acquire(runId, tabId, 0)
    const request = {
      minimumGeneration,
      ...(textOffset === undefined ? {} : { textOffset }),
      ...(scope === undefined ? {} : { scope }),
      ...(lookup === undefined ? {} : { lookup }),
      ...(elementLimit === undefined ? {} : { elementLimit })
    }
    try {
      return await session.observe(request, signal)
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
      return reopened.observe(request, signal)
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
    signal?: AbortSignal,
    textOffset?: number,
    lookup?: { queries: readonly string[] }
  ): Promise<AgentChildFrameResult | undefined> => {
    const authorized = await authorizeAgentFrame(frame, {
      allowedOrigins,
      classifyAccess: (url) => frameAdapter.classifyAccess(url)
    })
    if (!authorized) return undefined
    const result: AgentChildFrameResult = { frame, ...authorized }
    if (result.access !== "ok") return result
    if (elementLimit <= 0 && textOffset === undefined)
      return { ...result, access: "element_budget" }
    try {
      const session = await acquire(runId, tabId, frame.frameId)
      const observation = await session.observe(
        {
          minimumGeneration,
          elementLimit,
          ...(textOffset === undefined ? {} : { textOffset }),
          ...(lookup === undefined ? {} : { lookup })
        },
        signal
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

  /** The most one frame's answer to a lookup can be worth, in rows. */
  const lookupFrameAllowance = (lookup: {
    queries: readonly string[]
  }): number => lookup.queries.length * MAX_AGENT_LOOKUP_MATCHES

  /**
   * Room the root may not spend, held back for the frames' own answers.
   *
   * A frame that matched none of the questions answers with its overview, and
   * so does the root — which is the case a page-wide question is most often
   * asked in, since the control the run is looking for is the one it cannot
   * find. On a crowded page that fallback overview filled the whole element
   * budget before a single frame was asked, and the frame holding the control
   * was skipped for having no room: an empty group, reported as an answer.
   *
   * So the reserve is taken before the root is asked rather than after. It
   * costs the root's *fallback* rows only — a lookup's own matches are bounded
   * far below this — and it is held for every frame the run might read, since
   * whether a frame is authorized is not known until it is asked. Unspent
   * room stays unspent; a consolation overview is not worth a second pass.
   */
  const lookupFrameReserve = (
    frames: number,
    lookup?: { queries: readonly string[] }
  ): number =>
    lookup
      ? Math.min(
          frames * lookupFrameAllowance(lookup),
          Math.floor(MAX_AGENT_OBSERVED_ELEMENTS / 2)
        )
      : 0

  /**
   * What one child frame may add to this observation.
   *
   * Ordinarily the whole remaining element budget: an overview wants every
   * control the page has. A lookup is the exception — a frame that matched
   * none of the questions answers with its overview instead, so an unbounded
   * budget would spend a query's prompt on five frames' worth of controls
   * nobody asked about. Its matches can never exceed one group per question,
   * so that is what it gets.
   */
  const childElementBudget = (
    root: AgentObservation,
    children: readonly AgentChildFrameResult[],
    lookup?: { queries: readonly string[] }
  ): number => {
    const remaining = remainingAgentElementBudget(root, children)
    return lookup
      ? Math.min(remaining, lookupFrameAllowance(lookup))
      : remaining
  }

  return {
    async observe(
      {
        runId,
        tabId,
        minimumGeneration,
        allowedOrigins,
        extraction,
        scope,
        lookup
      },
      signal
    ) {
      /**
       * Listed before the root is read, for a lookup only: the reserve its
       * frames need has to be withheld from the root's own request, and the
       * number of frames is what decides how much. Every other read keeps the
       * old order, where the root is asked first and the frame list is what
       * the remaining budget is divided between.
       */
      const listed = lookup
        ? selectAgentChildFrames(await listFrames(tabId))
        : undefined
      const reserve = lookupFrameReserve(listed?.selected.length ?? 0, lookup)
      const root = await observeRoot(
        runId,
        tabId,
        minimumGeneration,
        signal,
        extraction?.frameId === 0 ? extraction.offset : undefined,
        scope,
        lookup,
        reserve > 0 ? MAX_AGENT_OBSERVED_ELEMENTS - reserve : undefined
      )
      const { selected, omitted } =
        listed ?? selectAgentChildFrames(await listFrames(tabId))
      const children: AgentChildFrameResult[] = []
      /**
       * A scoped read is answered by the root alone.
       *
       * The scope reaches only the root document, so a child frame asked at
       * the same time answers with its ordinary overview — and composition
       * appended those unrelated controls to the matches while `scope.returned`
       * still counted only the root's. The model was handed rows that did not
       * match what it asked for, inside an answer that said they did.
       *
       * A multi-query lookup is asked of the child frames too, with the same
       * questions, and composition merges each frame's matches into the group
       * that asked for them. Its answer composes where a scope's does not: a
       * group names refs rather than a count and a continuation, and a ref
       * carries the frame it came from. Root-only was the more dangerous of
       * the two answers, because an empty group means "no such control on
       * this page" and the model stops asking.
       */
      for (const frame of scope ? [] : selected) {
        const child = await observeChild(
          runId,
          tabId,
          frame,
          minimumGeneration,
          allowedOrigins,
          childElementBudget(root, children, lookup),
          signal,
          extraction?.frameId === frame.frameId ? extraction.offset : undefined,
          lookup
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
    async executeFormFill({ runId, tabId, instruction }, signal) {
      const frameId = instruction.frame.frameId
      const session = await acquire(runId, tabId, frameId)
      try {
        return await session.executeFormFill(instruction, signal)
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
    async sensitiveRegions({ runId, tabId, frame }, signal) {
      const session = await acquire(runId, tabId, frame.frameId)
      try {
        return await session.sensitiveRegions(frame, signal)
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
      for (const sessionKey of sessions.keys()) {
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
