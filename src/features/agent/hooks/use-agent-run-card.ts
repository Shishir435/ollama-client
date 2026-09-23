import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import type { AgentRunCard } from "@ollama-client/contracts/agent-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useEffect, useState } from "react"

import { logger } from "@/lib/logger"
import { extensionRpcClient } from "@/protocol/extension-client"

/** How often a card re-reads a run that has not settled. */
export const AGENT_RUN_CARD_REFRESH_MS = 2_000
/** How long a card waits after a read that failed. */
export const AGENT_RUN_CARD_RETRY_MS = 5_000

export type AgentRunCardState =
  | { kind: "loading" }
  | { kind: "ready"; run: AgentRunCard }
  | { kind: "missing" }

/**
 * The run a chat card reports, read from its durable row.
 *
 * Re-read while the run is unsettled and never after: a settled run cannot
 * change, and a card that kept asking would wake the worker for every
 * finished run in a long conversation. A failed read keeps what the card
 * already shows and tries again later — a card that blanked on one dropped
 * message would flicker every time the worker restarted.
 */
export const useAgentRunCard = (runId: string): AgentRunCardState => {
  const [state, setState] = useState<AgentRunCardState>({ kind: "loading" })

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // A request the schema refuses would fail, and be retried, forever.
    if (!runId) {
      setState({ kind: "missing" })
      return
    }
    setState({ kind: "loading" })

    const read = async () => {
      try {
        const { run } = await extensionRpcClient.call(RpcMethod.AgentGetRun, {
          runId
        })
        if (disposed) return
        if (!run) {
          setState({ kind: "missing" })
          return
        }
        setState({ kind: "ready", run })
        if (!isTerminalAgentStatus(run.status))
          timer = setTimeout(read, AGENT_RUN_CARD_REFRESH_MS)
      } catch (error) {
        if (disposed) return
        logger.warn("Agent run card could not be refreshed", "Agent", {
          name: error instanceof Error ? error.name : typeof error
        })
        timer = setTimeout(read, AGENT_RUN_CARD_RETRY_MS)
      }
    }
    void read()

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [runId])

  return state
}
