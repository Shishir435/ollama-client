import { beforeEach, describe, expect, it } from "vitest"
import { agentDraftStore } from "../agent-draft-store"

const followUp = {
  parentRunId: "parent",
  mode: "continue" as const,
  parentGoal: "Find the mug"
}

describe("agentDraftStore", () => {
  beforeEach(() => {
    agentDraftStore.setState({
      acting: false,
      prefill: undefined,
      followUp: undefined
    })
  })

  it("drafts a task from a card: Act mode, the goal, and its parent", () => {
    agentDraftStore.getState().beginDraft("Find the mug", followUp)

    expect(agentDraftStore.getState()).toMatchObject({
      acting: true,
      prefill: { text: "Find the mug" },
      followUp
    })
  })

  /** The same sentence twice is two requests, so the composer takes both. */
  it("issues a new prefill token for every request", () => {
    agentDraftStore.getState().prefillComposer("Try again")
    const first = agentDraftStore.getState().prefill?.token
    agentDraftStore.getState().prefillComposer("Try again")

    expect(agentDraftStore.getState().prefill?.token).toBe((first ?? 0) + 1)
  })

  it("spends a follow-up only once the run it produced is showing", () => {
    agentDraftStore.getState().beginDraft("", followUp)
    agentDraftStore.getState().submitFollowUp({ id: "parent" })

    agentDraftStore.getState().settleFollowUp(undefined)
    agentDraftStore.getState().settleFollowUp({ id: "parent" })
    agentDraftStore
      .getState()
      .settleFollowUp({ id: "other", followedRunId: "some-other-parent" })
    expect(agentDraftStore.getState().followUp?.parentRunId).toBe("parent")

    agentDraftStore
      .getState()
      .settleFollowUp({ id: "child", followedRunId: "parent" })
    expect(agentDraftStore.getState().followUp).toBeUndefined()
  })

  /**
   * The panel already shows a child of the parent, and the user chooses
   * Continue on that parent again. The child on screen must not spend the
   * new draft, or Start launches a fresh run that knows nothing of the parent.
   */
  it("is not spent by a child of the same parent that was already showing", () => {
    const olderChild = { id: "child-1", followedRunId: "parent" }
    agentDraftStore.getState().beginDraft("", followUp)

    agentDraftStore.getState().settleFollowUp(olderChild)
    expect(agentDraftStore.getState().followUp?.parentRunId).toBe("parent")

    agentDraftStore.getState().submitFollowUp(olderChild)
    agentDraftStore.getState().settleFollowUp(olderChild)
    expect(agentDraftStore.getState().followUp?.parentRunId).toBe("parent")

    agentDraftStore
      .getState()
      .settleFollowUp({ id: "child-2", followedRunId: "parent" })
    expect(agentDraftStore.getState().followUp).toBeUndefined()
  })

  it("survives a refused start, so pressing Start again still follows", () => {
    agentDraftStore.getState().beginDraft("", followUp)
    agentDraftStore.getState().submitFollowUp(undefined)

    agentDraftStore.getState().settleFollowUp(undefined)
    expect(agentDraftStore.getState().followUp?.parentRunId).toBe("parent")
  })
})
