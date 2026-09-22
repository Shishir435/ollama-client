import type { AgentStatePatch } from "@ollama-client/agent-runtime"
import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import type { AgentRunState } from "@ollama-client/contracts"
import {
  listAgentRunsForMissingSessions,
  listIncompleteAgentRuns,
  markInterruptedAgentEffectUncertain,
  pruneTerminalAgentRuns,
  reconcileAgentRunLinkage,
  transitionAgentRun
} from "@/lib/repositories/agent-runs"

const transition = async (
  state: AgentRunState,
  to: AgentRunState["status"],
  patch: AgentStatePatch
): Promise<AgentRunState | undefined> => {
  const result = await transitionAgentRun({
    runId: state.id,
    from: state.status,
    to,
    patch
  })
  return result.transitioned ? result.state : undefined
}

const pauseAfterRecovery = async (
  state: AgentRunState,
  reason: "panel_closed" | "takeover" | "unresolved_effect",
  now: number
): Promise<void> => {
  const patch = { pauseReason: reason, updatedAt: now } as const
  if (state.status === "paused") return
  if (
    state.status === "awaiting_approval" ||
    state.status === "awaiting_takeover" ||
    state.status === "verifying" ||
    state.status === "pause_requested"
  ) {
    await transition(state, "paused", patch)
    return
  }
  const requested = await transition(state, "pause_requested", patch)
  if (requested) await transition(requested, "paused", patch)
}

/**
 * Recover Agent without running Agent. Startup only settles cancellation and
 * records a safe paused boundary; it never observes, decides, verifies, or
 * invokes an executor. In-flight effects become explicitly unresolved.
 */
export const recoverAgentRuns = async (signal?: AbortSignal): Promise<void> => {
  signal?.throwIfAborted()
  const runs = await listIncompleteAgentRuns()
  for (const run of runs) {
    signal?.throwIfAborted()
    const state = run.state
    if (!state || state.status === "paused") continue
    const now = Date.now()

    if (state.status === "cancelling") {
      await transition(state, "cancelled", { updatedAt: now })
      continue
    }

    if (state.status === "executing" || state.status === "verifying") {
      if (await markInterruptedAgentEffectUncertain(state.id, now)) {
        const refreshed = (await listIncompleteAgentRuns()).find(
          (candidate) => candidate.id === state.id
        )?.state
        if (refreshed) {
          await pauseAfterRecovery(refreshed, "unresolved_effect", now)
        }
      }
      continue
    }

    await pauseAfterRecovery(
      state,
      state.status === "awaiting_takeover" ? "takeover" : "panel_closed",
      now
    )
  }
  signal?.throwIfAborted()
}

/**
 * Settle the runs of a chat that is gone.
 *
 * The delete itself tells the background, and that path is what stops a run
 * while it is still acting. This is the answer for the event that never
 * arrived — a worker asleep, a panel closed mid-delete — and it runs here
 * because a startup run is not driving anything, so ending it costs nothing
 * that could still be observed. `reconcileAgentRunLinkage` then removes the
 * rows, which only ever happens once they are terminal.
 */
const cancelRunsWithoutChats = async (signal?: AbortSignal): Promise<void> => {
  for (const run of await listAgentRunsForMissingSessions()) {
    signal?.throwIfAborted()
    const state = run.state
    if (!state || isTerminalAgentStatus(state.status)) continue
    const now = Date.now()
    const cancelling = await transition(state, "cancelling", { updatedAt: now })
    if (cancelling)
      await transition(cancelling, "cancelled", { updatedAt: now })
  }
}

export const recoverAndPruneAgentRuns = async (
  signal?: AbortSignal
): Promise<void> => {
  await recoverAgentRuns(signal)
  signal?.throwIfAborted()
  await cancelRunsWithoutChats(signal)
  signal?.throwIfAborted()
  /*
   * After recovery, not before: recovery is what settles the runs whose
   * messages are still waiting on them, and reconciling first would leave
   * every run it just cancelled with a bubble that streams until the next
   * boot.
   */
  await reconcileAgentRunLinkage()
  await pruneTerminalAgentRuns(undefined, signal)
}
