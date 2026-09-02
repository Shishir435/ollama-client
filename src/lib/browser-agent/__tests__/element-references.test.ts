import { describe, expect, it } from "vitest"

import { createAgentElementReferenceStore } from "../element-references"

describe("Agent element references", () => {
  it("binds references to one document, frame, snapshot, and generation", () => {
    const store = createAgentElementReferenceStore({ documentId: "document-1" })
    const first = store.beginSnapshot({
      minimumGeneration: 0,
      createSnapshotId: () => "snapshot-1"
    })
    const button = document.createElement("button")
    const ref = first.reference(button)
    expect(first.resolve(ref, first)).toBe(button)
    expect(
      first.resolve(ref, { ...first, documentId: "other" })
    ).toBeUndefined()
    expect(first.resolve(ref, { ...first, generation: 2 })).toBeUndefined()
  })

  it("invalidates every reference when a new snapshot starts", () => {
    const store = createAgentElementReferenceStore({ documentId: "document-1" })
    const first = store.beginSnapshot({
      minimumGeneration: 0,
      createSnapshotId: () => "snapshot-1"
    })
    const ref = first.reference(document.createElement("button"))
    const second = store.beginSnapshot({
      minimumGeneration: 2,
      createSnapshotId: () => "snapshot-2"
    })
    expect(first.resolve(ref, first)).toBeUndefined()
    expect(second.generation).toBe(2)
  })
})
