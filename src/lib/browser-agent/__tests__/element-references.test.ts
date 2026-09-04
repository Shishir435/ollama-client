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
    expect(store.matches(first)).toBe(true)
    expect(store.resolve(ref, first)).toBe(button)
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
    expect(store.matches(first)).toBe(false)
    expect(second.generation).toBe(2)
  })

  it("keeps an extension-issued identity for the same live element", () => {
    let nextId = 0
    const store = createAgentElementReferenceStore({
      documentId: "document-1",
      createVerificationId: () => `node-${++nextId}`
    })
    const input = document.createElement("input")
    const first = store.beginSnapshot({
      minimumGeneration: 0,
      createSnapshotId: () => "snapshot-1"
    })
    const firstId = first.verificationId(input)
    const second = store.beginSnapshot({
      minimumGeneration: 2,
      createSnapshotId: () => "snapshot-2"
    })

    expect(second.verificationId(input)).toBe(firstId)
    expect(second.verificationId(document.createElement("input"))).not.toBe(
      firstId
    )
  })

  it("binds exact hidden form state without exposing it in a reference", () => {
    const store = createAgentElementReferenceStore({ documentId: "document-1" })
    const form = document.createElement("form")
    const hidden = document.createElement("input")
    hidden.type = "hidden"
    hidden.value = "recipient-a"
    const submit = document.createElement("button")
    form.append(hidden, submit)
    const snapshot = store.beginSnapshot({
      minimumGeneration: 0,
      createSnapshotId: () => "snapshot-1"
    })
    const ref = snapshot.reference(submit)

    expect(store.matchesFormState(ref, snapshot)).toBe(true)
    expect(ref).not.toContain("recipient-a")
    hidden.value = "recipient-b"
    expect(store.matchesFormState(ref, snapshot)).toBe(false)
  })
})
