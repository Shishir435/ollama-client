import type {
  AgentFollowUpMode,
  AgentPanelCommand,
  AgentPanelSnapshot
} from "@ollama-client/contracts"
import { AgentPanelMessageSchema } from "@ollama-client/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  type AgentDebugReporter,
  requestAgentDebugReport
} from "./use-agent-debug-report"

export interface AgentCommandFailure {
  command: string
  messageKey: string
  message: string
  detail?: string
}

export interface AgentRunConnection {
  snapshot: AgentPanelSnapshot
  failure?: AgentCommandFailure
  busy: boolean
  /**
   * Resolves once the start was sent, or was not: `false` means no
   * `agent_start` left the panel — no port, no permission, nothing to run
   * with — so the caller holding the goal can give it back.
   */
  start(
    goal: string,
    allowRoutineActions?: boolean,
    followUp?: { parentRunId: string; mode: AgentFollowUpMode }
  ): Promise<boolean>
  pause(): void
  resume(): void
  correct(text: string): void
  debugReport: AgentDebugReporter
  stop(): void
  completeTakeover(): void
  resolveEffect(): void
  approve(scope?: "run_origin"): void
  reject(): void
  answerQuestion(text: string): void
  beginTakeover(): void
}

const EMPTY: AgentPanelSnapshot = { steps: [] }

interface UseAgentRunInput {
  providerId?: string
  modelId?: string
  /** Exact tab displayed by the panel when Start is pressed. */
  tabId?: number
  /** The chat a started run is written into, alongside its request. */
  sessionId?: string
  allowExperimentalModel?: boolean
}

/**
 * Holds the panel's supervision port for as long as the Agent surface is
 * mounted.
 *
 * The panel never keeps its own copy of run state: every control sends a
 * command and the next snapshot from the background is the answer. That is why
 * a run survives the panel closing — what the panel shows is a view of the
 * durable run, not the run itself.
 */
