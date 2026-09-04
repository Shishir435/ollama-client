import type {
  AgentEffectPort,
  AgentExecutionReceipt,
  AgentVerificationResult
} from "@ollama-client/agent-runtime"
import type { AgentCommand } from "@ollama-client/contracts"

import {
  executeDomMutationAgentEffect,
  executeNavigationAgentEffect,
  executeReadOnlyAgentEffect
} from "@/lib/browser-agent/command-executor"
import {
  verifyDomMutationAgentEffect,
  verifyNavigationAgentEffect,
  verifyReadOnlyAgentEffect
} from "@/lib/browser-agent/effect-verifier"
import {
  DOM_MUTATION_AGENT_ACTIONS,
  NAVIGATION_AGENT_ACTIONS,
  READ_ONLY_AGENT_ACTIONS,
  resolveDomMutationAgentEffect,
  resolveNavigationAgentEffect,
  resolveReadOnlyAgentEffect
} from "@/lib/browser-agent/resolved-effect"
import type { AgentBrowserAdapters } from "./agent-browser-adapters"

type AgentActionFamily = "read_only" | "navigation" | "dom_mutation"

const familyOf = (type: AgentCommand["type"]): AgentActionFamily => {
  if ((READ_ONLY_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "read_only"
  }
  if ((NAVIGATION_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "navigation"
  }
  if ((DOM_MUTATION_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "dom_mutation"
  }
  throw new Error(`Unsupported Agent action: ${type}`)
}

/**
 * One port over the three shipped action families.
 *
 * Dispatch is by the command's own family and nothing else: an action with no
 * family has no resolver, so it can never reach an executor, and resolve,
 * execute and verify always land in the same family for one command — the
 * property that keeps every executed effect verified by the verifier written
 * for it.
 */
export const createAgentEffectPort = (
  adapters: AgentBrowserAdapters
): AgentEffectPort => ({
  async resolve(command, observation) {
    const input = { command, observation, adapter: adapters.resolver }
    switch (familyOf(command.type)) {
      case "read_only":
        return resolveReadOnlyAgentEffect(input)
      case "navigation":
        return resolveNavigationAgentEffect(input)
      default:
        return resolveDomMutationAgentEffect(input)
    }
  },
  async execute(effect, signal): Promise<AgentExecutionReceipt> {
    const input = { effect, adapter: adapters.executor, signal }
    switch (familyOf(effect.command.type)) {
      case "read_only":
        return executeReadOnlyAgentEffect(input)
      case "navigation":
        return executeNavigationAgentEffect(input)
      default:
        return executeDomMutationAgentEffect(input)
    }
  },
  async verify(verification, signal): Promise<AgentVerificationResult> {
    const input = { verification, adapter: adapters.verifier, signal }
    switch (familyOf(verification.effect.command.type)) {
      case "read_only":
        return verifyReadOnlyAgentEffect(input)
      case "navigation":
        return verifyNavigationAgentEffect(input)
      default:
        return verifyDomMutationAgentEffect(input)
    }
  }
})
