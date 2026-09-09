import type {
  AgentPanelCommand,
  AgentPanelSnapshot
} from "@ollama-client/contracts"
import { AgentPanelMessageSchema } from "@ollama-client/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { requestAgentPerceptionPermission } from "@/lib/permissions"

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
  start(goal: string): void
  pause(): void
  resume(): void
  stop(): void
  completeTakeover(): void
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

  const send = useCallback((command: AgentPanelCommand) => {
    const port = portRef.current
    if (!port) return
    setFailure(undefined)
    setBusy(true)
    port.postMessage(command)
  }, [])

  const runId = snapshot.run?.id
  const pending = snapshot.pending
  const { providerId, modelId, tabId, allowExperimentalModel } = input

  const start = useCallback(
    (goal: string) => {
      if (!providerId || !modelId || typeof tabId !== "number") return
      const trimmed = goal.trim()
      if (!trimmed) return
      setBusy(true)
      /*
       * The permission request goes first and unawaited-by-anything-else:
       * Chromium only honours `permissions.request` while the click that
       * caused it is still the current task, and an already-granted
       * permission resolves without prompting. Querying the tab first would
       * spend the gesture and leave the user with a silent refusal.
       */
      void requestAgentPerceptionPermission()
        .then((granted) => {
          if (!granted) {
            setBusy(false)
            setFailure({
              command: "agent_start",
              messageKey: "agent.error.permission_denied",
              message: "Agent needs page-observation permission to start."
            })
            return undefined
          }
          send({
            type: "agent_start",
            goal: trimmed,
            tabId,
            providerId,
            modelId,
            allowExperimentalModel
          })
        })
        .catch(() => setBusy(false))
    },
    [allowExperimentalModel, modelId, providerId, tabId, send]
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
