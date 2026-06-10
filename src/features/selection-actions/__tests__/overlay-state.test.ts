import { describe, expect, it } from "vitest"
import {
  createSelectionOverlayState,
  reduceSelectionOverlayState
} from "../overlay-state"

describe("selection overlay state", () => {
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

  it("selection reset keeps enabled current action", () => {
    let state = createSelectionOverlayState("rewrite")

    state = reduceSelectionOverlayState(state, {
      type: "selection.show",
      enabledActionIds: ["summarize", "rewrite"]
    })

    expect(state.mode).toBe("toolbar")
    expect(state.currentAction).toBe("rewrite")
    expect(state.isMoreMenuOpen).toBe(false)
  })

  it("selection reset falls back when current action is disabled", () => {
    let state = createSelectionOverlayState("rewrite")

    state = reduceSelectionOverlayState(state, {
      type: "selection.show",
      enabledActionIds: ["explain"]
    })

    expect(state.currentAction).toBe("explain")
  })
})
