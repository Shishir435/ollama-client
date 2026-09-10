import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentElementReferenceStore } from "../element-references"
import {
  hitTestAgentPointInDocument,
  measureAgentElementsInDocument
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
  it("measures the refs that still resolve and skips the rest", () => {
    const button = document.createElement("button")
    const hidden = document.createElement("button")
    document.body.append(button, hidden)
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(rect(10, 20))
    vi.spyOn(hidden, "getBoundingClientRect").mockReturnValue(rect(0, 0, 0, 0))
    const { references, refs } = snapshotWith(button, hidden)
    expect(
      measureAgentElementsInDocument({
        identity,
        refs: [...refs, "e99"],
        references
      })
    ).toEqual([{ ref: refs[0], x: 10, y: 20, width: 50, height: 20 }])
    expect(
      measureAgentElementsInDocument({
        identity: { ...identity, generation: 2 },
        refs,
        references
      })
    ).toEqual([])
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
