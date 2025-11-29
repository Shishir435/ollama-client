import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAutoResizeTextarea } from "../use-auto-resize-textarea"
import { createRef } from "react"

describe("useAutoResizeTextarea", () => {
  let textareaRef: React.RefObject<HTMLTextAreaElement>
  let mockTextarea: Partial<HTMLTextAreaElement>

  beforeEach(() => {
    // Create a mock textarea element
    mockTextarea = {
      style: {
        height: "",
        overflowY: ""
      } as CSSStyleDeclaration,
      scrollHeight: 150
    }
    
    textareaRef = { current: mockTextarea as HTMLTextAreaElement }
  })

  it("should set initial height on empty value", () => {
    renderHook(() => useAutoResizeTextarea(textareaRef, "", 100, 300))

    expect(mockTextarea.style?.height).toBe("100px")
    expect(mockTextarea.style?.overflowY).toBe("hidden")
  })

  it("should resize based on content", () => {
    renderHook(() => useAutoResizeTextarea(textareaRef, "Some content", 100, 300))

    // Should set to auto first, then to scrollHeight
    expect(mockTextarea.style?.height).toBe("150px")
  })

  it("should respect minimum height", () => {
    mockTextarea.scrollHeight = 50 // Less than minHeight

    renderHook(() => useAutoResizeTextarea(textareaRef, "Short", 100, 300))

    expect(mockTextarea.style?.height).toBe("100px")
  })

  it("should respect maximum height", () => {
    mockTextarea.scrollHeight = 400 // More than maxHeight

    renderHook(() => useAutoResizeTextarea(textareaRef, "Very long content", 100, 300))

    expect(mockTextarea.style?.height).toBe("300px")
    expect(mockTextarea.style?.overflowY).toBe("auto")
  })

  it("should hide overflow when within bounds", () => {
    mockTextarea.scrollHeight = 200 // Within bounds

    renderHook(() => useAutoResizeTextarea(textareaRef, "Medium content", 100, 300))

    expect(mockTextarea.style?.overflowY).toBe("hidden")
  })

  it("should handle value changes", () => {
    const { rerender } = renderHook(
      ({ value }) => useAutoResizeTextarea(textareaRef, value, 100, 300),
      { initialProps: { value: "Initial" } }
    )

    expect(mockTextarea.style?.height).toBe("150px")

    // Change to empty
    rerender({ value: "" })
    expect(mockTextarea.style?.height).toBe("100px")

    // Change back to content
    mockTextarea.scrollHeight = 200
    rerender({ value: "New content" })
    expect(mockTextarea.style?.height).toBe("200px")
  })

  it("should handle null ref gracefully", () => {
    const nullRef = { current: null }

    expect(() => {
      renderHook(() => useAutoResizeTextarea(nullRef, "test", 100, 300))
    }).not.toThrow()
  })

  it("should update when min/max heights change", () => {
    mockTextarea.scrollHeight = 250

    const { rerender } = renderHook(
      ({ min, max }) => useAutoResizeTextarea(textareaRef, "Content", min, max),
      { initialProps: { min: 100, max: 300 } }
    )

    expect(mockTextarea.style?.height).toBe("250px")

    // Lower the max height
    rerender({ min: 100, max: 200 })
    expect(mockTextarea.style?.height).toBe("200px")
    expect(mockTextarea.style?.overflowY).toBe("auto")
  })
})
