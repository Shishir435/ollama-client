import type {
  AgentEffectPort,
  AgentExecutionReceipt,
  AgentVerificationResult
} from "@ollama-client/agent-runtime"
import type { AgentCommand } from "@ollama-client/contracts"

import {
  executeDialogAgentEffect,
  executeDomMutationAgentEffect,
  executeFormFillAgentEffect,
  executeNavigationAgentEffect,
  executeReadOnlyAgentEffect
} from "@/lib/browser-agent/command-executor"
import {
  verifyDialogAgentEffect,
  verifyDomMutationAgentEffect,
  verifyFormFillAgentEffect,
  verifyNavigationAgentEffect,
  verifyReadOnlyAgentEffect
} from "@/lib/browser-agent/effect-verifier"
import {
  executePageToolAgentEffect,
  PAGE_TOOL_AGENT_ACTIONS,
  resolvePageToolAgentEffect,
  verifyPageToolAgentEffect
} from "@/lib/browser-agent/page-tool-effect"
import {
  DIALOG_AGENT_ACTIONS,
  DOM_MUTATION_AGENT_ACTIONS,
  FORM_FILL_AGENT_ACTIONS,
  NAVIGATION_AGENT_ACTIONS,
  READ_ONLY_AGENT_ACTIONS,
  resolveDialogAgentEffect,
  resolveDomMutationAgentEffect,
  resolveFormFillAgentEffect,
  resolveNavigationAgentEffect,
  resolveReadOnlyAgentEffect
} from "@/lib/browser-agent/resolved-effect"
import { AGENT_WEBMCP_COMPILED } from "@/lib/feature-flags"
import type { AgentBrowserAdapters } from "./agent-browser-adapters"

type AgentActionFamily =
  | "read_only"
  | "navigation"
  | "dom_mutation"
  | "form_fill"
  | "dialog"
  | "page_tool"

const PAGE_TOOL_EFFECTS = AGENT_WEBMCP_COMPILED
  ? {
      resolve: resolvePageToolAgentEffect,
      execute: executePageToolAgentEffect,
      verify: verifyPageToolAgentEffect
    }
  : undefined

const familyOf = (type: AgentCommand["type"]): AgentActionFamily => {
  if (
    AGENT_WEBMCP_COMPILED &&
    (PAGE_TOOL_AGENT_ACTIONS as readonly string[]).includes(type)
  ) {
    return "page_tool"
  }
  if ((READ_ONLY_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "read_only"
  }
  if ((NAVIGATION_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "navigation"
  }
  if ((DOM_MUTATION_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "dom_mutation"
  }
  if ((FORM_FILL_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "form_fill"
  }
  if ((DIALOG_AGENT_ACTIONS as readonly string[]).includes(type)) {
    return "dialog"
  }
  throw new Error(`Unsupported Agent action: ${type}`)
}

/**
 * One port over the five shipped action families.
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
      case "page_tool":
        if (!PAGE_TOOL_EFFECTS) throw new Error("WebMCP is not compiled")
        return PAGE_TOOL_EFFECTS.resolve(input)
      case "read_only":
        return resolveReadOnlyAgentEffect(input)
      case "navigation":
        return resolveNavigationAgentEffect(input)
      case "form_fill":
        return resolveFormFillAgentEffect(input)
      case "dialog":
        return resolveDialogAgentEffect(input)
      default:
        return resolveDomMutationAgentEffect(input)
    }
  },
  async execute(effect, signal): Promise<AgentExecutionReceipt> {
    const input = { effect, adapter: adapters.executor, signal }
    switch (familyOf(effect.command.type)) {
      case "page_tool":
        if (!PAGE_TOOL_EFFECTS) throw new Error("WebMCP is not compiled")
        return PAGE_TOOL_EFFECTS.execute(input)
      case "read_only":
        return executeReadOnlyAgentEffect(input)
      case "navigation":
        return executeNavigationAgentEffect(input)
      case "form_fill":
        return executeFormFillAgentEffect(input)
      case "dialog":
        return executeDialogAgentEffect(input)
      default:
        return executeDomMutationAgentEffect(input)
    }
  },
  async verify(verification, signal): Promise<AgentVerificationResult> {
    const input = { verification, adapter: adapters.verifier, signal }
    switch (familyOf(verification.effect.command.type)) {
      case "page_tool":
        if (!PAGE_TOOL_EFFECTS) throw new Error("WebMCP is not compiled")
        return PAGE_TOOL_EFFECTS.verify(input)
      case "read_only":
        return verifyReadOnlyAgentEffect(input)
      case "navigation":
        return verifyNavigationAgentEffect(input)
      case "form_fill":
        return verifyFormFillAgentEffect(input)
      case "dialog":
        return verifyDialogAgentEffect(input)
      default:
        return verifyDomMutationAgentEffect(input)
    }
  }
})
