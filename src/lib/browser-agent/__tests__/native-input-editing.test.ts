import { AgentEffectNotAppliedError } from "@ollama-client/agent-runtime"
import type { AgentCommand } from "@ollama-client/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AgentDomMutationInstruction } from "../control-port"
import { createAgentElementReferenceStore } from "../element-references"
import {
  type AgentInputTrace,
  AgentNativeInputCancelledError,
  type AgentNativeInputStep,
  assessAgentInputDelivery,
  chooseAgentInputBackend,
  planAgentNativeInput,
  runAgentNativeInputPlan
} from "../native-input"
import {
  createAgentInputWatch,
  prepareAgentNativeInputInDocument
} from "../native-input-page"
import {
  buildAgentElementObservation,
  buildAgentObservation
} from "../observation-builder"

/**
 * Editing and dragging on the native backend: the plans, the release a
 * cancelled drag owes, the delivery matching a drag's end allows, and the
 * page-side preparation that places a selection or finds a drop point.
 */

const grounded = { snapshotId: "snapshot-1", generation: 1 }
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
          : step.kind === "drag"
            ? `drag:${step.type}@${step.x},${step.y}`
            : "wheel"
  )

describe("native editing plans", () => {
  it("types a replacement over the selection the page placed, without a click", () => {
    const built = plan({ type: "replace_text", find: "old", text: "new" })
    expect(kinds(built.steps)).toEqual([
      "keyDown:n",
      "keyUp:n",
      "keyDown:e",
      "keyUp:e",
      "keyDown:w",
      "keyUp:w"
    ])
  })

  it("deletes the selection with Backspace when the replacement is empty", () => {
    const built = plan({ type: "replace_text", find: "old", text: "" })
    expect(kinds(built.steps)).toEqual(["keyDown:Backspace", "keyUp:Backspace"])
  })

  it("presses on the source, moves in held steps and drops at the destination in root coordinates", () => {
    const built = plan(
      { type: "drag", to: "e2" },
      { dropPoint: { x: 70, y: 80 } }
    )
    expect(kinds(built.steps)).toEqual([
      "mouseMoved",
      "mousePressed",
      "drag:move@122,232",
      "drag:move@140,250",
      "drag:move@170,280",
      "drag:drop@170,280"
    ])
    expect(built.expected).toEqual([
      { type: "mousemove", x: 10, y: 20 },
      { type: "mousedown", x: 10, y: 20 },
      {
        type: "mouseup",
        alternatives: ["drop"],
        x: 70,
        y: 80,
        anyTarget: true
      }
    ])
  })

  it("refuses to plan a drag with no drop point", () => {
    expect(() => plan({ type: "drag", to: "e2" })).toThrow(/drop point/)
  })

  it("chooses the native backend for edits and drags when the debugger holds the frame", () => {
    for (const type of ["replace_text", "drag"]) {
      expect(
        chooseAgentInputBackend({
          effect: {
            command: command({ type, to: "e2", find: "a", text: "b" }),
            target: { sensitive: false, maySubmit: false }
          },
          cdpControl: true,
          attached: true,
          frameMapped: true
        })
      ).toEqual({ backend: "cdp", reason: "native" })
    }
  })
})

describe("cancelled drags", () => {
  it("cancels the drag rather than dropping when the run stops mid-gesture", async () => {
    const built = plan(
      { type: "drag", to: "e2" },
      { dropPoint: { x: 70, y: 80 } }
    )
    const sent: AgentNativeInputStep[] = []
    let aborted = false
    const dispatcher = {
      async dispatch(step: AgentNativeInputStep) {
        sent.push(step)
        if (step.kind === "drag" && step.x === 140) aborted = true
      }
    }
    await expect(
      runAgentNativeInputPlan(built, dispatcher, {
        get aborted() {
          return aborted
        }
      })
    ).rejects.toBeInstanceOf(AgentNativeInputCancelledError)
    expect(kinds(sent)).toEqual([
      "mouseMoved",
      "mousePressed",
      "drag:move@122,232",
      "drag:move@140,250",
      "drag:cancel@140,250"
    ])
  })
})

