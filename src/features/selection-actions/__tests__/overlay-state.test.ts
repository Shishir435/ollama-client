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

  it("action.open closes more menu", () => {
    let state = createSelectionOverlayState()
    state = reduce(state, { type: "menu.toggle" })
    expect(state.isMoreMenuOpen).toBe(true)
    state = reduce(state, { type: "action.open", actionId: "summarize" })
    expect(state.isMoreMenuOpen).toBe(false)
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

  it("panel.cancel after done clears result and stays in panel", () => {
    const state = reduce(doneState("some result"), { type: "panel.cancel" })
    expect(state.resultText).toBe("")
    expect(state.panelState).toBe("open")
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

  it("overlay.hide resets to fresh toolbar state", () => {
    const state = reduce(doneState(), { type: "overlay.hide" })
    expect(state.mode).toBe("toolbar")
    expect(state.panelState).toBe("idle")
    expect(state.resultText).toBe("")
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

  it("menu.toggle flips isMoreMenuOpen", () => {
    const s1 = reduce(createSelectionOverlayState(), { type: "menu.toggle" })
    expect(s1.isMoreMenuOpen).toBe(true)
    const s2 = reduce(s1, { type: "menu.toggle" })
    expect(s2.isMoreMenuOpen).toBe(false)
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
    expect(state.isMoreMenuOpen).toBe(false)
    expect(state.resultText).toBe("")
  })
})
