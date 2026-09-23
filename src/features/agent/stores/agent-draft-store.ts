import type { AgentFollowUpMode } from "@ollama-client/contracts"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

/**
 * The settled run the next Start will follow, as the card that offered it
 * described it. Only the id and the mode travel on Start; the goal is here so
 * the composer can say what is being continued without reading the run.
 */
export interface AgentDraftFollowUp {
  parentRunId: string
  mode: AgentFollowUpMode
  parentGoal: string
}

interface AgentDraftState {
  goal: string
  followUp?: AgentDraftFollowUp
  handledCompletionRunId?: string
  setGoal: (goal: string) => void
  completeGoal: (runId: string, completedGoal: string) => void
  /**
   * Starts a draft from a run's card: the goal to prefill, the run the card
   * showed, and the run it follows when there is one. Starting over passes
   * none — it is a fresh run that happens to reuse the sentence.
   *
   * The card's run counts as handled, so the completion rule below cannot
   * clear the sentence the user just asked to set again.
   */
  beginDraft: (
    goal: string,
    fromRunId: string,
    followUp?: AgentDraftFollowUp
  ) => void
  clearFollowUp: () => void
  /**
   * Spends the follow-up once the run it produced exists, and not before:
   * clearing it on the click would turn a refused start — a parent pruned
   * meanwhile, a tab the run cannot use — into a fresh run on the retry.
   */
  settleFollowUp: (followedRunId: string | undefined) => void
}

/**
 * The unsent goal, held outside the Agent surface.
 *
 * Switching to Chat unmounts that surface, so component state loses the
 * sentence the user was still writing. This store dies with the panel like
 * every other draft — it is a convenience, not durable run state.
 */
export const agentDraftStore = create<AgentDraftState>((set) => ({
  goal: "",
  setGoal: (goal) => set({ goal }),
  completeGoal: (runId, completedGoal) =>
    set((state) => {
      if (state.handledCompletionRunId === runId) return state
      return {
        handledCompletionRunId: runId,
        goal: state.goal.trim() === completedGoal.trim() ? "" : state.goal
      }
    }),
  beginDraft: (goal, fromRunId, followUp) =>
    set({ goal, followUp, handledCompletionRunId: fromRunId }),
  clearFollowUp: () => set({ followUp: undefined }),
  settleFollowUp: (followedRunId) =>
    set((state) =>
      followedRunId !== undefined &&
      state.followUp?.parentRunId === followedRunId
        ? { followUp: undefined }
        : state
    )
}))

export const useAgentDraft = () =>
  agentDraftStore(
    useShallow((state) => ({
      goal: state.goal,
      followUp: state.followUp,
      setGoal: state.setGoal,
      completeGoal: state.completeGoal,
      clearFollowUp: state.clearFollowUp,
      settleFollowUp: state.settleFollowUp
    }))
  )
