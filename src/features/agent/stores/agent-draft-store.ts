import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

interface AgentDraftState {
  goal: string
  handledCompletionRunId?: string
  setGoal: (goal: string) => void
  completeGoal: (runId: string, completedGoal: string) => void
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
    })
}))

export const useAgentDraft = () =>
  agentDraftStore(
    useShallow((state) => ({
      goal: state.goal,
      setGoal: state.setGoal,
      completeGoal: state.completeGoal
    }))
  )
