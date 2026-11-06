import { act, render } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import {
  hasUnsavedSettings,
  useReportUnsavedChanges,
  useUnsavedChangesStore
} from "../unsaved-changes-store"

const Reporter = ({ dirty }: { dirty: boolean }) => {
  useReportUnsavedChanges("providers", dirty)
  return null
}

describe("unsaved changes store", () => {
  beforeEach(() => {
    act(() => useUnsavedChangesStore.getState().clear())
  })

  it("tracks a draft for as long as its owner reports it", () => {
    const { rerender, unmount } = render(<Reporter dirty={false} />)
    expect(hasUnsavedSettings()).toBe(false)

    rerender(<Reporter dirty />)
    expect(hasUnsavedSettings()).toBe(true)

    unmount()
    expect(hasUnsavedSettings()).toBe(false)
  })

  it("keeps independent sources apart", () => {
    const { setDirty } = useUnsavedChangesStore.getState()
    act(() => {
      setDirty("a", true)
      setDirty("b", true)
      setDirty("a", false)
    })
    expect(hasUnsavedSettings()).toBe(true)
    act(() => setDirty("b", false))
    expect(hasUnsavedSettings()).toBe(false)
  })
})
