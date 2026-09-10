import type {
  AgentEffectPort,
  AgentExecutionReceipt,
  AgentVerificationResult
} from "@ollama-client/agent-runtime"
import type { AgentCommand } from "@ollama-client/contracts"

import {
  executeDialogAgentEffect,
  executeDomMutationAgentEffect,
  executeNavigationAgentEffect,
  executeReadOnlyAgentEffect
} from "@/lib/browser-agent/command-executor"
import {
  verifyDialogAgentEffect,
  verifyDomMutationAgentEffect,
  verifyNavigationAgentEffect,
  verifyReadOnlyAgentEffect
} from "@/lib/browser-agent/effect-verifier"
import {
  DIALOG_AGENT_ACTIONS,
  DOM_MUTATION_AGENT_ACTIONS,
  NAVIGATION_AGENT_ACTIONS,
  READ_ONLY_AGENT_ACTIONS,
  resolveDialogAgentEffect,
  resolveDomMutationAgentEffect,
  resolveNavigationAgentEffect,
  resolveReadOnlyAgentEffect
} from "@/lib/browser-agent/resolved-effect"
import type { AgentBrowserAdapters } from "./agent-browser-adapters"

type AgentActionFamily = "read_only" | "navigation" | "dom_mutation" | "dialog"

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
  if ((DIALOG_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "dialog"
  }
  throw new Error(`Unsupported Agent action: ${type}`)
}

/**
 * One port over the four shipped action families.
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
  async resolve(command, observation, context) {
    const input = { command, observation, adapter: adapters.resolver, context }
    switch (familyOf(command.type)) {
      case "read_only":
        return resolveReadOnlyAgentEffect(input)
      case "navigation":
        return resolveNavigationAgentEffect(input)
      case "dialog":
        return resolveDialogAgentEffect(input)
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
      case "dialog":
        return executeDialogAgentEffect(input)
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
      case "dialog":
        return verifyDialogAgentEffect(input)
      default:
        return verifyDomMutationAgentEffect(input)
    }
  }
})