export const useAgentRun = (input: UseAgentRunInput): AgentRunConnection => {
  const [snapshot, setSnapshot] = useState<AgentPanelSnapshot>(EMPTY)
  const [failure, setFailure] = useState<AgentCommandFailure>()
  const [busy, setBusy] = useState(false)
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(
    null
  )

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let active = false
    // A supervised run may wait for a local model longer than the MV3 idle
    // window. Only the mounted panel keeps it awake; closing it still pauses.
    const heartbeat = setInterval(() => {
      if (active && portRef.current)
        portRef.current.postMessage({ type: "agent_refresh" })
    }, 20_000)

    const onMessage = (raw: unknown) => {
      const parsed = AgentPanelMessageSchema.safeParse(raw)
      if (!parsed.success) {
        /*
         * Dropping the update silently leaves the panel showing a run state
         * that has since moved on, which is indistinguishable from the agent
         * doing nothing. The paths say which field disagreed; the values stay
         * out of it.
         */
        const paths = parsed.error.issues
          .map((issue) => issue.path.join("."))
          .filter(Boolean)
        logger.warn("Discarded invalid Agent panel message", "Agent", {
          issues: parsed.error.issues.length,
          paths
        })
        setBusy(false)
        setFailure({
          command: "agent_snapshot",
          messageKey: "agent.error.unreadable_update",
          message: "The panel received an update it could not read.",
          detail: paths.slice(0, 6).join(", ")
        })
        return
      }
      if (parsed.data.type === "agent_debug_report") return
      setBusy(false)
      if (parsed.data.type === "agent_snapshot") {
        active = Boolean(
          parsed.data.snapshot.run &&
            !["completed", "failed", "cancelled", "paused"].includes(
              parsed.data.snapshot.run.status
            )
        )
        setSnapshot(parsed.data.snapshot)
        return
      }
      setFailure({
        command: parsed.data.command,
        messageKey: parsed.data.messageKey,
        message: parsed.data.message,
        detail: parsed.data.detail
      })
    }
    /*
     * The MV3 worker shuts down when idle and takes the port with it, and a
     * dropped port is silent: no error, just a panel that stops answering.
     * Reconnecting is what makes the surface survive an idle background — the
     * run itself is durable, so a fresh port simply asks for the snapshot
     * again.
     */
    const connect = () => {
      if (disposed) return
      const port = browser.runtime.connect({
        name: MESSAGE_KEYS.AGENT.RUN_PORT
      })
      portRef.current = port
      port.onMessage.addListener(onMessage)
      port.onDisconnect.addListener(() => {
        portRef.current = null
        setBusy(false)
        if (disposed) return
        attempt += 1
        retry = setTimeout(connect, Math.min(1_000 * attempt, 5_000))
      })
      attempt = 0
    }
    connect()

    return () => {
      disposed = true
      clearInterval(heartbeat)
      if (retry) clearTimeout(retry)
      const port = portRef.current
      portRef.current = null
      port?.onMessage.removeListener(onMessage)
      port?.disconnect()
    }
  }, [])

  /**
   * Whether the command reached a port; a reconnect window has none. A
   * command that went nowhere says so on the run, or a Stop pressed between
   * connections would look like a Stop the Agent ignored.
   */
  const send = useCallback((command: AgentPanelCommand): boolean => {
    const port = portRef.current
    if (!port) {
      setBusy(false)
      setFailure({
        command: command.type,
        messageKey: "agent.error.disconnected",
        message: "Agent was reconnecting and did not receive that."
      })
      return false
    }
    setFailure(undefined)
    setBusy(true)
    port.postMessage(command)
    return true
  }, [])

  const debugReport = useCallback<AgentDebugReporter>((runId, signal) => {
    const port = portRef.current
    if (!port) return Promise.reject(new Error("Agent background disconnected"))
    return requestAgentDebugReport(port, runId, signal)
  }, [])

  const runId = snapshot.run?.id
  const pending = snapshot.pending
  const { providerId, modelId, tabId, sessionId, allowExperimentalModel } =
    input

  const start = useCallback(
    (
      goal: string,
      allowRoutineActions = false,
      followUp?: { parentRunId: string; mode: AgentFollowUpMode }
    ) => {
      if (!providerId || !modelId || typeof tabId !== "number")
        return Promise.resolve(false)
      const trimmed = goal.trim()
      if (!trimmed) return Promise.resolve(false)
      const sent = send({
        type: "agent_start",
        goal: trimmed,
        tabId,
        providerId,
        modelId,
        ...(sessionId ? { sessionId } : {}),
        ...(followUp
          ? {
              followUp: {
                parentRunId: followUp.parentRunId,
                mode: followUp.mode
              }
            }
          : {}),
        ...(allowRoutineActions ? { allowRoutineActions: true } : {}),
        allowExperimentalModel
      })
      return Promise.resolve(sent)
    },
    [allowExperimentalModel, modelId, providerId, sessionId, tabId, send]
  )

  const runScoped = useCallback(
    (type: "agent_pause" | "agent_resume" | "agent_stop") => {
      if (!runId) return
      send({ type, runId })
    },
    [runId, send]
  )

  const answer = useCallback(
    (
      type:
        | "agent_approve"
        | "agent_reject"
        | "agent_takeover_started"
        | "agent_takeover_cancelled"
    ) => {
      if (!runId || !pending) return
      send({ type, runId, requestId: pending.request.id })
    },
    [pending, runId, send]
  )

  return {
    debugReport,
    correct(text) {
      const run = snapshot.run
      if (
        !run ||
        run.status !== "paused" ||
        run.pauseReason !== "user" ||
        !text.trim()
      )
        return
      send({
        type: "agent_resume",
        runId: run.id,
        text: text.trim(),
        pausedAt: run.updatedAt
      })
    },
    snapshot,
    failure,
    busy,
    start,
    pause: () => runScoped("agent_pause"),
    resume: () => runScoped("agent_resume"),
    stop: () => runScoped("agent_stop"),
    completeTakeover: () => {
      if (!runId) return
      send({ type: "agent_complete_takeover", runId })
    },
    /**
     * Named with the moment the user was shown, so a click on a panel that
     * has since moved on cannot resolve whatever replaced it.
     */
    resolveEffect: () => {
      const run = snapshot?.run
      if (!runId || !run || run.pauseReason !== "unresolved_effect") return
      send({ type: "agent_resolve_effect", runId, pausedAt: run.updatedAt })
    },
    approve: (scope?: "run_origin") => {
      if (!runId || !pending) return
      send({
        type: "agent_approve",
        runId,
        requestId: pending.request.id,
        ...(scope ? { scope } : {})
      })
    },
    reject: () => answer("agent_reject"),
    answerQuestion: (text: string) => {
      const question = snapshot?.run?.question
      /** The question is named, so a stale panel cannot answer its successor. */
      if (!runId || !question) return
      send({ type: "agent_answer", runId, requestId: question.id, text })
    },
    beginTakeover: () => answer("agent_takeover_started")
  }
}
