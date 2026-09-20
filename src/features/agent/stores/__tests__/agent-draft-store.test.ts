import { beforeEach, describe, expect, it } from "vitest"
import { agentDraftStore } from "../agent-draft-store"

describe("agentDraftStore", () => {
  beforeEach(() => {
    agentDraftStore.setState({
      goal: "",
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
})
