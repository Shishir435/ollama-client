import type {
  AgentPanelCommand,
  AgentPanelMessage,
  AgentPanelSnapshot
} from "@ollama-client/contracts"
import {
  AGENT_PANEL_PROTOCOL_VERSION,
  AgentPanelCommandSchema
} from "@ollama-client/contracts"
import { classifyRuntimeSender } from "@ollama-client/runtime-core/runtime-sender"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { PersistenceError } from "@/lib/persistence/errors"
import type {
  AgentRunFailureReason,
  AgentRunService
} from "./agent-run-service"
import { AgentRunError } from "./agent-run-service"

/**
 * The panel's transport. Agent owns it rather than Chat's port router: the
 * protocol is its own, and the agent domain composes without reaching into
 * Chat's composition.
 *
 * Extension pages only. A content script is page-controlled, and a page that
 * could open this port could start a run, answer its own approval, and drive
 * the browser as the user.
 */
export interface AgentPanelPortDependencies {
  /** Recovery must finish before a new run can own durable rows. */
  ready?: Promise<void>
  service: AgentRunService
  resolveProvider?: (
    providerId?: string,
    modelId?: string
  ) => Promise<AgentPanelSnapshot["provider"]>
  /**
   * The tab a run controls. Only a run has one: the candidate a run would
   * control is resolved in the panel, which unlike a service worker knows
   * which window is being looked at.
   */
  resolveTab?: (tabId: number) => Promise<AgentPanelSnapshot["tab"]>
}

interface PanelPort {
  name: string
  postMessage(message: AgentPanelMessage): void
  disconnect(): void
  onMessage: {
    addListener(listener: (message: unknown) => void): void
  }
  onDisconnect: {
    addListener(listener: () => void): void
  }
}

const UNKNOWN_FAILURE = {
  key: "agent.error.unknown",
  text: "Agent could not complete that request."
} as const

/**
 * A failure reaches the panel as a key plus safe text. The thrown message can
 * name the page URL or a provider response, so only the typed reason travels;
 * anything else is reported as the generic failure.
 */
const FAILURES: Record<AgentRunFailureReason, { key: string; text: string }> = {
  already_running: {
    key: "agent.error.already_running",
    text: "An Agent run is already in progress."
  },
  permission_denied: {
    key: "agent.error.permission_denied",
    text: "Agent needs page-observation permission before it can start."
  },
  tab_unsupported: {
    key: "agent.error.tab_unsupported",
    text: "Agent cannot run on this page. Open a normal web page and try again."
  },
  unknown_run: UNKNOWN_FAILURE
}

const describeFailure = (
  command: string,
  error: unknown
): { key: string; text: string; detail?: string } => {
  if (error instanceof AgentRunError) return FAILURES[error.reason]
  /*
   * An unclassified failure is a bug, not a refusal: the panel can only say
   * so generically, so the cause is recorded here or it is lost entirely.
   */
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message : "unknown"
  logger.error("Agent command failed unexpectedly", "Agent", {
    command,
    name,
    message
  })
  /*
   * A persistence failure says only which op and reason in its message; what
   * actually happened is SQLite's own text, which the error keeps out of logs
   * and diagnostics bundles by design. Reading it by name here is the
   * deliberate exception the class documents, and it goes to the panel — the
   * user's own screen — never to the logger.
   */
  const detail =
    error instanceof PersistenceError && error.detail
      ? `${name}: ${message} — ${error.detail}`
      : `${name}: ${message}`
  return { ...UNKNOWN_FAILURE, detail: detail.slice(0, 300) }
}

