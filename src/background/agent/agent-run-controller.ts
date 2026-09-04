import type {
  AgentController,
  AgentModelPort,
  AgentPersistencePort
} from "@ollama-client/agent-runtime"
import {
  createAgentController,
  evaluateAgentPolicy
} from "@ollama-client/agent-runtime"

import { createProviderAgentModelPort } from "@/application/agent/agent-model-port"
import { logger } from "@/lib/logger"
import { createAgentBrowserAdapters } from "./agent-browser-adapters"
import type { AgentControlSessionRegistry } from "./agent-control-sessions"
import { createAgentEffectPort } from "./agent-effect-port"
import type { AgentSupervision } from "./agent-supervision"
import type { AgentTabHistory } from "./agent-tab-history"

/**
 * How long one decision may take before the run gives up on it.
 *
 * The runtime records deadlines but enforces none: a provider that accepts the
 * request and never answers leaves the run in `deciding` with a panel that
 * says "Choosing next step" and never changes. A local model reading a large
 * page is genuinely slow, so this is generous — it exists to turn a hang into
 * a reported failure, not to police latency.
 */
const DECISION_TIMEOUT_MS = 120_000

const withDecisionTimeout = (
  model: AgentModelPort,
  timeoutMs: number
): AgentModelPort => ({
  async decide(input, signal) {
    const scope = new AbortController()
    let timedOut = false
    const abort = () => scope.abort()
    if (signal.aborted) scope.abort()
    else signal.addEventListener?.("abort", abort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      abort()
    }, timeoutMs)
    const startedAt = Date.now()
    try {
      const decision = await model.decide(input, scope.signal)
      logger.info("Agent decision received", "Agent", {
        runId: input.state.id,
        model: input.state.modelId,
        elapsedMs: Date.now() - startedAt,
        decision: decision.type
      })
      return decision
    } catch (error) {
      /*
       * A decision that ends without an answer is the hardest failure to read
       * from the outside: an aborted stream looks the same whether the run was
       * stopped, the bound deadline fired, or something else cancelled it. The
       * three are recorded apart here so the next one does not need a HAR.
       */
      logger.warn("Agent decision failed", "Agent", {
        runId: input.state.id,
        model: input.state.modelId,
        elapsedMs: Date.now() - startedAt,
        cancelledByRun: signal.aborted,
        timedOut,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : "unknown"
      })
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener?.("abort", abort)
    }
  }
})

export interface BuildAgentControllerInput {
  runId: string
  sessions: AgentControlSessionRegistry
  history: AgentTabHistory
  persistence: AgentPersistencePort
  supervision: AgentSupervision
  allowExperimentalModel: boolean
  now(): number
  decisionTimeoutMs?: number
}

export type BuildAgentController = (
  input: BuildAgentControllerInput
) => AgentController

/**
 * Binds one run's controller to this browser.
 *
 * Kept apart from the run service so lifecycle and assembly stay separable —
 * a test can drive the service with its own controller, and the layers below
 * are reachable without it. The split buys no load-time saving today: the
 * Chrome service worker is a classic worker, so WXT inlines the dynamic
 * import into background.js.
 */
export const buildAgentController: BuildAgentController = (input) => {
  const adapters = createAgentBrowserAdapters({
    runId: input.runId,
    sessions: input.sessions,
    history: input.history,
    now: input.now
  })

  return createAgentController({
    model: withDecisionTimeout(
      createProviderAgentModelPort({
        allowExperimental: input.allowExperimentalModel
      }),
      input.decisionTimeoutMs ?? DECISION_TIMEOUT_MS
    ),
    observation: adapters.observation,
    effect: createAgentEffectPort(adapters),
    policy: { evaluate: evaluateAgentPolicy },
    persistence: input.persistence,
    approval: input.supervision.approval,
    takeover: input.supervision.takeover,
    clock: { now: input.now }
  })
}
