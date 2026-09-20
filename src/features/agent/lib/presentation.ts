import {
  isTerminalAgentStatus,
  TERMINAL_AGENT_STATUSES
} from "@ollama-client/agent-runtime"
import type {
  AgentCommand,
  AgentRunState,
  AgentStepRecord
} from "@ollama-client/contracts"

export const AGENT_PAGE_TEXT_LIMIT = 240
export const AGENT_LOG_TEXT_LIMIT = 500
/**
 * The evidence an approval shows is not an excerpt of the page — it is the
 * thing being approved, and a batched fill's is one line per control. Bounded
 * by what the approval schema already allows, and shown in a box that scrolls
 * rather than one that clips.
 */
export const AGENT_EVIDENCE_TEXT_LIMIT = 1_000

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

/**
 * How a command reads, as an i18n key and the values it needs.
 *
 * The label used to be an English sentence built here, so a Japanese panel
 * showed a translated status above a work log written in another language.
 * The key travels instead and the component translates it, which is also why
 * a direction and a dialog answer get a key each rather than an interpolated
 * enum: "up" and "accept" have no translation at the point of use.
 *
 * Page-derived values — a URL, a wait condition, a query, a region — are
 * flattened before they travel, because a label is rendered and page text
 * must not be able to imitate one.
 */
export interface AgentActionLabel {
  key: string
  values?: Record<string, string | number>
}

const pageValue = (value: string) =>
  agentPlainText(value, AGENT_PAGE_TEXT_LIMIT)

export const agentActionLabel = (command?: AgentCommand): AgentActionLabel => {
  if (!command) return { key: "agent.action.step" }
  switch (command.type) {
    case "navigate":
    case "open_tab":
      return {
        key: `agent.action.${command.type}`,
        values: { url: pageValue(command.url) }
      }
    case "scroll":
      return { key: `agent.action.scroll_${command.direction}` }
    case "switch_tab":
      return {
        key: "agent.action.switch_tab",
        values: { tab: command.tabId }
      }
    case "wait":
      return {
        key: "agent.action.wait",
        values: { condition: pageValue(command.condition) }
      }
    case "press_key":
      return {
        key: "agent.action.press_key",
        values: { key: pageValue(command.key) }
      }
    case "inspect":
      return {
        key: "agent.action.inspect",
        values: { region: pageValue(command.target) }
      }
    case "find":
      return {
        key: "agent.action.find",
        values: { query: pageValue(command.query) }
      }
    case "handle_dialog":
      return {
        key: command.accept
          ? "agent.action.handle_dialog_accept"
          : "agent.action.handle_dialog_dismiss"
      }
    default:
      return { key: `agent.action.${command.type}` }
  }
}

/**
 * Steps still in flight. A step that verified, failed, was rejected or ended
 * uncertain is over, whatever the run does next.
 */
const OPEN_AGENT_STEP_STATUSES: readonly AgentStepRecord["status"][] = [
  "planned",
  "approved",
  "executing",
  "executed"
]

/**
 * What a run is doing right now, from the step it most recently opened.
 *
 * The status alone says "executing", which is the machine's word for it. A
 * user supervising a run needs the action: a page they can see being clicked,
 * a field being filled. The label is the same one the work log uses, so the
 * line above the log and the last line in it never disagree.
 *
 * The latest step is only the current action while that step is unfinished.
 * A verified click stays the newest command all through the observation and
 * decision that follow it, and naming it there tells a supervisor the run is
 * clicking when it is thinking — showing nothing is the honest answer.
 */
export const currentAgentAction = (
  steps: readonly AgentStepRecord[]
): AgentActionLabel | undefined => {
  const latest = [...steps]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((step) => step.command)
    .at(-1)
  return latest && OPEN_AGENT_STEP_STATUSES.includes(latest.status)
    ? agentActionLabel(latest.command)
    : undefined
}

