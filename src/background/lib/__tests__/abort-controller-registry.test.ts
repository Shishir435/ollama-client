import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  abortAndClearController,
  clearAbortController,
  getAbortController,
  hasAbortController,
  setAbortController
} from "../abort-controller-registry"

describe("Abort Controller Registry", () => {
  beforeEach(() => {
    /*
     * Clear map by clearing all known keys or just relying on test isolation if possible.
     * Since the map is module-level, we need to manually clear it or rely on overwrite.
     * The module doesn't export a clearAll function.
     * We can just use unique keys for each test or manually clear.
     * Let's rely on manual clearing for now.
     */
  })

  it("should set and get controller", () => {
    const controller = new AbortController()
    setAbortController("test-1", controller)
    expect(getAbortController("test-1")).toBe(controller)
    expect(hasAbortController("test-1")).toBe(true)
  })

  it("should clear controller", () => {
    const controller = new AbortController()
    setAbortController("test-2", controller)
    clearAbortController("test-2")
    expect(getAbortController("test-2")).toBeUndefined()
    expect(hasAbortController("test-2")).toBe(false)
  })

  it("should abort and clear controller", () => {
    const controller = new AbortController()
    const abortSpy = vi.spyOn(controller, "abort")
    setAbortController("test-3", controller)
    
    abortAndClearController("test-3")
    
    expect(abortSpy).toHaveBeenCalled()
    expect(getAbortController("test-3")).toBeUndefined()
  })

  it("should handle aborting non-existent controller", () => {
    // Should not throw
    abortAndClearController("non-existent")
  })

  it("should remove controller when set to null", () => {
    const controller = new AbortController()
    setAbortController("test-4", controller)
    setAbortController("test-4", null)
    expect(getAbortController("test-4")).toBeUndefined()
  })
})
