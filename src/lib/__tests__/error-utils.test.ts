import { describe, expect, it } from "vitest"
import { getErrorMessage, isAbortError, isNamedError } from "../error-utils"

describe("error-utils", () => {
  it("gets messages from common error shapes", () => {
    expect(getErrorMessage(new Error("Native error"))).toBe("Native error")
    expect(getErrorMessage("String error")).toBe("String error")
    expect(getErrorMessage({ message: "Object error" })).toBe("Object error")
  })

  it("uses fallback for empty or unknown values", () => {
    expect(getErrorMessage(undefined, "Fallback")).toBe("Fallback")
    expect(getErrorMessage("", "Fallback")).toBe("Fallback")
    expect(getErrorMessage({}, "Fallback")).toBe("Fallback")
  })

  it("detects named errors without assuming Error instances", () => {
    expect(isAbortError(new DOMException("Stop", "AbortError"))).toBe(true)
    expect(isNamedError({ name: "SyntaxError" }, "SyntaxError")).toBe(true)
    expect(isAbortError("AbortError")).toBe(false)
  })
})
