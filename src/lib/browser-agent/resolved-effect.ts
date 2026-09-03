import type {
  AgentDestination,
  ResolvedAgentEffect,
  ResolvedAgentTarget
} from "@ollama-client/agent-runtime"
import type { AgentCommand, AgentObservation } from "@ollama-client/contracts"

import type { TabAccess } from "@/lib/browser-tab-access"

export const READ_ONLY_AGENT_ACTIONS = [
  "read",
  "wait",
  "scroll",
  "switch_tab",
  "back",
  "forward"
] as const

export type ReadOnlyAgentAction = (typeof READ_ONLY_AGENT_ACTIONS)[number]

export interface AgentEffectResolverAdapter {
  getTab(tabId: number): Promise<{ id?: number; url?: string } | undefined>
  classifyAccess(url?: string): Promise<TabAccess>
  resolveHistoryDestination(
    tabId: number,
    direction: "back" | "forward"
  ): Promise<string | undefined>
}

const isReadOnlyAction = (type: string): type is ReadOnlyAgentAction =>
  (READ_ONLY_AGENT_ACTIONS as readonly string[]).includes(type)

const destination = (url: string): AgentDestination => {
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Agent destination is not HTTP(S)")
  }
  return { url: parsed.href, origin: parsed.origin, source: "browser" }
}

const targetFromObservation = (
  command: AgentCommand,
  observation: AgentObservation
): ResolvedAgentTarget => {
  if (command.type !== "scroll" || !command.ref) {
    return { sensitive: false, maySubmit: false }
  }
  const element = observation.elements.find(
    (candidate) => candidate.ref === command.ref && candidate.frameId === 0
  )
  if (!element) throw new Error("Agent scroll target is stale")
  return {
    ref: element.ref,
    tag: element.tag,
    role: element.role,
    accessibleName: element.name,
    inputType: element.type,
    sensitive: element.sensitive,
    maySubmit: false
  }
}

export const resolveReadOnlyAgentEffect = async (input: {
  command: AgentCommand
  observation: AgentObservation
  adapter: AgentEffectResolverAdapter
}): Promise<ResolvedAgentEffect> => {
  const { command, observation } = input
  if (!isReadOnlyAction(command.type)) {
    throw new Error(`Unsupported Agent action: ${command.type}`)
  }
  if (
    command.snapshotId !== observation.snapshotId ||
    command.generation !== observation.generation
  ) {
    throw new Error("Agent command references a stale observation")
  }
  const source = destination(observation.url)
  if (
    source.origin !== observation.origin ||
    (await input.adapter.classifyAccess(source.url)) !== "ok"
  ) {
    throw new Error("Agent observation is no longer readable")
  }

  let resolvedDestination: AgentDestination | undefined
  if (command.type === "switch_tab") {
    const tab = await input.adapter.getTab(command.tabId)
    if (!tab?.url || tab.id !== command.tabId) {
      throw new Error("Agent switch-tab target is unavailable")
    }
    resolvedDestination = destination(tab.url)
  } else if (command.type === "back" || command.type === "forward") {
    const url = await input.adapter.resolveHistoryDestination(
      observation.tabId,
      command.type
    )
    if (!url) throw new Error("Agent history destination is not known safely")
    resolvedDestination = destination(url)
  }
  if (
    resolvedDestination &&
    (await input.adapter.classifyAccess(resolvedDestination.url)) !== "ok"
  ) {
    throw new Error("Agent destination is not readable")
  }

  return {
    command,
    target: targetFromObservation(command, observation),
    ...(resolvedDestination ? { destination: resolvedDestination } : {}),
    semanticEffects:
      command.type === "scroll"
        ? ["scroll"]
        : command.type === "switch_tab" ||
            command.type === "back" ||
            command.type === "forward"
          ? ["navigation"]
          : ["read"],
    snapshotIdentity: {
      snapshotId: observation.snapshotId,
      generation: observation.generation,
      tabId: observation.tabId,
      documentId: observation.documentId
    },
    sourceUrl: source.url,
    sourceOrigin: source.origin
  }
}
