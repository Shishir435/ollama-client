import type {
  AgentApprovalDecision,
  AgentController,
  AgentPersistencePort,
  AgentTakeoverDecision
} from "@ollama-client/agent-runtime"
import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import type {
  AgentPauseReason,
  AgentRunState,
  AgentRunStatus
} from "@ollama-client/contracts"
import {
  AGENT_ROUTINE_GRANT_EFFECTS,
  AgentRunStateSchema
} from "@ollama-client/contracts"

import { browser } from "@/lib/browser-api"
import { classifyAgentTabAccess } from "@/lib/browser-tab-access"
import { logger } from "@/lib/logger"
import { hasAgentPerceptionPermission } from "@/lib/permissions"
import type { DurableAgentStep } from "@/lib/repositories/agent-runs"
import {
  createAgentPersistencePort,
  createInitialAgentDeadline,
  getAgentRun,
  getLatestAgentRun,
  listAgentSteps,
  listIncompleteAgentRuns
} from "@/lib/repositories/agent-runs"
import type { AgentBrowserSessionManager } from "./agent-browser-session-manager"
import type { AgentControlSessionRegistry } from "./agent-control-sessions"
import { createAgentControlSessionRegistry } from "./agent-control-sessions"
import {
  type AgentFollowUpRequest,
  resolveAgentFollowUp
} from "./agent-follow-up"
import type { BuildAgentController } from "./agent-run-controller"
import { createLinkedAgentRun } from "./agent-run-linkage"
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
  /** The chat whose rows are written in the same commit as the run. */
  sessionId?: string
  /** The settled run this one follows, and how; see `agent-follow-up.ts`. */
  followUp?: AgentFollowUpRequest
  allowRoutineActions?: boolean
  allowExperimentalModel?: boolean
}

export interface AgentRunSnapshot {
  run?: AgentRunState
  steps: DurableAgentStep[]
  pending?: AgentPendingSupervision
}

export interface AgentRunService {
  start(input: StartAgentRunInput): Promise<AgentRunState>
  pause(runId: string, reason?: AgentPauseReason): Promise<void>
  resume(
    runId: string,
    correction?: { text: string; pausedAt: number }
  ): Promise<void>
  stop(runId: string): Promise<void>
  completeTakeover(runId: string): Promise<void>
  resolveEffect(input: { runId: string; pausedAt: number }): Promise<void>
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
  | "follow_up_unavailable"
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
/** Pauses the run comes back from on the same page, holding its dialog. */
const DIALOG_HOLDING_PAUSES: readonly AgentPauseReason[] = [
  "user",
  "question",
  "unresolved_effect"
]

export const createAgentRunService = (input?: {
  browserSessions?: AgentBrowserSessionManager
  sessions?: AgentControlSessionRegistry
  supervision?: AgentSupervision
  history?: AgentTabHistory
  persistence?: AgentPersistencePort
  createRun?: typeof createLinkedAgentRun
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
  const createRun = input?.createRun ?? createLinkedAgentRun
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
      capabilities: {
        backend: "dom",
        cdpControl: false,
        domControl: true,
        frameTracking: false
      },
      attach: async () => undefined,
      detach: async () => undefined,
      isAttached: () => true,
      attachedTabId: () => undefined,
      frames: () => ({ status: "unavailable", frames: [] }),
      mapFrame: () => ({ mapped: false, reason: "tracking_unavailable" }),
      subscribe: () => () => undefined,
      nativeInput: () => undefined,
      /** No debugger, so no dialog is ever intercepted or answerable. */
      openDialog: () => undefined,
      handleDialog: async () => "not_open" as const,
      dispose: async () => undefined
    } satisfies AgentBrowserSessionManager)

