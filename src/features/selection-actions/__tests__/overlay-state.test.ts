import { describe, expect, it } from "vitest"
import {
  createSelectionOverlayState,
  reduceSelectionOverlayState
} from "../overlay-state"
import type { SelectionActionId } from "../types"

// ── helpers ──────────────────────────────────────────────────────────────────

const reduce = reduceSelectionOverlayState

const openAction = (actionId: SelectionActionId = "summarize") =>
  reduce(createSelectionOverlayState(), { type: "action.open", actionId })

const streamingState = () => reduce(openAction(), { type: "stream.start" })

const doneState = (resultText = "result") => {
  let s = streamingState()
  s = reduce(s, {
    type: "stream.chunk",
    visibleDelta: resultText,
    thinkingDelta: "",
    isThinking: false
  })
  return reduce(s, { type: "stream.done" })
}

// ── existing tests ────────────────────────────────────────────────────────────

describe("selection overlay state", () => {
  it.each(["cancel", "error"])(
    "keeps the latest completed refinement when a retry ends in %s",
    (outcome) => {
      let state = reduce(doneState("A"), {
        type: "refinement.start",
        instruction: "Refine A"
      })
      state = reduce(state, { type: "stream.start" })
      state = reduce(state, {
        type: "stream.chunk",
        visibleDelta: "B",
        thinkingDelta: "",
        isThinking: false
      })
      state = reduce(state, { type: "stream.done" })
      expect(state.refinement?.previousResult).toBe("A")
      state = reduce(state, { type: "stream.start" })
      state = reduce(
        state,
        outcome === "cancel"
          ? { type: "panel.cancel" }
          : { type: "stream.error", message: "Unavailable" }
      )
      expect(state.resultText).toBe("B")
      if (outcome === "error") state = reduce(state, { type: "panel.cancel" })
      expect(state.panelState).toBe("done")
      expect(state.resultText).toBe("B")
      expect(
        reduce(state, {
          type: "refinement.start",
          instruction: "Another revision"
        }).refinement?.previousResult
      ).toBe("B")
      expect(
        reduce(state, { type: "action.open", actionId: "rewrite" })
          .completedResult
      ).toBe("")
    }
  )
  it("refines the last result and restores it when cancelled or failed", () => {
    const previous = doneState("Previous result")
    const refining = reduce(previous, {
      type: "refinement.start",
      instruction: "  Shorter  "
    })
    expect(refining.refinement).toEqual({
      previousResult: "Previous result",
      instruction: "Shorter"
    })
    const running = reduce(refining, { type: "stream.start" })
    expect(running.resultText).toBe("")
    const cancelled = reduce(running, { type: "panel.cancel" })
    expect(cancelled.panelState).toBe("done")
    expect(cancelled.resultText).toBe("Previous result")
    const failed = reduce(running, {
      type: "stream.error",
      message: "Unavailable"
    })
    expect(failed.resultText).toBe("Previous result")
    expect(failed.panelState).toBe("error")
  })

  it("starts a fresh action without carrying over refinement", () => {
    const refining = reduce(doneState(), {
      type: "refinement.start",
      instruction: "Shorter"
    })
    expect(
      reduce(refining, { type: "action.open", actionId: "rewrite" }).refinement
    ).toBeNull()
    expect(
      reduce(streamingState(), {
        type: "refinement.start",
        instruction: "Shorter"
      })
    ).toEqual(streamingState())
  })
  it("opens custom prompt idle without stale streaming output", () => {
    const state = reduceSelectionOverlayState(createSelectionOverlayState(), {
      type: "action.open",
      actionId: "custom"
    })

    expect(state.mode).toBe("panel")
    expect(state.panelState).toBe("open")
    expect(state.resultText).toBe("")
    expect(state.errorText).toBe("")
    expect(state.isThinking).toBe(false)
  })

  it("cancel clears working state and generated text", () => {
    let state = reduceSelectionOverlayState(createSelectionOverlayState(), {
      type: "stream.start"
    })
    state = reduceSelectionOverlayState(state, {
      type: "stream.chunk",
      visibleDelta: "partial",
      thinkingDelta: "thinking",
      isThinking: true
    })
    state = reduceSelectionOverlayState(state, {
      type: "stream.error",
      message: "failed"
    })

    state = reduceSelectionOverlayState(state, { type: "panel.cancel" })

    expect(state.panelState).toBe("open")
    expect(state.resultText).toBe("")
    expect(state.errorText).toBe("")
    expect(state.thinkingText).toBe("")
    expect(state.isThinking).toBe(false)
  })

  // ── action.open ─────────────────────────────────────────────────────────────

  it("action.open switches to panel mode with open panelState", () => {
    const state = openAction("explain")
    expect(state.mode).toBe("panel")
    expect(state.panelState).toBe("open")
    expect(state.currentAction).toBe("explain")
  })

  it("action.open clears any stale result from previous run", () => {
    const withResult = doneState("old result")
    const state = reduce(withResult, {
      type: "action.open",
      actionId: "summarize"
    })
    expect(state.resultText).toBe("")
    expect(state.errorText).toBe("")
    expect(state.isThinking).toBe(false)
    expect(state.thinkingText).toBe("")
  })

  // ── stream lifecycle ─────────────────────────────────────────────────────────

  it("stream.start transitions to streaming panelState", () => {
    const state = streamingState()
    expect(state.panelState).toBe("streaming")
    expect(state.mode).toBe("panel")
  })

  it("stream.chunk accumulates visible and thinking text", () => {
    let state = streamingState()
    state = reduce(state, {
      type: "stream.chunk",
      visibleDelta: "Hello ",
      thinkingDelta: "think1 ",
      isThinking: true
    })
    state = reduce(state, {
      type: "stream.chunk",
      visibleDelta: "world",
      thinkingDelta: "think2",
      isThinking: false
    })
    expect(state.resultText).toBe("Hello world")
    expect(state.thinkingText).toBe("think1 think2")
    expect(state.isThinking).toBe(false)
  })

  it("stream.done transitions to done and clears thinking flag", () => {
    let state = streamingState()
    state = reduce(state, {
      type: "stream.chunk",
      visibleDelta: "answer",
      thinkingDelta: "",
      isThinking: true
    })
    state = reduce(state, { type: "stream.done" })
    expect(state.panelState).toBe("done")
    expect(state.isThinking).toBe(false)
    expect(state.resultText).toBe("answer")
  })

  it("stream.error transitions to error state with message", () => {
    const state = reduce(streamingState(), {
      type: "stream.error",
      message: "Model unavailable"
    })
    expect(state.panelState).toBe("error")
    expect(state.errorText).toBe("Model unavailable")
    expect(state.isThinking).toBe(false)
  })

  // ── cancel ───────────────────────────────────────────────────────────────────

  it("panel.cancel keeps panelState open so stream can restart", () => {
    // This is intentional: panel.cancel signals 'ready to re-run', not 'go back'.
    // toolbar.back is used for actually going back.
    const state = reduce(streamingState(), { type: "panel.cancel" })
    expect(state.panelState).toBe("open")
    expect(state.mode).toBe("panel")
  })

  it("panel.cancel keeps the last completed result available", () => {
    const state = reduce(doneState("some result"), { type: "panel.cancel" })
    expect(state.resultText).toBe("some result")
    expect(state.panelState).toBe("done")
    expect(state.mode).toBe("panel")
  })

  // ── navigation ───────────────────────────────────────────────────────────────

  it("toolbar.back resets to fresh toolbar state and preserves currentAction", () => {
    const state = reduce(doneState(), { type: "toolbar.back" })
    expect(state.mode).toBe("toolbar")
    expect(state.panelState).toBe("idle")
    expect(state.resultText).toBe("")
    expect(state.currentAction).toBe("summarize")
  })

  // ── pin / menu / custom ───────────────────────────────────────────────────────

  it("pin.toggle flips isPinned", () => {
    const s1 = reduce(createSelectionOverlayState(), { type: "pin.toggle" })
    expect(s1.isPinned).toBe(true)
    const s2 = reduce(s1, { type: "pin.toggle" })
    expect(s2.isPinned).toBe(false)
  })

  it("pin.enable sets isPinned without toggling", () => {
    const s1 = reduce(createSelectionOverlayState(), { type: "pin.enable" })
    expect(s1.isPinned).toBe(true)
    const s2 = reduce(s1, { type: "pin.enable" })
    expect(s2.isPinned).toBe(true)
  })

  it("custom.set updates customInstruction", () => {
    const state = reduce(createSelectionOverlayState(), {
      type: "custom.set",
      value: "Translate to French"
    })
    expect(state.customInstruction).toBe("Translate to French")
  })

  // ── initial state ─────────────────────────────────────────────────────────────

  it("initial state starts in toolbar mode at idle", () => {
    const state = createSelectionOverlayState()
    expect(state.mode).toBe("toolbar")
    expect(state.panelState).toBe("idle")
    expect(state.isPinned).toBe(false)
    expect(state.resultText).toBe("")
  })
})