/**
 * The recovery a failure leaves open, as an i18n key.
 *
 * The runtime's own message is written in English for a developer reading a
 * receipt, and it says what happened rather than what to do. Every code has
 * an answer — retry, narrow the goal, pick another model, take the tab over —
 * and a user who is told it does not need one of us.
 */
export const agentFailureAdviceKey = (code: string): string =>
  `agent.failure.${AGENT_FAILURE_CODES.has(code) ? code : "unknown"}`

/**
 * The advice to lead a failure with.
 *
 * A failure that carries a key of its own knows something the run's code does
 * not. A local proxy still unwinding a cancelled request answers every call
 * with a 503, which the run can only record as `model_unavailable` — true,
 * and its advice is "check the provider is running" for a provider that is
 * running perfectly. The provider's own key says to wait or restart the
 * proxy, so it wins when there is one.
 */
export const agentFailureMessageKey = (error: {
  code: string
  messageKey?: string
}): string => error.messageKey ?? agentFailureAdviceKey(error.code)

const AGENT_FAILURE_CODES = new Set([
  "budget_exhausted",
  "command_refused",
  "goal_failed",
  "invalid_decision",
  "model_unavailable",
  "observation_failed",
  "policy_blocked",
  "stale_snapshot",
  "unsupported_page",
  "verification_failed"
])

export interface AgentWorkLogItem {
  id: string
  at: number
  label: AgentActionLabel
  status: AgentStepRecord["status"]
  /**
   * The control the step acted on, in the page's own words.
   *
   * Carried beside the label rather than interpolated into it: "Click
   * control" is the same sentence in every language, and a name is page text
   * that must read as page text rather than as part of a sentence this build
   * wrote. It is already bounded where the receipt was written, and dropped
   * there when the control was sensitive.
   */
  target?: string
  /** The model's own note for this step, if it left one. */
  note?: string
  detail?: string
}

/**
 * One row per step, showing where that step got to.
 *
 * A step is appended once per lifecycle change — planned, approved,
 * executing, then how it settled — so rendering every receipt showed a single
 * click four times over, as "Planned", "Approved", "Running" and "Review".
 * The run had done one thing. History and the completion judge both collapse
 * receipts to the latest per step for the same reason; the log is the one
 * place a person reads them, so it is the place it mattered most.
 *
 * Each row carries what the step acted on and the note the model left on it.
 * Both were durable and neither was rendered, so a log of twenty steps read
 * as twenty repetitions of "Click control" — the run's own account of what it
 * was doing existed and the supervisor could not see it.
 */
export const toAgentWorkLog = (
  steps: readonly AgentStepRecord[]
): AgentWorkLogItem[] => {
  const latest = new Map<string, AgentStepRecord>()
  for (const step of steps) {
    const held = latest.get(step.stepId)
    if (!held || step.sequence >= held.sequence) latest.set(step.stepId, step)
  }
  return [...latest.values()]
    .sort((first, second) => first.sequence - second.sequence)
    .map((step) => ({
      id: step.stepId,
      at: step.at,
      label: agentActionLabel(step.command),
      status: step.status,
      ...(step.target?.name
        ? { target: agentPlainText(step.target.name, AGENT_PAGE_TEXT_LIMIT) }
        : {}),
      ...(step.finding
        ? { note: agentPlainText(step.finding, AGENT_LOG_TEXT_LIMIT) }
        : {}),
      ...(step.verification?.evidence.summary
        ? {
            detail: agentPlainText(
              step.verification.evidence.summary,
              AGENT_LOG_TEXT_LIMIT
            )
          }
        : {})
    }))
}

/**
 * Read from the status machine rather than listed here.
 *
 * These were three hand-written lists of terminal statuses in two files. A
 * status added to the machine and not to all three leaves the panel treating
 * a settled run as still working — which is what `partial` would have done.
 */
export const agentRunIsActive = (status: AgentRunState["status"]): boolean =>
  !isTerminalAgentStatus(status) && status !== "paused"

const SETTLED_AGENT_STATUSES: readonly AgentRunState["status"][] =
  TERMINAL_AGENT_STATUSES

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
