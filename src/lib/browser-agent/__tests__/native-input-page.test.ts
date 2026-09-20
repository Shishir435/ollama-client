import { AgentEffectNotAppliedError } from "@ollama-client/agent-runtime"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AgentDomMutationInstruction } from "../control-port"
import { createAgentElementReferenceStore } from "../element-references"
import {
  createAgentInputWatch,
  prepareAgentNativeInputInDocument
} from "../native-input-page"
import { buildAgentElementObservation } from "../observation-builder"

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

const observed = () => {
  const button = document.createElement("button")
  button.textContent = "Open"
  document.body.append(button)
  const references = createAgentElementReferenceStore({
    documentId: identity.documentId,
    frameId: 0
  })
  const snapshot = references.beginSnapshot({
    minimumGeneration: 0,
    createSnapshotId: () => identity.snapshotId
  })
  const ref = snapshot.reference(button)
  const element = buildAgentElementObservation(button, ref, 0)
  const instruction: AgentDomMutationInstruction = {
    command: {
      type: "click",
      snapshotId: identity.snapshotId,
      generation: 1,
      ref
    },
    target: {
      ref,
      frameId: 0,
      tag: element.tag,
      accessibleName: element.name,
      inputType: element.type,
      observedValue: element.value,
      observedChecked: element.checked,
      observedFocused: element.focused,
      sensitive: false,
      maySubmit: false
    },
    snapshotIdentity: identity,
    frame: identity
  }
  return { button, references, instruction }
}

describe("native input preparation", () => {
  it("returns a reachable frame-local point and arms the watch on the checked element", () => {
    const { button, references, instruction } = observed()
    document.elementFromPoint = () => button
    const watch = createAgentInputWatch(document, { trusted: () => true })
    const prepared = prepareAgentNativeInputInDocument({
      effect: instruction,
      references,
      watch
    })
    expect(prepared).toEqual({ point: { x: 20, y: 20 }, focused: false })
    button.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 20, clientY: 20 })
    )
    expect(watch.settle()).toEqual({
      events: [{ type: "mousedown", x: 20, y: 20, onTarget: true }]
    })
  })

  it("refuses a target whose every click point another element covers", () => {
    const { references, instruction } = observed()
    const cover = document.createElement("div")
    document.body.append(cover)
    document.elementFromPoint = () => cover
    expect(() =>
      prepareAgentNativeInputInDocument({
        effect: instruction,
        references,
        watch: createAgentInputWatch(document)
      })
    ).toThrow(AgentEffectNotAppliedError)
  })

  it("refuses a target that was replaced after approval, before arming anything", () => {
    const { button, references, instruction } = observed()
    button.replaceWith(button.cloneNode(true))
    const watch = createAgentInputWatch(document)
    expect(() =>
      prepareAgentNativeInputInDocument({
        effect: instruction,
        references,
        watch
      })
    ).toThrow(AgentEffectNotAppliedError)
    expect(watch.settle()).toBeUndefined()
  })

  it("brings an off-screen target into view before choosing its point", () => {
    const { button, references, instruction } = observed()
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue(
      rect(5_000, 10)
    )
    const scrolled = vi.fn()
    button.scrollIntoView = scrolled
    document.elementFromPoint = () => button
    prepareAgentNativeInputInDocument({
      effect: instruction,
      references,
      watch: createAgentInputWatch(document)
    })
    expect(scrolled).toHaveBeenCalledWith({
      block: "center",
      inline: "center",
      behavior: "instant"
    })
  })
})

describe("native input watch", () => {
  it("records only trusted input, marks foreign targets, and overflows rather than truncating silently", () => {
    const target = document.createElement("input")
    const other = document.createElement("button")
    document.body.append(target, other)
    let trusted = true
    const watch = createAgentInputWatch(document, { trusted: () => trusted })
    watch.arm(target)
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true })
    )
    other.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 1, clientY: 2 })
    )
    trusted = false
    target.dispatchEvent(
      new KeyboardEvent("keyup", { key: "a", bubbles: true })
    )
    target.dispatchEvent(new Event("input", { bubbles: true }))
    expect(watch.settle()).toEqual({
      events: [
        { type: "keydown", key: "a", onTarget: true },
        { type: "mousedown", x: 1, y: 2, onTarget: false }
      ]
    })
    /* A settled watch records nothing further. */
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", bubbles: true })
    )
    expect(watch.settle()).toBeUndefined()
  })

  it("replaces an earlier watch when armed again", () => {
    const first = document.createElement("input")
    const second = document.createElement("input")
    document.body.append(first, second)
    const watch = createAgentInputWatch(document, { trusted: () => true })
    watch.arm(first)
    watch.arm(second)
    second.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true })
    )
    expect(watch.settle()?.events).toEqual([
      { type: "keydown", key: "a", onTarget: true }
    ])
  })
})

describe("native input preparation for a visual point", () => {
  it("uses the named point when the control still lies under it, and refuses when it does not", () => {
    const { button, references, instruction } = observed()
    const pointed = { ...instruction, point: { x: 15, y: 15 } }
    document.elementFromPoint = () => button
    const watch = createAgentInputWatch(document, { trusted: () => true })
    expect(
      prepareAgentNativeInputInDocument({ effect: pointed, references, watch })
    ).toEqual({ point: { x: 15, y: 15 }, focused: false })

    const cover = document.createElement("div")
    document.body.append(cover)
    document.elementFromPoint = () => cover
    expect(() =>
      prepareAgentNativeInputInDocument({ effect: pointed, references, watch })
    ).toThrow(AgentEffectNotAppliedError)
  })
})
