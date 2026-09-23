import { beforeEach, describe, expect, it } from "vitest"
import { agentDraftStore } from "../agent-draft-store"

describe("agentDraftStore", () => {
  beforeEach(() => {
    agentDraftStore.setState({
      goal: "",
      followUp: undefined,
      handledCompletionRunId: undefined
    })
  })

  it("clears a matching draft once for each completed run", () => {
    const state = agentDraftStore.getState()
    state.setGoal("Close this issue")
    state.completeGoal("run-1", "Close this issue")
    expect(agentDraftStore.getState().goal).toBe("")

    agentDraftStore.getState().setGoal("Close this issue")
    agentDraftStore.getState().completeGoal("run-1", "Close this issue")
    expect(agentDraftStore.getState().goal).toBe("Close this issue")
  })

  it("keeps a different draft while marking completion handled", () => {
    const state = agentDraftStore.getState()
    state.setGoal("Start another task")
    state.completeGoal("run-1", "Close this issue")
    expect(agentDraftStore.getState().goal).toBe("Start another task")

    agentDraftStore.getState().setGoal("Close this issue")
    agentDraftStore.getState().completeGoal("run-1", "Close this issue")
    expect(agentDraftStore.getState().goal).toBe("Close this issue")
  })

  const followUp = {
    parentRunId: "parent",
    mode: "continue" as const,
    parentGoal: "Find the mug"
  }

  /**
   * Prefilled from a completed run's card, the sentence must survive the
   * completion rule that clears a finished goal from the box.
   */
  it("keeps a card's draft through the completion of the run it came from", () => {
    agentDraftStore.getState().beginDraft("Find the mug", "parent")
    agentDraftStore.getState().completeGoal("parent", "Find the mug")

    expect(agentDraftStore.getState().goal).toBe("Find the mug")
  })

  it("spends a follow-up only once the run it produced is showing", () => {
    agentDraftStore.getState().beginDraft("", "parent", followUp)

    agentDraftStore.getState().settleFollowUp(undefined)
    agentDraftStore.getState().settleFollowUp("some-other-parent")
    expect(agentDraftStore.getState().followUp).toEqual(followUp)

    agentDraftStore.getState().settleFollowUp("parent")
    expect(agentDraftStore.getState().followUp).toBeUndefined()
  })
})
