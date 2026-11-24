import { describe, expect, it } from "vitest"
import { formatErrorForDisplay, getDisplayErrorMessage } from "../error-display"
import { createAppError } from "../error-utils"

/** Echoes the key so a test sees which copy was chosen, not its wording. */
const t = (key: string) => `<${key}>`

describe("error-display", () => {
  it("prefers user-facing messages from app errors", () => {
    const error = createAppError("Raw provider payload", {
      kind: "provider",
      userMessage: "Provider failed",
      retryable: true
    })

    expect(getDisplayErrorMessage(error)).toBe("Provider failed")
    expect(formatErrorForDisplay(error, t)).toEqual({
      title: "<errors.display.title.provider>",
      message:
        "Provider failed. <errors.display.hint.provider> <errors.display.retryable>",
      rawMessage: "Provider failed",
      kind: "provider",
      retryable: true
    })
  })

  it("takes every user-visible word from the translator", () => {
    const result = formatErrorForDisplay(
      { status: 0, kind: "network", message: "Failed to fetch" },
      (key) => `L:${key}`
    )

    expect(result.title).toBe("L:errors.display.title.network")
    expect(result.message).toBe(
      "Failed to fetch. L:errors.display.hint.network"
    )
  })

  it("titles an error with no recognised kind generically", () => {
    const result = formatErrorForDisplay(new Error("boom"), t)

    expect(result.title).toBe("<errors.display.title.default>")
    expect(result.message).toBe("boom")
  })

  it("uses the translated generic message when nothing is displayable", () => {
    expect(formatErrorForDisplay(createAppError(""), t).message).toBe(
      "<errors.display.generic>"
    )
  })

  it("does not double the closing punctuation of a localized message", () => {
    const result = formatErrorForDisplay(
      createAppError("x", {
        kind: "storage",
        userMessage: "保存に失敗しました。"
      }),
      t
    )

    expect(result.message.startsWith("保存に失敗しました。 ")).toBe(true)
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
