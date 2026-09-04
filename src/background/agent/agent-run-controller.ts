import type {
  AgentController,
  AgentPersistencePort
} from "@ollama-client/agent-runtime"
import {
  createAgentController,
  evaluateAgentPolicy
} from "@ollama-client/agent-runtime"

import { createProviderAgentModelPort } from "@/application/agent/agent-model-port"
import { createAgentBrowserAdapters } from "./agent-browser-adapters"
import type { AgentControlSessionRegistry } from "./agent-control-sessions"
import { createAgentEffectPort } from "./agent-effect-port"
import type { AgentSupervision } from "./agent-supervision"
import type { AgentTabHistory } from "./agent-tab-history"

export interface BuildAgentControllerInput {
  runId: string
  sessions: AgentControlSessionRegistry
  history: AgentTabHistory
  persistence: AgentPersistencePort
  supervision: AgentSupervision
  allowExperimentalModel: boolean
  now(): number
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
    model: createProviderAgentModelPort({
      allowExperimental: input.allowExperimentalModel
    }),
    observation: adapters.observation,
    effect: createAgentEffectPort(adapters),
    policy: { evaluate: evaluateAgentPolicy },
    persistence: input.persistence,
    approval: input.supervision.approval,
    takeover: input.supervision.takeover,
    clock: { now: input.now }
  })
}
