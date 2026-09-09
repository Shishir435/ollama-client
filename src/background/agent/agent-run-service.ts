import type {
  AgentApprovalDecision,
  AgentController,
  AgentPersistencePort,
  AgentTakeoverDecision
} from "@ollama-client/agent-runtime"
import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import type { AgentRunState, AgentRunStatus } from "@ollama-client/contracts"
import { AgentRunStateSchema } from "@ollama-client/contracts"

import { browser } from "@/lib/browser-api"
import { classifyAgentTabAccess } from "@/lib/browser-tab-access"
import { logger } from "@/lib/logger"
import { hasAgentPerceptionPermission } from "@/lib/permissions"
import type { DurableAgentStep } from "@/lib/repositories/agent-runs"
import {
  createAgentPersistencePort,
  createAgentRun,
  createInitialAgentDeadline,
  getAgentRun,
  getLatestAgentRun,
  listAgentSteps,
  listIncompleteAgentRuns
} from "@/lib/repositories/agent-runs"
import type { AgentBrowserSessionManager } from "./agent-browser-session-manager"
import type { AgentControlSessionRegistry } from "./agent-control-sessions"
import { createAgentControlSessionRegistry } from "./agent-control-sessions"
import type { BuildAgentController } from "./agent-run-controller"
import type {
  AgentPendingSupervision,
  AgentSupervision
} from "./agent-supervision"
import { createAgentSupervision } from "./agent-supervision"
import type { AgentTabHistory } from "./agent-tab-history"
import { createAgentTabHistory } from "./agent-tab-history"
import { traceAgentRun } from "./agent-trace"

export interface StartAgentRunInput {
  goal: string
  tabId: number
  providerId: string
  modelId: string
  allowExperimentalModel?: boolean
}

export interface AgentRunSnapshot {
  run?: AgentRunState
  steps: DurableAgentStep[]
  pending?: AgentPendingSupervision
}

export interface AgentRunService {
  start(input: StartAgentRunInput): Promise<AgentRunState>
  pause(runId: string): Promise<void>
  resume(runId: string): Promise<void>
  stop(runId: string): Promise<void>
  completeTakeover(runId: string): Promise<void>
  answerApproval(input: {
    runId: string
    requestId: string
    decision: AgentApprovalDecision
  }): boolean
  answerTakeover(input: {
    runId: string
    requestId: string
    decision: AgentTakeoverDecision
  }): boolean
  /** Records the answer to the run's open question and resumes it. */
  answerQuestion(input: {
    runId: string
    questionId: string
    text: string
  }): Promise<void>
  snapshot(runId: string): Promise<AgentRunSnapshot>
  activeRunId(): string | undefined
  /**
   * The run the panel should be showing: the unresolved one, or the last one
   * recorded. A settled run is the only record of what happened, and dropping
   * it is how a failure looks to the user like nothing happened at all — so
   * this asks the table once memory has nothing, because the worker that ran
   * it may already be gone.
   */
  latestRunId(): Promise<string | undefined>
  subscribe(listener: (runId: string) => void): () => void
  adopt(runId: string): void
}

/**
 * Announces after every durable write rather than on a timer.
 *
 * The controller's only outward signal is what it persists, so wrapping the
 * persistence port is how the panel learns a run moved. A read (`load`) says
 * nothing new and is left silent.
 */
const announcing = (
  port: AgentPersistencePort,
  announce: (runId: string) => void,
  afterWrite: (state: AgentRunState) => Promise<void> = async () => undefined
): AgentPersistencePort => ({
  async claim(input) {
    const result = await port.claim(input)
    traceAgentRun(input.runId, "claim", {
      status: input.phase,
      claimed: result.claimed
    })
    if (result.claimed) await afterWrite(result.state)
    announce(input.runId)
    return result
  },
  async appendStep(input) {
    await port.appendStep(input)
    announce(input.runId)
  },
  async transition(input) {
    const result = await port.transition(input)
    traceAgentRun(input.runId, "transition", {
      from: input.from,
      to: input.to,
      transitioned: result.transitioned
    })
    if (result.transitioned) await afterWrite(result.state)
    announce(input.runId)
    return result
  },
  load: (runId) => port.load(runId),
  steps: (runId) => port.steps(runId)
})

/**
 * The phases in which the controller touches the page. Entering one is the
 * moment runtime work is claimed, so it is the moment browser ownership has
 * to hold.
 */
