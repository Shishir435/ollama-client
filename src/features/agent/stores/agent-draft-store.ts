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
  /**
   * Set when Start is pressed: the run the panel was showing at that moment,
   * if any. Only a run that appears after it can be the one this draft
   * started — a child of the same parent already on screen is an older one.
   */
  submitted?: { shownRunId?: string }
}

/** The run the panel shows, as a draft's follow-up is settled against it. */
export interface AgentShownRun {
  id: string
  /** The parent it follows, when it is a follow-up. */
  followedRunId?: string
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
  /** Records that Start was pressed while `shown` was on screen. */
  submitFollowUp: (shown: AgentShownRun | undefined) => void
  /**
   * Spends the follow-up once the run it produced exists, and not before:
   * clearing it on the click would turn a refused start — a parent pruned
   * meanwhile, a tab the run cannot use — into a fresh run on the retry.
   * And not on sight of any child of the same parent: one already showing
   * when Continue was chosen again is not the run this draft will start.
   */
  settleFollowUp: (shown: AgentShownRun | undefined) => void
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
  submitFollowUp: (shown) =>
    set((state) =>
      state.followUp
        ? {
            followUp: {
              ...state.followUp,
              submitted: shown ? { shownRunId: shown.id } : {}
            }
          }
        : state
    ),
  settleFollowUp: (shown) =>
    set((state) => {
      const followUp = state.followUp
      if (!followUp?.submitted || !shown) return state
      if (shown.id === followUp.submitted.shownRunId) return state
      if (shown.followedRunId !== followUp.parentRunId) return state
      return { followUp: undefined }
    })
}))

export const useAgentDraft = () =>
  agentDraftStore(
    useShallow((state) => ({
      goal: state.goal,
      followUp: state.followUp,
      setGoal: state.setGoal,
      completeGoal: state.completeGoal,
      clearFollowUp: state.clearFollowUp,
      submitFollowUp: state.submitFollowUp,
      settleFollowUp: state.settleFollowUp
    }))
  )
