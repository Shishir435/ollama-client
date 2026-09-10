import type { AgentCommand } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  type AgentInputTrace,
  AgentNativeInputCancelledError,
  AgentNativeInputFailedError,
  type AgentNativeInputStep,
  assessAgentInputDelivery,
  chooseAgentInputBackend,
  planAgentNativeInput,
  runAgentNativeInputPlan
} from "../native-input"

const grounded = { snapshotId: "s1", generation: 1 }
const command = (partial: Record<string, unknown>) =>
  ({ ...grounded, ref: "e1", ...partial }) as AgentCommand

const plan = (
  partial: Record<string, unknown>,
  overrides: Partial<Parameters<typeof planAgentNativeInput>[0]> = {}
) =>
  planAgentNativeInput({
    command: command(partial),
    point: { x: 10, y: 20 },
    frameOffset: { x: 100, y: 200 },
    focused: false,
    platform: "other",
    ...overrides
  })

const kinds = (steps: readonly AgentNativeInputStep[]) =>
  steps.map((step) =>
    step.kind === "mouse"
      ? step.type
      : step.kind === "key"
        ? `${step.type}:${step.key}`
        : step.kind === "insertText"
          ? `insert:${step.text}`
          : "wheel"
  )

describe("native input planning", () => {
  it("clicks at the frame point offset into the root viewport and expects frame-local events", () => {
    const built = plan({ type: "click" })
    expect(kinds(built.steps)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased"
    ])
    const pressed = built.steps[1] as Extract<
      AgentNativeInputStep,
      { kind: "mouse" }
    >
    expect(pressed).toMatchObject({
      x: 110,
      y: 220,
      button: "left",
      clickCount: 1
    })
    expect(built.expected).toEqual([
      { type: "mousemove", x: 10, y: 20 },
      { type: "mousedown", x: 10, y: 20 },
      { type: "mouseup", x: 10, y: 20 }
    ])
  })

  it("double-clicks with a rising click count and hovers with a move alone", () => {
    const twice = plan({ type: "double_click" })
    expect(kinds(twice.steps)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
      "mousePressed",
      "mouseReleased"
    ])
    expect(
      twice.steps
        .filter((step) => step.kind === "mouse" && step.type === "mousePressed")
        .map((step) => (step as { clickCount: number }).clickCount)
    ).toEqual([1, 2])
    expect(kinds(plan({ type: "hover" }).steps)).toEqual(["mouseMoved"])
  })

  it("focuses an unfocused field with a real click before typing, and not a focused one", () => {
    const unfocused = plan({ type: "type", text: "ab" })
    expect(kinds(unfocused.steps).slice(0, 3)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased"
    ])
    const focused = plan({ type: "type", text: "ab" }, { focused: true })
    expect(kinds(focused.steps)).toEqual([
      "keyDown:End",
      "keyUp:End",
      "keyDown:a",
      "keyUp:a",
      "keyDown:b",
      "keyUp:b"
    ])
    const end = focused.steps[0] as Extract<
      AgentNativeInputStep,
      { kind: "key" }
    >
    expect(end.commands).toEqual(["moveToEndOfDocument"])
  })

  it("clears with a platform select-all command and a backspace, and inserts characters it cannot type", () => {
    const mac = plan(
      { type: "clear_and_type", text: "é1" },
      { focused: true, platform: "mac" }
    )
    expect(kinds(mac.steps)).toEqual([
      "keyDown:Meta",
      "keyDown:a",
      "keyUp:a",
      "keyUp:Meta",
      "keyDown:Backspace",
      "keyUp:Backspace",
      "insert:é",
      "keyDown:1",
      "keyUp:1"
    ])
    const selectAll = mac.steps[1] as Extract<
      AgentNativeInputStep,
      { kind: "key" }
    >
    expect(selectAll.commands).toEqual(["selectAll"])
    expect(selectAll.modifiers).toBe(4)
    const other = plan({ type: "clear_and_type", text: "x" }, { focused: true })
    expect(kinds(other.steps)[0]).toBe("keyDown:Control")
  })

  it("inserts a newline as text and never presses Enter for it", () => {
    const built = plan({ type: "type", text: "a\nb" }, { focused: true })
    expect(kinds(built.steps)).toEqual([
      "keyDown:End",
      "keyUp:End",
      "keyDown:a",
      "keyUp:a",
      "insert:\n",
      "keyDown:b",
      "keyUp:b"
    ])
    expect(built.expected.filter((event) => event.type === "keydown")).toEqual([
      { type: "keydown", key: "End" },
      { type: "keydown", key: "a" },
      { type: "keydown", key: "b" }
    ])
  })

  it("holds modifiers around a chord and releases them in reverse", () => {
    const built = plan({ type: "press_key", key: "Control+Shift+Tab" })
    expect(kinds(built.steps)).toEqual([
      "keyDown:Control",
      "keyDown:Shift",
      "keyDown:Tab",
      "keyUp:Tab",
      "keyUp:Shift",
      "keyUp:Control"
    ])
    const tab = built.steps[2] as Extract<AgentNativeInputStep, { kind: "key" }>
    expect(tab.modifiers).toBe(2 | 8)
    expect(tab.text).toBeUndefined()
    const selectAll = plan(
      { type: "press_key", key: "Control+a" },
      { platform: "mac" }
    )
    expect(kinds(selectAll.steps)[0]).toBe("keyDown:Meta")
  })

  it("inserts a printable key the table cannot press, and refuses to chord it", () => {
    const inserted = plan({ type: "press_key", key: "é" })
    expect(inserted.steps).toEqual([{ kind: "insertText", text: "é" }])
    expect(inserted.expected).toEqual([])
    expect(() => plan({ type: "press_key", key: "Control+é" })).toThrow(
      /chord has no native definition/
    )
  })

  it("refuses to plan an action that has no native form", () => {
    expect(() => plan({ type: "select", value: "x" })).toThrow(
      /no native input plan/
    )
  })
})

