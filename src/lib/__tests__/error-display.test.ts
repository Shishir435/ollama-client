import { describe, expect, it } from "vitest"
import { formatErrorForDisplay, getDisplayErrorMessage } from "../error-display"
import { createAppError } from "../error-utils"

describe("error-display", () => {
  it("prefers user-facing messages from app errors", () => {
    const error = createAppError("Raw provider payload", {
      kind: "provider",
      userMessage: "Provider failed",
      retryable: true
    })

    expect(getDisplayErrorMessage(error)).toBe("Provider failed")
    expect(formatErrorForDisplay(error)).toEqual({
      title: "Provider error",
      message:
        "Provider failed. Check the selected provider, model, and provider logs. This may be temporary; try again.",
      rawMessage: "Provider failed",
      kind: "provider",
      retryable: true
    })
  })

  it("formats response envelopes", () => {
    expect(
      formatErrorForDisplay({
        status: 0,
        kind: "network",
        message: "Failed to fetch"
      }).message
    ).toBe(
      "Failed to fetch. Check that the provider server is running and the URL is reachable."
    )
  })

  it("keeps plain string errors unchanged", () => {
    expect(getDisplayErrorMessage("Download cancelled")).toBe(
      "Download cancelled"
    )
  })

  it("uses fallback for app errors with no displayable message", () => {
    expect(getDisplayErrorMessage(createAppError(""), "Fallback message")).toBe(
      "Fallback message"
    )
  })
})
