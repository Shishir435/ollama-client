import type {
  AgentCommand,
  AgentRunState,
  AgentStepRecord
} from "@ollama-client/contracts"

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
      return `Press ${agentPlainText(command.key, AGENT_PAGE_TEXT_LIMIT)}`
    case "type":
      return "Type in field"
    case "replace_text":
      return "Edit text in field"
    case "drag":
      return "Drag control to a drop target"
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
    case "double_click":
      return "Double-click control"
    case "click_point":
      return "Click at a point in the screenshot"
    case "zoom":
      return "Zoom into the screenshot"
    case "hover":
      return "Hover over control"
    case "read":
      return "Read page"
    case "inspect":
      return `Inspect ${agentPlainText(command.target, AGENT_PAGE_TEXT_LIMIT)}`
    case "find":
      return `Find "${agentPlainText(command.query, AGENT_PAGE_TEXT_LIMIT)}"`
    case "extract_text":
      return "Read page text"
  }
}

export interface AgentWorkLogItem {
  id: string
  label: string
  status: AgentStepRecord["status"]
  detail?: string
}

export const toAgentWorkLog = (
  steps: readonly AgentStepRecord[]
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

const SETTLED_AGENT_STATUSES: readonly AgentRunState["status"][] = [
  "completed",
  "failed",
  "cancelled"
]

/**
 * The tab the panel shows and gates Start on.
 *
 * While a run is unresolved that is the tab it controls, whatever the user is
 * looking at. Once it has settled, the record of where it ran says nothing
 * about where the next run would start — the tab may be closed by now — so
 * the panel goes back to the page in front of the user. Gating on the stale
 * tab is how a finished run left Start disabled on a perfectly good page.
 */
export const visibleAgentTab = <T>(
  run: Pick<AgentRunState, "status"> | null | undefined,
  runTab: T | undefined,
  candidateTab: T | undefined
): T | undefined =>
  run && !SETTLED_AGENT_STATUSES.includes(run.status) ? runTab : candidateTab