export const registerAgentPanelPort = (
  dependencies: AgentPanelPortDependencies
): (() => void) => {
  const extensionUrlPrefix = browser.runtime.getURL("")
  let connectedPanels = 0

  const snapshotFor = async (runId?: string): Promise<AgentPanelSnapshot> => {
    if (!runId) {
      return { steps: [], provider: await dependencies.resolveProvider?.() }
    }
    const snapshot = await dependencies.service.snapshot(runId)
    const provider = await dependencies.resolveProvider?.(
      snapshot.run?.providerId,
      snapshot.run?.modelId
    )
    return {
      run: snapshot.run,
      steps: snapshot.steps.map((step) => ({
        runId: step.runId,
        stepId: step.stepId,
        sequence: step.sequence,
        status: step.status,
        at: step.at,
        command: step.command,
        risk: step.risk,
        verification: step.verification,
        target: step.target,
        sourceUrl: step.sourceUrl,
        finding: step.finding
      })),
      pending: snapshot.pending,
      provider,
      tab: snapshot.run
        ? await dependencies.resolveTab?.(snapshot.run.controlledTabId)
        : undefined
    }
  }

  const listener = (rawPort: unknown) => {
    const port = rawPort as PanelPort & {
      sender?: Parameters<typeof classifyRuntimeSender>[0]
    }
    if (port.name !== MESSAGE_KEYS.AGENT.RUN_PORT) return

    const surface = classifyRuntimeSender(
      port.sender ?? {},
      browser.runtime.id,
      extensionUrlPrefix
    )
    if (surface !== "extension-page") {
      logger.warn("Blocked Agent panel port", "RuntimeAuthorization", {
        surface
      })
      port.disconnect()
      return
    }

    connectedPanels += 1
    let closed = false
    const publish = async (runId?: string) => {
      try {
        await dependencies.ready
        if (closed) return
        port.postMessage({
          type: "agent_snapshot",
          version: AGENT_PANEL_PROTOCOL_VERSION,
          snapshot: await snapshotFor(
            runId ?? (await dependencies.service.latestRunId())
          )
        })
      } catch (error) {
        logger.warn("Agent snapshot delivery failed", "Agent", {
          reason: error instanceof Error ? error.name : "unknown"
        })
      }
    }

    const unsubscribe = dependencies.service.subscribe((runId) => {
      void publish(runId)
    })
    port.onDisconnect.addListener(() => {
      if (closed) return
      closed = true
      unsubscribe()
      connectedPanels = Math.max(0, connectedPanels - 1)
      const runId = dependencies.service.activeRunId()
      if (connectedPanels === 0 && runId) {
        void dependencies.service.pause(runId).catch((error: unknown) => {
          logger.warn("Agent pause after panel disconnect failed", "Agent", {
            name: error instanceof Error ? error.name : typeof error
          })
        })
      }
    })

    const run = async (command: AgentPanelCommand): Promise<void> => {
      await dependencies.ready
      if (closed) return
      const service = dependencies.service
      switch (command.type) {
        case "agent_start":
          await service.start({
            goal: command.goal,
            tabId: command.tabId,
            providerId: command.providerId,
            modelId: command.modelId,
            allowExperimentalModel: command.allowExperimentalModel
          })
          return
        case "agent_pause":
          await service.pause(command.runId)
          return
        case "agent_resume":
          await service.resume(command.runId)
          return
        case "agent_stop":
          await service.stop(command.runId)
          return
        case "agent_complete_takeover":
          await service.completeTakeover(command.runId)
          return
        case "agent_approve":
          service.answerApproval({
            runId: command.runId,
            requestId: command.requestId,
            decision: { type: "approved" }
          })
          return
        case "agent_reject":
          service.answerApproval({
            runId: command.runId,
            requestId: command.requestId,
            decision: { type: "rejected" }
          })
          return
        case "agent_takeover_started":
          service.answerTakeover({
            runId: command.runId,
            requestId: command.requestId,
            decision: { type: "takeover_started" }
          })
          return
        case "agent_takeover_cancelled":
          service.answerTakeover({
            runId: command.runId,
            requestId: command.requestId,
            decision: { type: "cancelled" }
          })
          return
        default:
          await publish()
      }
    }

    port.onMessage.addListener((message) => {
      const parsed = AgentPanelCommandSchema.safeParse(message)
      if (!parsed.success) {
        logger.warn("Blocked invalid Agent panel command", "Agent", {
          issues: parsed.error.issues.length
        })
        port.disconnect()
        return
      }
      void run(parsed.data)
        .catch((error: unknown) => {
          if (closed) return
          const failure = describeFailure(parsed.data.type, error)
          port.postMessage({
            type: "agent_command_failed",
            version: AGENT_PANEL_PROTOCOL_VERSION,
            command: parsed.data.type,
            messageKey: failure.key,
            message: failure.text,
            ...(failure.detail ? { detail: failure.detail } : {})
          })
        })
        .finally(() => {
          void publish()
        })
    })

    void publish()
  }

  browser.runtime.onConnect.addListener(
    listener as Parameters<typeof browser.runtime.onConnect.addListener>[0]
  )
  return () =>
    browser.runtime.onConnect.removeListener(
      listener as Parameters<typeof browser.runtime.onConnect.removeListener>[0]
    )
}