/** Fails the step at `failAt` once; the release that follows goes through. */
const recordingDispatcher = (failAt?: number) => {
  const sent: AgentNativeInputStep[] = []
  let failed = false
  return {
    sent,
    dispatch: vi.fn(async (step: AgentNativeInputStep) => {
      if (failAt !== undefined && sent.length === failAt && !failed) {
        failed = true
        throw new Error("debugger detached")
      }
      sent.push(step)
    })
  }
}

describe("native input running", () => {
  it("releases a held button and held keys when cancelled mid-plan, and sends nothing else", async () => {
    const built = plan({ type: "press_key", key: "Shift+Tab" })
    let aborted = false
    const dispatcher = recordingDispatcher()
    dispatcher.dispatch.mockImplementation(async (step) => {
      dispatcher.sent.push(step)
      /* Stop after Shift and Tab are both down. */
      if (dispatcher.sent.length === 2) aborted = true
    })
    const error = await runAgentNativeInputPlan(built, dispatcher, {
      get aborted() {
        return aborted
      }
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(AgentNativeInputCancelledError)
    expect((error as AgentNativeInputCancelledError).dispatched).toBe(2)
    expect(kinds(dispatcher.sent)).toEqual([
      "keyDown:Shift",
      "keyDown:Tab",
      "keyUp:Tab",
      "keyUp:Shift"
    ])
  })

  it("releases a pressed mouse button when the debugger fails mid-click", async () => {
    const built = plan({ type: "click" })
    const dispatcher = recordingDispatcher(2)
    const error = await runAgentNativeInputPlan(built, dispatcher, {
      aborted: false
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(AgentNativeInputFailedError)
    expect((error as AgentNativeInputFailedError).dispatched).toBe(2)
    expect(kinds(dispatcher.sent)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased"
    ])
    /* The failing step is not re-sent: the runner never retries. */
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(4)
  })

  it("reports a plan the debugger refused from the first step as nothing dispatched", async () => {
    const dispatcher = recordingDispatcher(0)
    const error = await runAgentNativeInputPlan(
      plan({ type: "hover" }),
      dispatcher,
      {
        aborted: false
      }
    ).catch((error: unknown) => error)
    expect((error as AgentNativeInputFailedError).dispatched).toBe(0)
    expect(dispatcher.sent).toEqual([])
  })

  it("does not start a plan the run already cancelled", async () => {
    const dispatcher = recordingDispatcher()
    await expect(
      runAgentNativeInputPlan(plan({ type: "click" }), dispatcher, {
        aborted: true
      })
    ).rejects.toBeInstanceOf(AgentNativeInputCancelledError)
    expect(dispatcher.dispatch).not.toHaveBeenCalled()
  })
})

describe("native input delivery", () => {
  const click = plan({ type: "click" })
  const event = (
    type: AgentInputTrace["events"][number]["type"],
    extra: Partial<AgentInputTrace["events"][number]> = {}
  ) => ({ type, x: 10, y: 20, onTarget: true, ...extra })

  it("is delivered when exactly the plan arrived on the target", () => {
    expect(
      assessAgentInputDelivery(click, {
        events: [event("mousemove"), event("mousedown"), event("mouseup")]
      })
    ).toBe("delivered")
  })

  it("ignores stray pointer motion but not a foreign press or key", () => {
    expect(
      assessAgentInputDelivery(click, {
        events: [
          event("mousemove", { x: 300, y: 300 }),
          event("mousemove"),
          event("mousedown"),
          event("mouseup")
        ]
      })
    ).toBe("delivered")
    expect(
      assessAgentInputDelivery(click, {
        events: [
          event("mousemove"),
          event("mousedown"),
          event("mouseup"),
          event("mousedown", { x: 300, y: 300 })
        ]
      })
    ).toBe("interference")
    expect(
      assessAgentInputDelivery(click, {
        events: [
          event("keydown", { key: "x" }),
          event("mousemove"),
          event("mousedown"),
          event("mouseup")
        ]
      })
    ).toBe("interference")
  })

  it("tells misdirected, partial, undelivered and unknown apart", () => {
    expect(
      assessAgentInputDelivery(click, {
        events: [
          event("mousemove"),
          event("mousedown", { onTarget: false }),
          event("mouseup", { onTarget: false })
        ]
      })
    ).toBe("misdirected")
    expect(
      assessAgentInputDelivery(click, {
        events: [event("mousemove"), event("mousedown")]
      })
    ).toBe("partial")
    expect(assessAgentInputDelivery(click, { events: [] })).toBe("undelivered")
    expect(assessAgentInputDelivery(click, undefined)).toBe("unknown")
    expect(
      assessAgentInputDelivery(click, { events: [], overflow: true })
    ).toBe("unknown")
  })

  it("lets a key's release land on whatever took focus, and claims nothing for inserted text", () => {
    const tab = plan({ type: "press_key", key: "Shift+Tab" })
    expect(
      assessAgentInputDelivery(tab, {
        events: [
          { type: "keydown", key: "Shift", onTarget: true },
          { type: "keydown", key: "Tab", onTarget: true },
          { type: "keyup", key: "Tab", onTarget: false },
          { type: "keyup", key: "Shift", onTarget: false }
        ]
      })
    ).toBe("delivered")
    expect(
      assessAgentInputDelivery(tab, {
        events: [
          { type: "keydown", key: "Shift", onTarget: false },
          { type: "keydown", key: "Tab", onTarget: false },
          { type: "keyup", key: "Tab", onTarget: false },
          { type: "keyup", key: "Shift", onTarget: false }
        ]
      })
    ).toBe("misdirected")
    expect(
      assessAgentInputDelivery(plan({ type: "press_key", key: "é" }), {
        events: []
      })
    ).toBe("unknown")
  })

  it("matches keys by name and tolerates sub-pixel pointer rounding", () => {
    const chord = plan({ type: "press_key", key: "Shift+Tab" })
    expect(
      assessAgentInputDelivery(chord, {
        events: [
          { type: "keydown", key: "Shift", onTarget: true },
          { type: "keydown", key: "Tab", onTarget: true },
          { type: "keyup", key: "Tab", onTarget: true },
          { type: "keyup", key: "Shift", onTarget: true }
        ]
      })
    ).toBe("delivered")
    expect(
      assessAgentInputDelivery(click, {
        events: [
          event("mousemove", { x: 10.4 }),
          event("mousedown", { y: 20.6 }),
          event("mouseup")
        ]
      })
    ).toBe("delivered")
  })
})

describe("native input backend choice", () => {
  const target = { sensitive: false, maySubmit: false }
  const cdp = { cdpControl: true, attached: true, frameMapped: true }

  it("goes native for activation, gestures, text and chords when attached", () => {
    for (const type of [
      "click",
      "double_click",
      "hover",
      "type",
      "press_key"
    ]) {
      expect(
        chooseAgentInputBackend({
          ...cdp,
          effect: { command: command({ type, text: "x", key: "Tab" }), target }
        }).backend,
        type
      ).toBe("cdp")
    }
  })

  it("keeps guarded navigation and submission on the DOM backend whatever is attached", () => {
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: {
          command: command({ type: "click" }),
          target: { ...target, href: "https://example.com/next" }
        }
      })
    ).toEqual({ backend: "dom", reason: "guarded_navigation" })
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: {
          command: command({ type: "click" }),
          target: { ...target, submitter: true }
        }
      })
    ).toEqual({ backend: "dom", reason: "guarded_submission" })
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: {
          command: command({ type: "press_key", key: "Enter" }),
          target: { ...target, maySubmit: true }
        }
      })
    ).toEqual({ backend: "dom", reason: "guarded_submission" })
  })

  it("keeps a newline typed into a submitting field off the native path", () => {
    const submitting = { ...target, maySubmit: true }
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: {
          command: command({ type: "type", text: "Alice\n" }),
          target: submitting
        }
      })
    ).toEqual({ backend: "dom", reason: "guarded_submission" })
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: {
          command: command({ type: "clear_and_type", text: "a\rb" }),
          target: submitting
        }
      }).reason
    ).toBe("guarded_submission")
    /* A textarea's newline is a newline; without submit semantics it stays native. */
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: { command: command({ type: "type", text: "a\nb" }), target }
      }).backend
    ).toBe("cdp")
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: {
          command: command({ type: "type", text: "Alice" }),
          target: submitting
        }
      }).backend
    ).toBe("cdp")
  })

  it("sends a chord on a key the table cannot press to the DOM backend", () => {
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: {
          command: command({ type: "press_key", key: "Control+é" }),
          target
        }
      })
    ).toEqual({ backend: "dom", reason: "key_not_native" })
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: { command: command({ type: "press_key", key: "é" }), target }
      }).backend
    ).toBe("cdp")
  })

  it("falls to the DOM backend without control, without attachment, or with an unplaced frame", () => {
    const effect = { command: command({ type: "click" }), target }
    expect(
      chooseAgentInputBackend({ ...cdp, effect, cdpControl: false }).reason
    ).toBe("no_native_control")
    expect(
      chooseAgentInputBackend({ ...cdp, effect, attached: false }).reason
    ).toBe("no_native_control")
    expect(
      chooseAgentInputBackend({ ...cdp, effect, frameMapped: false }).reason
    ).toBe("frame_unmapped")
    expect(
      chooseAgentInputBackend({
        ...cdp,
        effect: { command: command({ type: "check" }), target }
      })
    ).toEqual({ backend: "dom", reason: "action_not_native" })
  })
})
