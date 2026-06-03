import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => {
  const toastFn = vi.fn().mockReturnValue("toast-1") as ReturnType<
    typeof vi.fn
  > & {
    error: ReturnType<typeof vi.fn>
    dismiss: ReturnType<typeof vi.fn>
  }
  toastFn.error = vi.fn().mockReturnValue("toast-err-1")
  toastFn.dismiss = vi.fn()
  return { toast: toastFn }
})

import { toast as sonnerToast } from "sonner"
import { toast, useToast } from "../use-toast"

const mockedSonnerToast = sonnerToast as unknown as ReturnType<typeof vi.fn> & {
  error: ReturnType<typeof vi.fn>
  dismiss: ReturnType<typeof vi.fn>
}

describe("toast", () => {
  it("calls sonnerToast (not error) for default variant", () => {
    toast({ title: "Hello" })

    expect(mockedSonnerToast).toHaveBeenCalledWith("Hello", expect.any(Object))
    expect(mockedSonnerToast.error).not.toHaveBeenCalled()
  })

  it("calls sonnerToast.error for destructive variant", () => {
    toast({ title: "Oops", variant: "destructive" })

    expect(mockedSonnerToast.error).toHaveBeenCalledWith(
      "Oops",
      expect.any(Object)
    )
    expect(mockedSonnerToast).not.toHaveBeenCalled()
  })

  it("uses description as first arg when no title is provided", () => {
    toast({ description: "Only a description" })

    expect(mockedSonnerToast).toHaveBeenCalledWith(
      "Only a description",
      expect.objectContaining({ description: undefined })
    )
  })

  it("returns object with id, dismiss, and update", () => {
    const result = toast({ title: "Test" })

    expect(result).toHaveProperty("id", "toast-1")
    expect(result.dismiss).toBeTypeOf("function")
    expect(result.update).toBeTypeOf("function")
  })

  it("dismiss() calls sonnerToast.dismiss with the toast id", () => {
    const result = toast({ title: "Dismiss me" })
    result.dismiss()

    expect(mockedSonnerToast.dismiss).toHaveBeenCalledWith("toast-1")
  })

  it("update() calls sonnerToast with { id } merged into options", () => {
    const result = toast({ title: "Original" })
    result.update({ title: "Updated" })

    expect(mockedSonnerToast).toHaveBeenLastCalledWith(
      "Updated",
      expect.objectContaining({ id: "toast-1" })
    )
  })

  it("passes Infinity duration to sonner", () => {
    toast({ title: "Sticky", duration: Infinity })

    expect(mockedSonnerToast).toHaveBeenCalledWith(
      "Sticky",
      expect.objectContaining({ duration: Infinity })
    )
  })

  it("passes undefined duration to sonner when duration is undefined", () => {
    toast({ title: "Default timeout" })

    expect(mockedSonnerToast).toHaveBeenCalledWith(
      "Default timeout",
      expect.objectContaining({ duration: undefined })
    )
  })
})

describe("useToast", () => {
  it("returns object containing a toast function", () => {
    const { result } = renderHook(() => useToast())

    expect(result.current.toast).toBeTypeOf("function")
  })

  it("dismiss(id) calls sonnerToast.dismiss with the given id", () => {
    const { result } = renderHook(() => useToast())
    result.current.dismiss("some-id")

    expect(mockedSonnerToast.dismiss).toHaveBeenCalledWith("some-id")
  })
})