describe("drag delivery", () => {
  const dragPlan = plan(
    { type: "drag", to: "e2" },
    { dropPoint: { x: 70, y: 80 } }
  )
  const trace = (events: AgentInputTrace["events"]): AgentInputTrace => ({
    events
  })

  it("accepts a drop on the destination as the end of the plan", () => {
    expect(
      assessAgentInputDelivery(
        dragPlan,
        trace([
          { type: "mousemove", x: 10, y: 20, onTarget: true },
          { type: "mousedown", x: 10, y: 20, onTarget: true },
          { type: "mousemove", x: 40, y: 50, onTarget: false },
          { type: "drop", x: 70, y: 80, onTarget: false }
        ])
      )
    ).toBe("delivered")
  })

  it("accepts a mouseup wherever the pointer is for a pointer-based drag", () => {
    expect(
      assessAgentInputDelivery(
        dragPlan,
        trace([
          { type: "mousemove", x: 10, y: 20, onTarget: true },
          { type: "mousedown", x: 10, y: 20, onTarget: true },
          { type: "mouseup", x: 70, y: 80, onTarget: true }
        ])
      )
    ).toBe("delivered")
  })

  it("still reports a press that landed off the source as misdirected", () => {
    expect(
      assessAgentInputDelivery(
        dragPlan,
        trace([
          { type: "mousemove", x: 10, y: 20, onTarget: true },
          { type: "mousedown", x: 10, y: 20, onTarget: false },
          { type: "drop", x: 70, y: 80, onTarget: false }
        ])
      )
    ).toBe("misdirected")
  })

  it("treats a drop the plan did not send as interference", () => {
    expect(
      assessAgentInputDelivery(plan({ type: "click" }), {
        events: [
          { type: "mousemove", x: 10, y: 20, onTarget: true },
          { type: "mousedown", x: 10, y: 20, onTarget: true },
          { type: "mouseup", x: 10, y: 20, onTarget: true },
          { type: "drop", x: 30, y: 30, onTarget: false }
        ]
      })
    ).toBe("interference")
  })
})

