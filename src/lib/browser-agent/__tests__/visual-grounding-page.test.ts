import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentElementReferenceStore } from "../element-references"
import {
  collectAgentSensitiveRegionsInDocument,
  hitTestAgentPointInDocument
} from "../visual-grounding-page"

const identity = {
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1"
}

const rect = (left: number, top: number, width = 50, height = 20) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  }) as DOMRect

beforeEach(() => {
  document.body.replaceChildren()
})
afterEach(() => vi.restoreAllMocks())

const snapshotWith = (...elements: Element[]) => {
  const references = createAgentElementReferenceStore({
    documentId: "document-1",
    frameId: 0
  })
  const snapshot = references.beginSnapshot({
    minimumGeneration: 0,
    createSnapshotId: () => "snapshot-1"
  })
  const refs = elements.map((element) => snapshot.reference(element))
  return { references, refs }
}

describe("visual grounding in the page", () => {
  it("names every sensitive control and every child frame in the whole page, with the scroll it read at", () => {
    const password = document.createElement("input")
    password.type = "password"
    const name = document.createElement("input")
    const frame = document.createElement("iframe")
    const host = document.createElement("div")
    const shadow = host.attachShadow({ mode: "open" })
    const hidden = document.createElement("input")
    hidden.type = "password"
    shadow.append(hidden)
    document.body.append(password, name, frame, host)
    vi.spyOn(password, "getClientRects").mockReturnValue([
      rect(10, 20)
    ] as unknown as DOMRectList)
    vi.spyOn(name, "getClientRects").mockReturnValue([
      rect(10, 60)
    ] as unknown as DOMRectList)
    vi.spyOn(frame, "getClientRects").mockReturnValue([
      rect(0, 100, 300, 150)
    ] as unknown as DOMRectList)
    vi.spyOn(hidden, "getClientRects").mockReturnValue([
      rect(400, 20)
    ] as unknown as DOMRectList)
    /* Only the password field was observed; the one inside the shadow root was not. */
    const { references } = snapshotWith(password)
    const regions = collectAgentSensitiveRegionsInDocument({
      identity,
      document,
      references
    })
    expect(regions?.rects).toEqual([
      { x: 10, y: 20, width: 50, height: 20 },
      { x: 0, y: 100, width: 300, height: 150 },
      { x: 400, y: 20, width: 50, height: 20 }
    ])
    expect(regions?.scroll).toEqual({ x: 0, y: 0 })
    expect(
      collectAgentSensitiveRegionsInDocument({
        identity: { ...identity, generation: 2 },
        document,
        references
      })
    ).toBeNull()
  })

  it("passes over a listed ancestor the run could not act on", () => {
    /**
     * A wrapper with no box of its own is listed and contains the point, and
     * answering with it handed the resolver a target it refuses by rule: a
     * run spent its whole budget clicking one screenshot point and being told
     * the control it named was not visible.
     */
    const wrapper = document.createElement("div")
    const input = document.createElement("input")
    wrapper.append(input)
    document.body.append(wrapper)
    vi.spyOn(wrapper, "getClientRects").mockReturnValue(
      [] as unknown as DOMRectList
    )
    vi.spyOn(input, "getClientRects").mockReturnValue([
      rect(0, 0)
    ] as unknown as DOMRectList)
    /** Only the wrapper was listed, so the walk climbs to it from the input. */
    const { references } = snapshotWith(wrapper)

    document.elementFromPoint = () => input
    const hit = hitTestAgentPointInDocument({
      identity,
      point: { x: 5, y: 5 },
      document,
      references
    })

    expect(hit?.element).toMatchObject({ tag: "input", visible: true })
  })

  it("answers a point with the listed control that contains it, else the hit element newly referenced", () => {
    const button = document.createElement("button")
    const icon = document.createElement("span")
    button.append(icon)
    const canvas = document.createElement("canvas")
    document.body.append(button, canvas)
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
      rect(0, 0)
    ] as unknown as DOMRectList)
    const { references, refs } = snapshotWith(button)

    document.elementFromPoint = () => icon
    const onButton = hitTestAgentPointInDocument({
      identity,
      point: { x: 5, y: 5 },
      document,
      references
    })
    expect(onButton).toMatchObject({ element: { ref: refs[0], tag: "button" } })

    document.elementFromPoint = () => canvas
    const onCanvas = hitTestAgentPointInDocument({
      identity,
      point: { x: 5, y: 5 },
      document,
      references
    })
    expect(onCanvas?.element).toMatchObject({ tag: "canvas", frameId: 0 })
    const ref = onCanvas?.element?.ref as string
    expect(ref).toMatch(/^e\d+$/)
    /* The new ref is bound to this snapshot like any other. */
    expect(references.resolve(ref, identity)).toBe(canvas)
    expect(
      references.resolve(ref, { ...identity, generation: 2 })
    ).toBeUndefined()
  })

  it("reports a frame under the point, nothing under an empty point, and nothing for a stale snapshot", () => {
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const { references } = snapshotWith()
    document.elementFromPoint = () => frame
    expect(
      hitTestAgentPointInDocument({
        identity,
        point: { x: 1, y: 1 },
        document,
        references
      })
    ).toEqual({
      frameElement: true
    })
    document.elementFromPoint = () => null
    expect(
      hitTestAgentPointInDocument({
        identity,
        point: { x: 1, y: 1 },
        document,
        references
      })
    ).toBeNull()
    document.elementFromPoint = () => frame
    expect(
      hitTestAgentPointInDocument({
        identity: { ...identity, snapshotId: "other" },
        point: { x: 1, y: 1 },
        document,
        references
      })
    ).toBeNull()
  })
})
