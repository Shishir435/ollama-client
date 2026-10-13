import type { AgentModelReadiness } from "@ollama-client/contracts"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useEffect, useState } from "react"
import { useSetting } from "@/hooks/use-setting"
import { logger } from "@/lib/logger"
import { SETTINGS } from "@/lib/storage/settings"
import { extensionRpcClient } from "@/protocol/extension-client"

export type AgentReadinessState =
  /** The agent is off, no model is selected, or the answer is not in yet. */
  | { kind: "hidden" }
  | { kind: "known"; readiness: AgentModelReadiness; qualified: boolean }

/**
 * Whether the selected model can drive the browser agent, asked before any
 * task is sent. Asked again whenever the model changes; nothing is shown
 * while the agent is off or while the answer is still coming, because a
 * guessed "ready" is the thing this exists to replace. A failed read shows
 * nothing rather than a refusal the start itself might not give.
 */
export const useAgentReadiness = (): AgentReadinessState => {
  const [enabled] = useSetting(SETTINGS.AGENT_ENABLED)
  const [selected] = useSetting(SETTINGS.SELECTED_MODEL_REF)
  const [state, setState] = useState<AgentReadinessState>({ kind: "hidden" })
  const providerId = selected?.providerId
  const modelId = selected?.modelId

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- A changed model or setting clears the previous model's answer before the new one is read.
    setState({ kind: "hidden" })
    if (!enabled || !providerId || !modelId) return
    let disposed = false
    extensionRpcClient
      .call(RpcMethod.AgentGetReadiness, { providerId, modelId })
      .then(
        ({ readiness, qualified }) => {
          if (disposed || !readiness) return
          setState({ kind: "known", readiness, qualified })
        },
        (error: unknown) => {
          if (disposed) return
          logger.warn("Agent readiness could not be read", "Agent", {
            name: error instanceof Error ? error.name : typeof error
          })
        }
      )
    return () => {
      disposed = true
    }
  }, [enabled, providerId, modelId])

  return state
}
