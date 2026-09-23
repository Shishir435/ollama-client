import type { AgentRunState, AgentRunStatus } from "@ollama-client/contracts"

import { logger } from "@/lib/logger"
import { getAgentRun } from "@/lib/repositories/agent-runs"
import type { AgentRunService } from "./agent-run-service"

/**
 * The statuses in which a run waits on the person, not on the page: an
 * approval, a handover, a question, or a pause — including the one taken
 * when the last panel closed, which is exactly the run nobody is looking at.
 */
const WAITS_ON_USER: readonly AgentRunStatus[] = [
  "awaiting_approval",
  "awaiting_takeover",
  "paused"
]

/** Coalesces the burst of writes one step makes into one badge update. */
const SETTLE_MS = 250

export interface AgentBadgeAction {
  setBadgeText(details: { text: string }): Promise<void> | void
  setBadgeBackgroundColor(details: { color: string }): Promise<void> | void
}

/**
 * Marks the toolbar icon while a run waits on the user.
 *
 * With the side panel closed a parked approval had no signal at all: the run
 * paused where it stood and the only way to learn it was to reopen the panel
 * on the chance. The mark says only that — no count, no text from the run,
 * nothing a page could have written — and it clears when the run moves on.
 * Reopening the panel lands on the card that carries the decision.
 *
 * Read from the run's durable row after each announcement rather than from
 * the announcement itself, because the row is what a worker restart keeps.
 */
export const registerAgentAttentionBadge = (input: {
  service: Pick<AgentRunService, "subscribe" | "latestRunId">
  action: AgentBadgeAction
  readRun?: (runId: string) => Promise<AgentRunState | undefined>
}): (() => void) => {
  const readRun =
    input.readRun ??
    (async (runId: string) => (await getAgentRun(runId))?.state)
  let shown: boolean | undefined
  let pendingRunId: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const show = async (needsUser: boolean) => {
    if (shown === needsUser) return
    shown = needsUser
    await input.action.setBadgeText({ text: needsUser ? "!" : "" })
    if (needsUser)
      await input.action.setBadgeBackgroundColor({ color: "#d97706" })
  }

  const refresh = async (runId: string | undefined) => {
    try {
      const state = runId ? await readRun(runId) : undefined
      await show(state !== undefined && WAITS_ON_USER.includes(state.status))
    } catch (error) {
      logger.warn("Agent attention badge could not be updated", "Agent", {
        name: error instanceof Error ? error.name : typeof error
      })
    }
  }

  const schedule = (runId: string) => {
    pendingRunId = runId
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      void refresh(pendingRunId)
    }, SETTLE_MS)
  }

  const unsubscribe = input.service.subscribe(schedule)
  /** A worker that restarted onto a parked run marks it without a new write. */
  void input.service
    .latestRunId()
    .then((runId) => refresh(runId))
    .catch(() => undefined)

  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
  }
}
