import { beforeEach, describe, expect, it } from "vitest"
import {
  MAX_SELECTION_CONTEXT_ITEMS,
  selectionContextStore
} from "../selection-context-store"

const { getState } = selectionContextStore

describe("selectionContextStore", () => {
  beforeEach(() => getState().clear())

  it("adds and removes passages", () => {
    getState().add({ id: "a", text: "one" })
    getState().add({ id: "b", text: "two" })
    getState().remove("a")
    expect(getState().items.map((item) => item.id)).toEqual(["b"])
  })

  it("ignores a delivery it has already seen", () => {
    getState().add({ id: "a", text: "one" })
    getState().add({ id: "a", text: "one" })
    expect(getState().items).toHaveLength(1)
  })

  it("keeps one chip for the same passage from the same page", () => {
    getState().add({ id: "a", text: "same", url: "https://x.test/p" })
    getState().add({ id: "b", text: "same", url: "https://x.test/p" })
    getState().add({ id: "c", text: "same", url: "https://x.test/other" })
    expect(getState().items.map((item) => item.id)).toEqual(["a", "c"])
  })

  it("drops the earliest when more than the limit are added", () => {
    for (let i = 0; i < MAX_SELECTION_CONTEXT_ITEMS + 2; i++) {
      getState().add({ id: `i${i}`, text: `text ${i}` })
    }
    const ids = getState().items.map((item) => item.id)
    expect(ids).toHaveLength(MAX_SELECTION_CONTEXT_ITEMS)
    expect(ids[0]).toBe("i2")
  })

  it("clears everything, without churn when already empty", () => {
    const empty = getState().items
    getState().clear()
    expect(getState().items).toBe(empty)

    getState().add({ id: "a", text: "one" })
    getState().clear()
    expect(getState().items).toEqual([])
  })
})