const BROWSER_WORK_STATUSES: readonly AgentRunStatus[] = [
  "observing",
  "executing",
  "verifying"
]

/**
 * Refuses to claim page work for a run that no longer owns its browser.
 *
 * A disconnect can land after `attachBrowserSession` confirmed ownership and
 * before the controller has claimed anything. The interruption handler then
 * finds a `submitted` or `paused` row with no active controller to abort, and
 * a `paused` row cannot even record the pause — so the resume it raced would
 * legally take the run back to `observing` without a debugger behind it. The
 * check is repeated here, synchronously, at the claim itself: the disconnect
 * listener marks the run before any await, and the compare-and-set that would
 * start page work is the last place to read that mark. A refused claim leaves
 * the row where it was, which is where the controller's own guards stop.
 */
const guardingBrowserOwnership = (
  port: AgentPersistencePort,
  ownsBrowser: (runId: string) => boolean
): AgentPersistencePort => {
  const refuse = (runId: string, to: AgentRunStatus) => {
    const refused = BROWSER_WORK_STATUSES.includes(to) && !ownsBrowser(runId)
    if (refused) {
      logger.warn("Agent refused page work without browser control", "Agent", {
        runId,
        to
      })
    }
    return refused
  }
  return {
    async claim(input) {
      if (refuse(input.runId, input.phase)) return { claimed: false }
      return port.claim(input)
    },
    async transition(input) {
      if (refuse(input.runId, input.to)) return { transitioned: false }
      return port.transition(input)
    },
    appendStep: (input) => port.appendStep(input),
    load: (runId) => port.load(runId),
    steps: (runId) => port.steps(runId)
  }
}

export type AgentRunFailureReason =
  | "already_running"
  | "browser_control_unavailable"
  | "permission_denied"
  | "tab_unsupported"
  | "unknown_run"

/**
 * A refusal the panel can act on. The reason travels, the message does not:
 * a thrown message can name the page URL or a provider response, and the panel
 * renders its own copy from the reason.
 */
export class AgentRunError extends Error {
  constructor(
    readonly reason: AgentRunFailureReason,
    message: string
  ) {
    super(message)
    this.name = "AgentRunError"
  }
}

const originOf = (url: string): string => {
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AgentRunError(
      "tab_unsupported",
      "Agent runs only on http(s) pages"
    )
  }
  return parsed.origin
}

/**
 * Owns the live run: one at a time, started from the panel and driven by the
 * runtime controller.
 *
 * A second run is refused while one is unresolved. The controlled tab, the
 * parked approval, the durable row and the control session all belong to that
 * one run, and nothing here can say which of two runs a page effect served.
 */
