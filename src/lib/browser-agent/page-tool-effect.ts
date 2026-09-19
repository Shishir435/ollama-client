import type {
  AgentCancellationSignal,
  AgentExecutionReceipt,
  AgentVerificationInput,
  AgentVerificationResult,
  AuthorizedAgentEffect,
  ResolvedAgentEffect
} from "@ollama-client/agent-runtime"
import type { AgentCommand, AgentObservation } from "@ollama-client/contracts"

import type { AgentCommandExecutorAdapter } from "./command-executor"
import type { AgentEffectVerifierAdapter } from "./effect-verifier"
import { rootAgentSnapshotIdentity } from "./frame-identity"
import type { AgentEffectResolverAdapter } from "./resolved-effect"

export const PAGE_TOOL_AGENT_ACTIONS = ["call_page_tool"] as const

export const resolvePageToolAgentEffect = async (input: {
  command: AgentCommand
  observation: AgentObservation
  adapter: AgentEffectResolverAdapter
}): Promise<ResolvedAgentEffect> => {
  const { command, observation } = input
  if (command.type !== "call_page_tool") {
    throw new Error("Invalid Agent page-tool command")
  }
  if (
    command.snapshotId !== observation.snapshotId ||
    command.generation !== observation.generation
  ) {
    throw new Error("Agent page-tool observation is stale")
  }
  const source = new URL(observation.url)
  if ((await input.adapter.classifyAccess(source.href)) !== "ok") {
    throw new Error("Agent page-tool page is no longer readable")
  }
  const tool = observation.pageTools?.find(
    (candidate) =>
      candidate.name === command.toolName &&
      candidate.schemaRevision === command.schemaRevision &&
      candidate.frameId === observation.frameId &&
      candidate.documentId === observation.documentId
  )
  if (!tool) throw new Error("Agent page tool is no longer advertised")
  const toolFrame = observation.frames.find(
    (frame) => frame.frameId === tool.frameId
  )
  return {
    command,
    target: {
      accessibleName: tool.title || tool.name,
      sensitive: false,
      maySubmit: false
    },
    pageTool: tool,
    semanticEffects: tool.annotations?.consequentialHint
      ? ["activation", "destructive"]
      : ["activation"],
    snapshotIdentity: rootAgentSnapshotIdentity(observation),
    sourceUrl: source.href,
    sourceOrigin: source.origin,
    ...(tool.frameId !== observation.frameId && toolFrame?.url
      ? { frameUrl: toolFrame.url, frameOrigin: tool.origin }
      : {})
  }
}

export const executePageToolAgentEffect = async (input: {
  effect: AuthorizedAgentEffect
  adapter: AgentCommandExecutorAdapter
  signal: AgentCancellationSignal
}): Promise<AgentExecutionReceipt> => {
  if (
    input.effect.command.type !== "call_page_tool" ||
    !input.effect.pageTool
  ) {
    throw new Error("Invalid Agent page-tool effect")
  }
  if (!input.adapter.executePageTool) {
    throw new Error("Agent page-tool execution is unavailable")
  }
  const outcome = await input.adapter.executePageTool(
    input.effect,
    input.signal
  )
  return {
    executedAt: input.adapter.now(),
    details: "call_page_tool",
    pageToolResult: outcome.result,
    ...(outcome.navigation ? { pageToolNavigation: true } : {})
  }
}

export const verifyPageToolAgentEffect = async (input: {
  verification: AgentVerificationInput
  adapter: AgentEffectVerifierAdapter
  signal: AgentCancellationSignal
}): Promise<AgentVerificationResult> => {
  const { receipt, effect } = input.verification
  if (receipt.pageToolNavigation) {
    try {
      const after = await input.adapter.observe(
        effect.snapshotIdentity.tabId,
        effect.snapshotIdentity.generation + 1,
        input.verification.allowedOrigins,
        input.signal
      )
      const moved =
        after.documentId !== effect.snapshotIdentity.documentId ||
        after.url !== effect.sourceUrl
      return {
        outcome: moved ? "confirmed" : "ambiguous",
        evidence: {
          kind: "page_tool_navigation",
          summary: moved
            ? "Page tool navigated to a new document"
            : "Page tool reported navigation but the document did not change",
          observedAt: input.adapter.now()
        }
      }
    } catch {
      return {
        outcome: "ambiguous",
        evidence: {
          kind: "page_tool_navigation",
          summary: "Page tool navigation could not be reconciled",
          observedAt: input.adapter.now()
        }
      }
    }
  }
  const result = receipt.pageToolResult ?? ""
  return {
    outcome: "confirmed",
    evidence: {
      kind: "page_tool_result",
      summary: result
        ? `Untrusted page-tool result: ${result}`.slice(0, 1_000)
        : "Page tool completed without a result",
      observedAt: input.adapter.now()
    }
  }
}
