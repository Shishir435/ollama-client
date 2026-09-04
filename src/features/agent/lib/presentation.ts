import type { AgentCommand, AgentRunState } from "@ollama-client/contracts"
import type { DurableAgentStep } from "@/lib/repositories/agent-runs"

export const AGENT_PAGE_TEXT_LIMIT = 240
export const AGENT_LOG_TEXT_LIMIT = 500

/** Page-derived text is flattened before display so it cannot imitate controls. */
export const agentPlainText = (value: string, limit: number): string => {
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? " " : character
  }).join("")
  const normalized = withoutControls.replaceAll(/\s+/g, " ").trim()
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

const commandLabel = (command?: AgentCommand): string => {
  if (!command) return "Agent step"
  switch (command.type) {
    case "navigate":
    case "open_tab":
      return `${command.type === "navigate" ? "Navigate" : "Open tab"}: ${agentPlainText(command.url, AGENT_PAGE_TEXT_LIMIT)}`
    case "scroll":
      return `Scroll ${command.direction}`
    case "switch_tab":
      return `Switch to tab ${command.tabId}`
    case "wait":
      return `Wait for ${agentPlainText(command.condition, AGENT_PAGE_TEXT_LIMIT)}`
    case "clear_and_type":
      return "Replace text in field"
    case "press_key":
      return `Press ${command.key}`
    case "type":
      return "Type in field"
    case "select":
      return "Select option"
    case "check":
      return "Check control"
    case "uncheck":
      return "Uncheck control"
    case "back":
      return "Go back"
    case "forward":
      return "Go forward"
    case "click":
      return "Click control"
    case "read":
      return "Read page"
  }
}

export interface AgentWorkLogItem {
  id: string
  label: string
  status: DurableAgentStep["status"]
  detail?: string
}

export const toAgentWorkLog = (
  steps: readonly DurableAgentStep[]
): AgentWorkLogItem[] =>
  steps.map((step) => ({
    id: `${step.stepId}:${step.sequence}`,
    label: commandLabel(step.command),
    status: step.status,
    ...(step.verification?.evidence.summary
      ? {
          detail: agentPlainText(
            step.verification.evidence.summary,
            AGENT_LOG_TEXT_LIMIT
          )
        }
      : {})
  }))

export const agentRunIsActive = (status: AgentRunState["status"]): boolean =>
  !["completed", "failed", "cancelled", "paused"].includes(status)
