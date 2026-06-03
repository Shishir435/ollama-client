import { beforeEach, describe, expect, it } from "vitest"
import { useSearchDialogStore } from "../search-dialog-store"

beforeEach(() => {
  useSearchDialogStore.setState({ isOpen: false })
})

describe("useSearchDialogStore", () => {
  it("initializes closed", () => {
    expect(useSearchDialogStore.getState().isOpen).toBe(false)
  })

  it("opens dialog", () => {
    useSearchDialogStore.getState().openSearchDialog()
    expect(useSearchDialogStore.getState().isOpen).toBe(true)
  })

  it("closes dialog", () => {
    useSearchDialogStore.setState({ isOpen: true })
    useSearchDialogStore.getState().closeSearchDialog()
    expect(useSearchDialogStore.getState().isOpen).toBe(false)
  })

  it("toggles from closed to open", () => {
    useSearchDialogStore.getState().toggleSearchDialog()
    expect(useSearchDialogStore.getState().isOpen).toBe(true)
  })

  it("toggles from open to closed", () => {
    useSearchDialogStore.setState({ isOpen: true })
    useSearchDialogStore.getState().toggleSearchDialog()
    expect(useSearchDialogStore.getState().isOpen).toBe(false)
  })

  it("double toggle returns to original state", () => {
    useSearchDialogStore.getState().toggleSearchDialog()
    useSearchDialogStore.getState().toggleSearchDialog()
    expect(useSearchDialogStore.getState().isOpen).toBe(false)
  })
})
