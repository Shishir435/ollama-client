import type { AgentModelReadiness } from "@ollama-client/contracts"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useEffect, useState } from "react"
import { AGENT_READINESS_EVIDENCE_KEYS } from "@/application/agent/agent-model-readiness"
import { useSetting } from "@/hooks/use-setting"
import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { SETTINGS } from "@/lib/storage/settings"
import { extensionRpcClient } from "@/protocol/extension-client"

export type AgentReadinessState =
  /** The agent is off, no model is selected, or the answer is not in yet. */
  | { kind: "hidden" }
  | { kind: "known"; readiness: AgentModelReadiness; qualified: boolean }

/**
 * Whether the selected model can drive the browser agent, asked before any
 * task is sent. Asked again whenever the model changes, and when the
 * evidence behind the verdict does (an override, a probe, a provider's
 * settings), shortly after the background drops its cached answer; nothing is shown
 * while the agent is off or while the answer is still coming, because a
 * guessed "ready" is the thing this exists to replace. A failed read shows
 * nothing rather than a refusal the start itself might not give.
 */
export const useAgentReadiness = (): AgentReadinessState => {
  const [enabled] = useSetting(SETTINGS.AGENT_ENABLED)
  const [selected] = useSetting(SETTINGS.SELECTED_MODEL_REF)
  const providerId = selected?.providerId
  const modelId = selected?.modelId
  const [revision, setRevision] = useState(0)
  const requestKey = JSON.stringify([enabled, providerId, modelId, revision])
  const [result, setResult] = useState<{
    key: string
    state: AgentReadinessState
  } | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChanged = (changes: Record<string, unknown>) => {
      if (!AGENT_READINESS_EVIDENCE_KEYS.some((key) => key in changes)) return
      clearTimeout(timer)
      timer = setTimeout(() => setRevision((value) => value + 1), 250)
    }
    browser.storage.onChanged.addListener(onChanged)
    return () => {
      clearTimeout(timer)
      browser.storage.onChanged.removeListener(onChanged)
    }
  }, [])

  useEffect(() => {
    if (!enabled || !providerId || !modelId) return
    let disposed = false
    extensionRpcClient
      .call(RpcMethod.AgentGetReadiness, { providerId, modelId })
      .then(
        ({ readiness, qualified }) => {
          if (disposed || !readiness) return
          setResult({
            key: requestKey,
            state: { kind: "known", readiness, qualified }
          })
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
  }, [enabled, modelId, providerId, requestKey])

  return enabled && providerId && modelId && result?.key === requestKey
    ? result.state
    : { kind: "hidden" }
}
