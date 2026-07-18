import { describe, expect, it, vi } from "vitest"
import { createAppError, isAbortError } from "@/lib/error-utils"
import {
  createErrorResponse,
  normalizeError,
  withErrorContext
} from "../error-handler"

describe("error-handler", () => {
  describe("normalizeError", () => {
    it("normalizes Error objects", () => {
      expect(normalizeError(new Error("Network down"))).toEqual({
        status: 0,
        message: "Network down"
      })
    })

    it("normalizes string errors", () => {
      expect(normalizeError("String failure")).toEqual({
        status: 0,
        message: "String failure"
      })
    })

    it("uses fallback for non-error values", () => {
      expect(
        normalizeError(undefined, { fallbackMessage: "Fallback" })
      ).toEqual({
        status: 0,
        message: "Fallback"
      })
    })

    it("preserves status and context", () => {
      const error = Object.assign(new Error("Bad gateway"), { status: 502 })

      expect(
        normalizeError(error, {
          context: "handler - operation",
          providerId: "ollama"
        })
      ).toEqual({
        status: 502,
        message: "Bad gateway",
        context: "handler - operation",
        providerId: "ollama"
      })
    })

    it("does not expose internal debug payloads", () => {
      expect(
        normalizeError(
          createAppError("Provider failed", {
            kind: "provider",
            debug: "raw provider payload"
          })
        )
      ).toEqual({
        status: 0,
        message: "Provider failed",
        kind: "provider"
      })
    })

    it("preserves provider retry timing without exposing debug data", () => {
      expect(
        normalizeError(
          createAppError("Rate limited", {
            kind: "provider",
            retryable: true,
            retryAfterMs: 3000,
            debug: "private upstream body"
          })
        )
      ).toEqual({
        status: 0,
        message: "Rate limited",
        kind: "provider",
        retryable: true,
        retryAfterMs: 3000
      })
    })

    it("preserves localized error keys without exposing debug data", () => {
      expect(
        normalizeError(
          createAppError("Invalid provider continuation data", {
            kind: "validation",
            messageKey: "chat.errors.provider_replay_invalid",
            debug: { signature: "private" }
          })
        )
      ).toEqual({
        status: 0,
        message: "Invalid provider continuation data",
        kind: "validation",
        messageKey: "chat.errors.provider_replay_invalid"
      })
    })
  })

  it("creates a standard failed response", () => {
    expect(createErrorResponse("Nope")).toEqual({
      success: false,
      error: {
        status: 0,
        message: "Nope"
      }
    })
  })

  it("detects abort errors without assuming an Error instance", () => {
    expect(isAbortError(new DOMException("Stop", "AbortError"))).toBe(true)
    expect(isAbortError({ name: "AbortError" })).toBe(true)
    expect(isAbortError("AbortError")).toBe(false)
  })

  it("uses the standard error shape in wrapped handlers", async () => {
    const port = {
      name: "test-port",
      postMessage: vi.fn()
    } as any
    const handler = withErrorContext(
      async () => {
        throw Object.assign(new Error("Provider failed"), { status: 503 })
      },
      {
        handler: "testHandler",
        operation: "test operation",
        providerId: "ollama"
      }
    )

    await handler({} as never, port, () => false)

    expect(port.postMessage).toHaveBeenCalledWith({
      error: {
        status: 503,
        message: "Provider failed",
        context: "testHandler - test operation",
        providerId: "ollama"
      }
    })
  })
})