describe("page-side editing preparation", () => {
  const identity = {
    snapshotId: "snapshot-1",
    generation: 1,
    tabId: 7,
    frameId: 0,
    documentId: "document-1"
  }

  const rect = (top: number, left: number, size = 20) =>
    ({
      top,
      left,
      bottom: top + size,
      right: left + size,
      width: size,
      height: size
    }) as DOMRect

  beforeEach(() => {
    document.body.replaceChildren()
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
      rect(10, 10)
    ] as unknown as DOMRectList)
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      rect(10, 10)
    )
  })

  afterEach(() => vi.restoreAllMocks())

  const snapshotOf = () => {
    const references = createAgentElementReferenceStore({
      documentId: identity.documentId,
      frameId: 0
    })
    const snapshot = references.beginSnapshot({
      minimumGeneration: 0,
      createSnapshotId: () => identity.snapshotId
    })
    return { references, snapshot }
  }

  it("selects the run to replace, focuses the editor and reports it focused", () => {
    const editor = document.createElement("div")
    editor.setAttribute("contenteditable", "true")
    editor.innerHTML = "<p>Hello world</p>"
    document.body.append(editor)
    document.elementFromPoint = () => editor
    const { references, snapshot } = snapshotOf()
    const ref = snapshot.reference(editor)
    const element = buildAgentElementObservation(editor, ref, 0)
    const instruction: AgentDomMutationInstruction = {
      command: {
        ...grounded,
        type: "replace_text",
        ref,
        find: "world",
        text: "x"
      },
      target: {
        ref,
        frameId: 0,
        tag: "div",
        inputType: "contenteditable",
        observedValue: element.value,
        expectedValue: "Hello x",
        sensitive: false,
        maySubmit: false
      },
      snapshotIdentity: identity,
      frame: identity
    }
    const watch = createAgentInputWatch(document, { trusted: () => true })
    const prepared = prepareAgentNativeInputInDocument({
      effect: instruction,
      references,
      watch
    })
    expect(prepared.focused).toBe(true)
    expect(prepared.dropPoint).toBeUndefined()
    expect(window.getSelection()?.toString()).toBe("world")
    editor.innerHTML = "<p>world world</p>"
    expect(() =>
      prepareAgentNativeInputInDocument({
        effect: instruction,
        references,
        watch
      })
    ).toThrow(AgentEffectNotAppliedError)
  })

  it("returns the destination's own point for a drag and refuses a destination that changed", () => {
    document.body.innerHTML =
      '<ul role="list" aria-label="Todo"><li id="a" draggable="true">Task A</li></ul><ul id="done" role="list" aria-label="Done"></ul>'
    const item = document.getElementById("a") as HTMLElement
    const done = document.getElementById("done") as HTMLElement
    item.getClientRects = () => [rect(10, 10)] as unknown as DOMRectList
    done.getClientRects = () => [rect(50, 50)] as unknown as DOMRectList
    document.elementFromPoint = ((x: number) =>
      x < 40 ? item : done) as Document["elementFromPoint"]
    const { references, snapshot } = snapshotOf()
    const ref = snapshot.reference(item)
    const to = snapshot.reference(done)
    const source = buildAgentElementObservation(item, ref, 0)
    const destination = buildAgentElementObservation(done, to, 0)
    const instruction: AgentDomMutationInstruction = {
      command: { ...grounded, type: "drag", ref, to },
      target: {
        ref,
        frameId: 0,
        tag: "li",
        accessibleName: source.name,
        observedValue: source.value,
        drop: {
          ref: to,
          frameId: 0,
          tag: "ul",
          role: "list",
          accessibleName: destination.name
        },
        sensitive: false,
        maySubmit: false
      },
      snapshotIdentity: identity,
      frame: identity
    }
    const watch = createAgentInputWatch(document, { trusted: () => true })
    const prepared = prepareAgentNativeInputInDocument({
      effect: instruction,
      references,
      watch
    })
    expect(prepared.point).toEqual({ x: 20, y: 20 })
    expect(prepared.dropPoint).toEqual({ x: 60, y: 60 })
    done.setAttribute("aria-label", "Archive")
    expect(() =>
      prepareAgentNativeInputInDocument({
        effect: instruction,
        references,
        watch
      })
    ).toThrow(AgentEffectNotAppliedError)
  })

  it("observes an editing host as a typed, valued, multiline control named by its placeholder, and marks draggable items", () => {
    document.body.innerHTML =
      '<div id="doc" contenteditable="true" role="textbox" aria-multiline="true" aria-placeholder="Write something"><p>Hello</p><p>World</p></div>' +
      '<div id="line" contenteditable="true" role="textbox">One line</div>' +
      '<div id="free" contenteditable="plaintext-only">Free</div>' +
      '<li id="card" draggable="true">Card</li>' +
      '<div contenteditable="false" role="button">Toolbar</div>' +
      '<div id="sortable" role="button" aria-roledescription="sortable">Row</div>'
    history.replaceState({}, "", "/editor")
    const observation = buildAgentObservation({
      document,
      tabId: 7,
      documentId: "document-1",
      minimumGeneration: 0,
      references: createAgentElementReferenceStore({
        documentId: "document-1",
        frameId: 0
      }),
      createSnapshotId: () => "snapshot-1",
      capturedAt: 1
    })
    const byTag = observation.elements.map(
      ({ tag, type, value, name, multiline, draggable, editable }) => ({
        tag,
        type,
        value,
        name,
        multiline,
        draggable,
        editable
      })
    )
    expect(byTag).toEqual([
      {
        tag: "div",
        type: "contenteditable",
        value: "Hello\nWorld",
        name: "Write something",
        multiline: true,
        draggable: undefined,
        editable: true
      },
      {
        tag: "div",
        type: "contenteditable",
        value: "One line",
        name: undefined,
        multiline: undefined,
        draggable: undefined,
        editable: true
      },
      {
        tag: "div",
        type: "contenteditable",
        value: "Free",
        name: undefined,
        multiline: true,
        draggable: undefined,
        editable: true
      },
      {
        tag: "li",
        type: undefined,
        value: undefined,
        name: "Card",
        multiline: undefined,
        draggable: true,
        editable: false
      },
      {
        tag: "div",
        type: undefined,
        value: undefined,
        name: "Toolbar",
        multiline: undefined,
        draggable: undefined,
        editable: false
      },
      {
        tag: "div",
        type: undefined,
        value: undefined,
        name: "Row",
        multiline: undefined,
        draggable: true,
        editable: false
      }
    ])
  })
})