export const createAgentRunService = (input?: {
  browserSessions?: AgentBrowserSessionManager
  sessions?: AgentControlSessionRegistry
  supervision?: AgentSupervision
  history?: AgentTabHistory
  persistence?: AgentPersistencePort
  createRun?: typeof createAgentRun
  readRun?: typeof getAgentRun
  readLatestRun?: typeof getLatestAgentRun
  readIncompleteRuns?: typeof listIncompleteAgentRuns
  readSteps?: typeof listAgentSteps
  buildController?: BuildAgentController
  hasPerception?: () => Promise<boolean>
  getTab?: (tabId: number) => Promise<{ url?: string } | undefined>
  classifyAccess?: typeof classifyAgentTabAccess
  now?: () => number
  newRunId?: () => string
}): AgentRunService => {
  const sessions = input?.sessions ?? createAgentControlSessionRegistry()
  const supervision = input?.supervision ?? createAgentSupervision()
  const history = input?.history ?? createAgentTabHistory()
  const now = input?.now ?? (() => Date.now())
  const newRunId = input?.newRunId ?? (() => globalThis.crypto.randomUUID())
  const hasPerception = input?.hasPerception ?? hasAgentPerceptionPermission
  const createRun = input?.createRun ?? createAgentRun
  const readRun = input?.readRun ?? getAgentRun
  const readLatestRun = input?.readLatestRun ?? getLatestAgentRun
  const readSteps = input?.readSteps ?? listAgentSteps
  const readIncompleteRuns =
    input?.readIncompleteRuns ?? listIncompleteAgentRuns
  const classifyAccess = input?.classifyAccess ?? classifyAgentTabAccess
  const getTab =
    input?.getTab ??
    (async (tabId: number) => {
      try {
        return await browser.tabs.get(tabId)
      } catch {
        return undefined
      }
    })
  const browserSessions =
    input?.browserSessions ??
    ({
      capabilities: { backend: "dom", cdpControl: false, domControl: true },
      attach: async () => undefined,
      detach: async () => undefined,
      isAttached: () => true,
      subscribe: () => () => undefined,
      dispose: async () => undefined
    } satisfies AgentBrowserSessionManager)

  const detachBrowserSession = async (runId: string): Promise<void> => {
    try {
      await browserSessions.detach(runId)
    } catch (error) {
      logger.warn("Agent browser detach failed", "Agent", {
        runId,
        name: error instanceof Error ? error.name : typeof error
      })
    }
  }

  const listeners = new Set<(runId: string) => void>()
  const controllers = new Map<string, AgentController>()
  const experimental = new Set<string>()
  const interruptedBrowserSessions = new Set<string>()
  let admitting = false
  let activeRunId: string | undefined
  let lastRunId: string | undefined

  const announce = (runId: string) => {
    for (const listener of [...listeners]) listener(runId)
  }
  supervision.subscribe(announce)

  const releaseBrowserSessionFor = async (state: AgentRunState) => {
    if (
      [
        "awaiting_takeover",
        "pause_requested",
        "paused",
        "cancelling",
        "completed",
        "failed",
        "cancelled"
      ].includes(state.status)
    ) {
      await detachBrowserSession(state.id)
    }
  }

  const ownsBrowser = (runId: string): boolean =>
    browserSessions.isAttached(runId) && !interruptedBrowserSessions.has(runId)

  const persistence = announcing(
    guardingBrowserOwnership(
      input?.persistence ?? createAgentPersistencePort(),
      ownsBrowser
    ),
    announce,
    releaseBrowserSessionFor
  )

  const settle = async (runId: string) => {
    const state = await persistence.load(runId)
    if (!state || !isTerminalAgentStatus(state.status)) return
    await detachBrowserSession(runId)
    supervision.abandon(runId)
    sessions.release(runId)
    experimental.delete(runId)
    interruptedBrowserSessions.delete(runId)
    if (state.controlledTabId >= 0) history.forget(state.controlledTabId)
    controllers.delete(runId)
    if (activeRunId === runId) activeRunId = undefined
  }

  /** Assembled on first use, and reused for the life of the run. */
  const controllerFor = async (
    state: AgentRunState
  ): Promise<AgentController> => {
    const existing = controllers.get(state.id)
    if (existing) return existing
    const build =
      input?.buildController ??
      (await import("./agent-run-controller")).buildAgentController
    const controller = build({
      runId: state.id,
      sessions,
      history,
      persistence,
      supervision,
      allowExperimentalModel: experimental.has(state.id),
      now
    })
    controllers.set(state.id, controller)
    return controller
  }

  const drive = async (
    state: AgentRunState,
    work: (c: AgentController) => Promise<void>
  ) => {
    const controller = await controllerFor(state)
    return work(controller).finally(() => settle(state.id))
  }

  const loadRunning = async (runId: string): Promise<AgentRunState> => {
    const state = await persistence.load(runId)
    if (!state) throw new AgentRunError("unknown_run", "Agent run is unknown")
    return state
  }

  const attachBrowserSession = async (
    state: AgentRunState
  ): Promise<boolean> => {
    const tab = await getTab(state.controlledTabId)
    const address = tab?.url
    if (!address || (await classifyAccess(address)) !== "ok") {
      throw new AgentRunError(
        "tab_unsupported",
        "Agent controlled tab is no longer supported"
      )
    }
    interruptedBrowserSessions.delete(state.id)
    try {
      await browserSessions.attach(state.id, state.controlledTabId)
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        return false
      }
      throw new AgentRunError(
        "browser_control_unavailable",
        error instanceof Error
          ? error.message
          : "Agent browser control could not attach"
      )
    }
    return ownsBrowser(state.id)
  }

  browserSessions.subscribe((event) => {
    interruptedBrowserSessions.add(event.runId)
    void persistence
      .load(event.runId)
      .then((state) => {
        if (!state || isTerminalAgentStatus(state.status)) return
        return drive(state, (controller) =>
          controller.requestPause(event.runId, "browser_disconnected")
        )
      })
      .catch((error: unknown) => {
        logger.warn("Agent browser disconnect pause failed", "Agent", {
          runId: event.runId,
          reason: event.reason,
          name: error instanceof Error ? error.name : typeof error
        })
      })
  })

  return {
    async start(request) {
      // All panels share this service. Reserve admission before any async
      // read/check/write, including the durable unresolved-run lookup.
      if (admitting) {
        throw new AgentRunError(
          "already_running",
          "An Agent start is in progress"
        )
      }
      admitting = true
      try {
        /*
         * The durable rows decide, not the in-memory flag: an MV3 worker
         * restart forgets the active run, and a paused run the user has not
         * settled is still that user's run. Asking SQL is what keeps a restart
         * from letting a second run start beside it.
         */
        const unresolved = activeRunId ?? (await readIncompleteRuns())[0]?.id
        if (unresolved) {
          activeRunId = unresolved
          lastRunId = unresolved
          throw new AgentRunError(
            "already_running",
            "An Agent run is already unresolved"
          )
        }
        if (!(await hasPerception())) {
          throw new AgentRunError(
            "permission_denied",
            "Agent perception permission is not granted"
          )
        }
        const tab = await getTab(request.tabId)
        const address = tab?.url
        if (!address) {
          throw new AgentRunError("tab_unsupported", "Agent tab has no address")
        }
        const access = await classifyAccess(address)
        if (access !== "ok") {
          throw new AgentRunError(
            "tab_unsupported",
            `Agent tab access denied: ${access}`
          )
        }
        const startedAt = now()
        const state = AgentRunStateSchema.parse({
          version: 1,
          id: newRunId(),
          goal: request.goal,
          status: "submitted",
          stepCount: 0,
          observationCount: 0,
          controlledTabId: request.tabId,
          providerId: request.providerId,
          modelId: request.modelId,
          allowedOrigins: [originOf(address)],
          deadline: createInitialAgentDeadline(startedAt),
          createdAt: startedAt,
          updatedAt: startedAt
        } satisfies AgentRunState)

        await createRun(state)
        activeRunId = state.id
        lastRunId = state.id
        if (request.allowExperimentalModel) experimental.add(state.id)
        history.record(request.tabId, address)
        announce(state.id)
        try {
          const attached = await attachBrowserSession(state)
          if (!attached) return state
        } catch (error) {
          await persistence.transition({
            runId: state.id,
            from: "submitted",
            to: "failed",
            patch: {
              error: {
                code: "observation_failed",
                message: "Agent could not attach browser control.",
                retryable: true
              },
              updatedAt: now()
            }
          })
          await settle(state.id)
          throw error
        }
        void drive(state, (controller) => controller.start(state.id))
        return state
      } finally {
        admitting = false
      }
    },
    async pause(runId) {
      await drive(await loadRunning(runId), (controller) =>
        controller.requestPause(runId)
      )
    },
    async resume(runId) {
      const state = await loadRunning(runId)
      if (
        state.status !== "paused" ||
        state.pauseReason === "unresolved_effect" ||
        state.pauseReason === "question"
      ) {
        return
      }
      if (!(await attachBrowserSession(state))) return
      await drive(state, (controller) => controller.resume(runId))
    },
    async stop(runId) {
      await drive(await loadRunning(runId), (controller) =>
        controller.requestCancel(runId)
      )
    },
    async completeTakeover(runId) {
      const state = await loadRunning(runId)
      if (state.status !== "awaiting_takeover") return
      if (!(await attachBrowserSession(state))) return
      await drive(state, (controller) => controller.completeTakeover(runId))
    },
    answerApproval: (answer) => supervision.answerApproval(answer),
    answerTakeover: (answer) => supervision.answerTakeover(answer),
    async answerQuestion(answer) {
      const state = await loadRunning(answer.runId)
      if (
        state.status !== "paused" ||
        state.pauseReason !== "question" ||
        state.question?.id !== answer.questionId
      ) {
        return
      }
      if (!(await attachBrowserSession(state))) return
      await drive(state, (controller) => controller.answerQuestion(answer))
    },
    async snapshot(runId) {
      const durable = await readRun(runId)
      return {
        run: durable?.state,
        steps: durable ? await readSteps(runId) : [],
        pending: supervision.pending(runId)
      }
    },
    activeRunId: () => activeRunId,
    async latestRunId() {
      if (activeRunId ?? lastRunId) return activeRunId ?? lastRunId
      lastRunId = (await readLatestRun())?.id
      return lastRunId
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    adopt(runId) {
      activeRunId ??= runId
    }
  }
}
