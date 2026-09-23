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
  /** Whether the chat composer is sending a task rather than a message. */
  acting: boolean
  /** Text for the composer to take once; a new token is a new request. */
  prefill?: { text: string; token: number }
  followUp?: AgentDraftFollowUp
  setActing: (acting: boolean) => void
  /** Puts `text` in the composer, in whichever mode it is in. */
  prefillComposer: (text: string) => void
  /**
   * Starts a task draft from a run's card: Act mode, the goal to prefill, and
   * the run it follows when there is one. Starting over passes none — it is
   * a fresh run that happens to reuse the sentence.
   */
  beginDraft: (goal: string, followUp?: AgentDraftFollowUp) => void
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
 * Which mode the chat composer is in, and the task being drafted in it.
 *
 * Ephemeral by design: the mode is a place the user is in, not a setting,
 * and a panel that reopened already sending browser tasks would be the Agent
 * deciding for them. It dies with the panel like every other draft. The text
 * itself is the chat composer's; this holds only what the Agent adds to it.
 */
export const agentDraftStore = create<AgentDraftState>((set) => ({
  acting: false,
  setActing: (acting) => set({ acting }),
  prefillComposer: (text) =>
    set((state) => ({
      prefill: { text, token: (state.prefill?.token ?? 0) + 1 }
    })),
  beginDraft: (goal, followUp) =>
    set((state) => ({
      acting: true,
      followUp,
      prefill: { text: goal, token: (state.prefill?.token ?? 0) + 1 }
    })),
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
      acting: state.acting,
      prefill: state.prefill,
      followUp: state.followUp,
      setActing: state.setActing,
      prefillComposer: state.prefillComposer,
      clearFollowUp: state.clearFollowUp,
      submitFollowUp: state.submitFollowUp,
      settleFollowUp: state.settleFollowUp
    }))
  )
