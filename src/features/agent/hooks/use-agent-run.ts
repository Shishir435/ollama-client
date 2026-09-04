import type {
  AgentPanelCommand,
  AgentPanelSnapshot
} from "@ollama-client/contracts"
import { AgentPanelMessageSchema } from "@ollama-client/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

import { browser } from "@/lib/browser-api"
import { queryActiveTab } from "@/lib/browser-tab-access"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { requestAgentPerceptionPermission } from "@/lib/permissions"

export interface AgentCommandFailure {
  command: string
  messageKey: string
  message: string
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
  approve(): void
  reject(): void
  beginTakeover(): void
}

const EMPTY: AgentPanelSnapshot = { steps: [] }

interface UseAgentRunInput {
  providerId?: string
  modelId?: string
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

    const onMessage = (raw: unknown) => {
      const parsed = AgentPanelMessageSchema.safeParse(raw)
      if (!parsed.success) {
        logger.warn("Discarded invalid Agent panel message", "Agent", {
          issues: parsed.error.issues.length
        })
        return
      }
      setBusy(false)
      if (parsed.data.type === "agent_snapshot") {
        setSnapshot(parsed.data.snapshot)
        return
      }
      setFailure({
        command: parsed.data.command,
        messageKey: parsed.data.messageKey,
        message: parsed.data.message
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

  const start = useCallback(
    (goal: string) => {
      if (!input.providerId || !input.modelId) return
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
        .then(async (granted) => {
          if (!granted) {
            setBusy(false)
            setFailure({
              command: "agent_start",
              messageKey: "agent.error.permission_denied",
              message: "Agent needs page-observation permission to start."
            })
            return undefined
          }
          return queryActiveTab()
        })
        .then((tab) => {
          if (!tab) return
          if (typeof tab.id !== "number") {
            setBusy(false)
            return
          }
          send({
            type: "agent_start",
            goal: trimmed,
            tabId: tab.id,
            providerId: input.providerId as string,
            modelId: input.modelId as string,
            allowExperimentalModel: input.allowExperimentalModel
          })
        })
        .catch(() => setBusy(false))
    },
    [input.allowExperimentalModel, input.modelId, input.providerId, send]
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
    approve: () => answer("agent_approve"),
    reject: () => answer("agent_reject"),
    beginTakeover: () => answer("agent_takeover_started")
  }
}