  const recordedDialogDismissals = new Set<string>()
  const browserSessionIds = new Map<string, string>()
  const pendingDialogDismissals = new Map<
    string,
    { runId: string; dialogId: string; stepId: string; detached: boolean }
  >()
  const finishPendingDialogDismissals = async (
    runId: string,
    quarantineOnFailure = false
  ): Promise<void> => {
    for (const [dismissalId, pending] of pendingDialogDismissals) {
      if (pending.runId !== runId) continue
      if (!pending.detached) {
        if (quarantineOnFailure) pendingDialogDismissals.delete(dismissalId)
        continue
      }
      try {
        const at = now()
        await persistence.appendStep({
          runId,
          stepId: pending.stepId,
          status: "verified",
          at,
          command: {
            type: "handle_dialog",
            snapshotId: `dialog-release:${pending.dialogId}`,
            generation: 0,
            dialogId: pending.dialogId,
            accept: false
          },
          mutating: false,
          verification: {
            outcome: "confirmed",
            evidence: {
              kind: "dialog_release",
              summary:
                "Browser control ended with the native dialog dismissed.",
              observedAt: at
            }
          }
        })
        recordedDialogDismissals.add(dismissalId)
        pendingDialogDismissals.delete(dismissalId)
      } catch (error) {
        // The uncertain intent remains durable. A new attachment must not
        // inherit this session's pending release or suppress its own dialog.
        if (quarantineOnFailure) pendingDialogDismissals.delete(dismissalId)
        logger.warn("Agent dialog release receipt failed", "Agent", {
          runId,
          name: error instanceof Error ? error.name : typeof error
        })
      }
    }
  }
  const attachBrowserControl = async (
    runId: string,
    tabId: number
  ): Promise<void> => {
    const alreadyAttached = browserSessions.attachedTabId(runId) !== undefined
    if (!alreadyAttached) await finishPendingDialogDismissals(runId, true)
    await browserSessions.attach(runId, tabId)
    if (!alreadyAttached) {
      browserSessionIds.set(runId, globalThis.crypto.randomUUID())
    }
  }
  const detachBrowserSession = async (runId: string): Promise<void> => {
    try {
      const tabId = browserSessions.attachedTabId(runId)
      const held =
        tabId === undefined
          ? undefined
          : browserSessions.openDialog(runId, tabId)
      const dismissalId = held
        ? `${runId}:dialog-release:${browserSessionIds.get(runId) ?? "unknown"}:${held.id}`
        : undefined
      if (
        held &&
        dismissalId &&
        !recordedDialogDismissals.has(dismissalId) &&
        !pendingDialogDismissals.has(dismissalId)
      ) {
        const at = now()
        const stepId = dismissalId
        // Persist the uncertain release before detach can dismiss the dialog.
        // If the worker dies or the final write fails, history still records
        // that the dialog outcome is unresolved.
        try {
          await persistence.appendStep({
            runId,
            stepId,
            status: "uncertain",
            at,
            command: {
              type: "handle_dialog",
              snapshotId: `dialog-release:${held.id}`,
              generation: 0,
              dialogId: held.id,
              accept: false
            },
            mutating: false,
            verification: {
              outcome: "ambiguous",
              evidence: {
                kind: "dialog_release",
                summary:
                  "Browser control release started; dialog outcome is unconfirmed.",
                observedAt: at
              }
            }
          })
          pendingDialogDismissals.set(dismissalId, {
            runId,
            dialogId: held.id,
            stepId,
            detached: false
          })
        } catch (error) {
          // The page cannot stay blocked by an orphaned dialog when storage
          // fails. Release it, while leaving the failed write visible in logs.
          logger.warn("Agent dialog release intent failed", "Agent", {
            runId,
            name: error instanceof Error ? error.name : typeof error
          })
        }
      }
      await browserSessions.detach(runId)
      if (dismissalId) {
        const pending = pendingDialogDismissals.get(dismissalId)
        if (pending) pending.detached = true
      }
      await finishPendingDialogDismissals(runId)
    } catch (error) {
      logger.warn("Agent browser release failed", "Agent", {
        runId,
        name: error instanceof Error ? error.name : typeof error
      })
    }
  }

  const listeners = new Set<(runId: string) => void>()
  const controllers = new Map<string, AgentController>()
  const experimental = new Set<string>()
  const interruptedBrowserSessions = new Set<string>()
  /** In-flight Done presses, so two of them converge on one resume. */
  const takeoverCompletions = new Map<string, Promise<void>>()
  let admitting = false
  let activeRunId: string | undefined
  let lastRunId: string | undefined

  const announce = (runId: string) => {
    for (const listener of listeners) listener(runId)
  }
  supervision.subscribe(announce)

