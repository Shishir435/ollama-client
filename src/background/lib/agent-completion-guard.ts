import type { ToolRun } from "@/types"

export interface ToolLoopCompletionDecision {
  allowed: boolean
  feedback?: string
  failureReason?: string
}

export type ToolLoopCompletionGuard = (
  toolRuns: ToolRun[],
  assistantText: string
) => ToolLoopCompletionDecision

type RequiredAction = "click" | "type" | "select" | "navigate" | "mutate"

interface AgentTaskContract {
  actions: RequiredAction[]
  requiresPostActionSnapshot: boolean
}

const SEND_INTENT =
  /\b(send|post|submit|search|publish|reply)\b|\bsay\b.*\b(chat|message|input|composer)\b/i
const TYPE_INTENT = /\b(type|write|fill|enter|compose)\b/i
const CLICK_INTENT =
  /\b(click|press|tap|check|uncheck|toggle|choose|activate)\b/i
const SELECT_INTENT = /\bselect\b/i
const NAVIGATE_INTENT =
  /\b(navigate|go to|visit)\b|\bopen\b.*\b(page|site|url|link|result|tab)\b/i
const GENERAL_MUTATION_INTENT =
  /\b(change|update|edit|set|enable|disable|turn on|turn off)\b/i
const ACTION_SUCCESS_CLAIM =
  /\b(replied|sent|posted|submitted|clicked|pressed|typed|wrote|filled|entered|selected|changed|updated|enabled|disabled|navigated|opened)\b/i
const FALSE_CAPABILITY_DISCLAIMER =
  /\b(cannot|can't|unable to)\b.{0,80}\b(interact|click|type|fill|submit|access the dom)\b/i

export const contractForAgentTask = (
  task: string
): AgentTaskContract | undefined => {
  if (SEND_INTENT.test(task)) {
    return {
      actions: ["type", "click"],
      requiresPostActionSnapshot: true
    }
  }
  if (TYPE_INTENT.test(task)) {
    return { actions: ["type"], requiresPostActionSnapshot: true }
  }
  if (CLICK_INTENT.test(task)) {
    return { actions: ["click"], requiresPostActionSnapshot: true }
  }
  if (SELECT_INTENT.test(task)) {
    return { actions: ["select"], requiresPostActionSnapshot: true }
  }
  if (NAVIGATE_INTENT.test(task)) {
    return { actions: ["navigate"], requiresPostActionSnapshot: true }
  }
  if (GENERAL_MUTATION_INTENT.test(task)) {
    return { actions: ["mutate"], requiresPostActionSnapshot: true }
  }
  return undefined
}

const successfulIndexes = (toolRuns: ToolRun[], toolIds: string[]): number[] =>
  toolRuns.flatMap((run, index) =>
    run.status === "done" && toolIds.includes(run.toolId) ? [index] : []
  )

const indexesForAction = (
  toolRuns: ToolRun[],
  action: RequiredAction
): number[] => {
  if (action === "navigate") {
    return successfulIndexes(toolRuns, [
      "navigate",
      "open_tab",
      "select_tab",
      "click"
    ])
  }
  if (action === "mutate") {
    return successfulIndexes(toolRuns, ["click", "type", "select", "navigate"])
  }
  return successfulIndexes(toolRuns, [action])
}

const actionLabel = (action: RequiredAction): string =>
  action === "mutate" ? "page-changing action" : `${action} action`

export const createAgentCompletionGuard = (
  task: string
): ToolLoopCompletionGuard => {
  const contract = contractForAgentTask(task)

  return (toolRuns, assistantText) => {
    if (FALSE_CAPABILITY_DISCLAIMER.test(assistantText)) {
      return {
        allowed: false,
        feedback:
          "Completion rejected: browser interaction tools are available. Continue with snapshot_page or report the exact latest tool error without claiming general inability."
      }
    }
    if (!contract) {
      if (ACTION_SUCCESS_CLAIM.test(assistantText)) {
        const actionIndexes = indexesForAction(toolRuns, "mutate")
        const lastActionIndex = actionIndexes.at(-1)
        if (lastActionIndex === undefined) {
          return {
            allowed: false,
            feedback:
              "Completion rejected: response claims a browser action, but no successful page-changing action exists in the run trace."
          }
        }
        const laterSnapshot = successfulIndexes(toolRuns, [
          "snapshot_page"
        ]).some((index) => index > lastActionIndex)
        if (!laterSnapshot) {
          return {
            allowed: false,
            feedback:
              "Completion rejected: observe the page with snapshot_page after the claimed action before reporting success."
          }
        }
      }

      const lastRun = toolRuns.at(-1)
      if (lastRun?.status === "error") {
        return {
          allowed: true,
          failureReason:
            lastRun.error || `Browser tool ${lastRun.toolId} failed.`
        }
      }
      return { allowed: true }
    }

    let previousActionIndex = -1
    for (const action of contract.actions) {
      const actionIndex = indexesForAction(toolRuns, action).find(
        (index) => index > previousActionIndex
      )
      if (actionIndex === undefined) {
        return {
          allowed: false,
          feedback: `Completion rejected: task still requires a successful ${actionLabel(action)}. Call the next browser tool; do not claim success.`
        }
      }
      previousActionIndex = actionIndex
    }

    if (contract.requiresPostActionSnapshot) {
      const laterSnapshot = successfulIndexes(toolRuns, ["snapshot_page"]).some(
        (index) => index > previousActionIndex
      )
      if (!laterSnapshot) {
        return {
          allowed: false,
          feedback:
            "Completion rejected: observe the page with snapshot_page after the last action and verify the result before claiming success."
        }
      }
    }

    return { allowed: true }
  }
}