  /**
   * A pause the run will come back from keeps a dialog it is holding.
   *
   * Letting go of the debugger dismisses a held dialog, because a detached
   * tab would otherwise stay frozen with nothing to answer it — and a
   * dismissed `confirm` is the page being told "no". A user who paused while
   * a Delete button's confirmation was open came back to a page that had
   * cancelled the delete, a model that clicked Delete again, and a second
   * approval for the same decision. So a pause taken by the user, for a
   * question, or over an unresolved effect keeps the session and the dialog
   * exactly as they were; resuming observes the same dialog and asks about
   * it. A takeover still lets go: the user is about to act on the page
   * themselves, and a page held by a dialog they cannot see is one they
   * cannot act on. A closed panel or a lost browser lets go as before.
   */
  const holdsDialogThroughPause = (state: AgentRunState): boolean => {
    if (state.status !== "pause_requested" && state.status !== "paused") {
      return false
    }
    if (
      !state.pauseReason ||
      !DIALOG_HOLDING_PAUSES.includes(state.pauseReason)
    ) {
      return false
    }
    return (
      browserSessions.openDialog(state.id, state.controlledTabId) !== undefined
    )
  }

  const releaseBrowserSessionFor = async (state: AgentRunState) => {
    if (holdsDialogThroughPause(state)) return
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
      return
    }
    await followControlledTab(state)
  }

  /**
   * The debugger follows the run onto the tab it now controls. Adoption is
   * written in the same claim that opens the next observation, so this runs
   * before that observation is taken; a tab the run left keeps no attachment,
   * and a tab it moved to gets one before any page work is claimed on it.
   * An attach that fails leaves the run marked as interrupted, which the
   * ownership gate turns into a refused claim and the disconnect path into a
   * recorded pause.
   */
  const followControlledTab = async (state: AgentRunState) => {
    if (state.status !== "observing") return
    const attached = browserSessions.attachedTabId(state.id)
    if (attached === undefined || attached === state.controlledTabId) return
    await detachBrowserSession(state.id)
    try {
      await attachBrowserControl(state.id, state.controlledTabId)
    } catch (error) {
      interruptedBrowserSessions.add(state.id)
      logger.warn("Agent browser attach did not follow the run", "Agent", {
        runId: state.id,
        name: error instanceof Error ? error.name : typeof error
      })
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
      browserSessions,
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

  /**
   * One Done press, run to completion.
   *
   * Done pressed before Started still holds the run loop inside its parked
   * takeover wait, and the completion call below no-ops against that guard —
   * the stall that left file and sensitive-input handoffs in
   * `awaiting_takeover` with no new observation. Answering started here
   * releases the loop first; the answer is idempotent, so an already
   * acknowledged Started is answered nothing twice.
   *
   * The settle announces synchronously while the loop unwinds on microtasks
   * already queued ahead of the waiter, so the wait below ends after the run
   * is free rather than while it is still guarded. The timeout is deadlock
   * insurance only: even if it fires, the next Done press converges, because
   * the parked wait is already settled and cannot stall twice.
   */
  const runTakeoverCompletion = async (runId: string): Promise<void> => {
    const state = await loadRunning(runId)
    if (state.status !== "awaiting_takeover") return
    const pending = supervision.pending(runId)
    if (pending?.kind === "takeover") {
      let settled = false
      let release: () => void = () => undefined
      const unsubscribe = supervision.subscribe((announced) => {
        if (announced !== runId || settled) return
        settled = true
        unsubscribe()
        release()
      })
      const exited = new Promise<void>((resolve) => {
        release = () => resolve()
        setTimeout(() => {
          if (settled) return
          settled = true
          unsubscribe()
          resolve()
        }, 10_000)
      })
      const answered = supervision.answerTakeover({
        runId,
        requestId: pending.request.id,
        decision: { type: "takeover_started" }
      })
      if (answered) await exited
      else if (!settled) {
        // A Started press won the race and its settle already announced
        // before this subscription existed: nothing to wait for.
        settled = true
        unsubscribe()
      }
    }
    const fresh = await loadRunning(runId)
    if (fresh.status !== "awaiting_takeover") return
    if (!(await attachBrowserSession(fresh))) return
    await drive(fresh, (controller) => controller.completeTakeover(runId))
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
      await attachBrowserControl(state.id, state.controlledTabId)
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

  /**
   * The record a follow-up start carries, or a refusal that leaves nothing
   * behind: no rows, no run, the panel told why.
   */
  const previousRunFor = async (
    request: StartAgentRunInput
  ): Promise<AgentRunState["previousRun"]> => {
    if (!request.followUp) return undefined
    const followUp = await resolveAgentFollowUp(
      request.followUp,
      request.sessionId,
      { run: readRun, steps: readSteps }
    )
    if (followUp.ok) return followUp.previousRun
    logger.warn("Agent follow-up refused", "Agent", {
      parentRunId: request.followUp.parentRunId,
      reason: followUp.reason
    })
    throw new AgentRunError(
      "follow_up_unavailable",
      `Agent follow-up unavailable: ${followUp.reason}`
    )
  }

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
        /**
         * Read after admission and before the row exists, so the parent it
         * describes is the one this run is created against.
         */
        const previousRun = await previousRunFor(request)
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
          ...(request.allowRoutineActions
            ? {
                grants: [
                  {
                    origin: originOf(address),
                    effects: [...AGENT_ROUTINE_GRANT_EFFECTS],
                    grantedAt: startedAt
                  }
                ]
              }
            : {}),
          scopedTabIds: [request.tabId],
          deadline: createInitialAgentDeadline(startedAt),
          /**
           * The parent's record and what it committed — never its grants,
           * answers, requirements or origins. A follow-up plans again and
           * asks again; what it inherits is only what it must not repeat.
           */
          ...(previousRun ? { previousRun } : {}),
          createdAt: startedAt,
          updatedAt: startedAt
        } satisfies AgentRunState)

        await createRun(
          state,
          request.sessionId,
          previousRun ? request.followUp?.parentRunId : undefined
        )
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
        /**
         * Detached on purpose — `start` returns once the run is admitted, not
         * once it finishes — but its rejection is not. Every other `drive`
         * call site is awaited by a caller that reports the failure; this one
         * discarded it, so a run that threw on its first step left no error
         * on the row, no line in the log and a panel that waited. That cost
         * two browser gates thirty seconds each and an afternoon to find.
         *
         * Logging is all this does. The run is still left where it stopped:
         * transitioning it to `failed` needs the predecessor it stopped in,
         * which this layer does not know, and is its own change.
         */
        void drive(state, (controller) => controller.start(state.id)).catch(
          (error: unknown) => {
            logger.error("Agent run stopped without settling", "Agent", {
              runId: state.id,
              name: error instanceof Error ? error.name : typeof error,
              message: error instanceof Error ? error.message : "unknown"
            })
          }
        )
        return state
      } finally {
        admitting = false
      }
    },
    async pause(runId, reason = "user") {
      try {
        const state = await loadRunning(runId)
        if (state.status !== "paused") {
          await drive(state, (controller) =>
            controller.requestPause(runId, reason)
          )
        }
      } finally {
        // A panel can close after an earlier user/question pause already held
        // a dialog. That pause cannot transition again, but the last panel
        // must still release the browser it can no longer supervise.
        if (reason === "panel_closed") await detachBrowserSession(runId)
      }
    },
    async resume(runId, correction) {
      const state = await loadRunning(runId)
      if (
        state.status !== "paused" ||
        state.pauseReason === "unresolved_effect" ||
        state.pauseReason === "question"
      ) {
        return
      }
      if (
        correction &&
        (state.pauseReason !== "user" ||
          state.updatedAt !== correction.pausedAt)
      )
        return
      if (!(await attachBrowserSession(state))) return
      await drive(state, (controller) =>
        correction
          ? controller.resume(runId, correction)
          : controller.resume(runId)
      )
    },
    async stop(runId) {
      await drive(await loadRunning(runId), (controller) =>
        controller.requestCancel(runId)
      )
    },
    async completeTakeover(runId) {
      const ongoing = takeoverCompletions.get(runId)
      if (ongoing) {
        await ongoing
        return
      }
      const completion = runTakeoverCompletion(runId)
      takeoverCompletions.set(runId, completion)
      try {
        await completion
      } finally {
        if (takeoverCompletions.get(runId) === completion)
          takeoverCompletions.delete(runId)
      }
    },
    /**
     * Browser control was released when the run paused, so it is re-attached
     * here exactly as a completed takeover re-attaches it, before the run
     * looks at the page again.
     */
    async resolveEffect({ runId, pausedAt }) {
      const state = await loadRunning(runId)
      if (
        state.status !== "paused" ||
        state.pauseReason !== "unresolved_effect"
      ) {
        return
      }
      /**
       * The same staleness the controller checks, checked before the debugger
       * is attached rather than after. A click on a panel the run has already
       * moved past resolves nothing, and attaching for it left the tab wearing
       * the debugging banner with the run still paused — the detach hook runs
       * at pause boundaries, and this crossed none.
       */
      if (state.updatedAt !== pausedAt) return
      if (!(await attachBrowserSession(state))) return
      await drive(state, (controller) =>
        controller.resolveEffect({ runId, pausedAt })
      )
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
