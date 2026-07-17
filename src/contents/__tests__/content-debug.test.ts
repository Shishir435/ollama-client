import { afterEach, describe, expect, it, vi } from "vitest"
import {
  contentDebugError,
  contentDebugLog,
  isContentDebugEnabled
} from "../content-debug"

describe("content debug logging", () => {
  afterEach(() => {
    delete (window as unknown as { __OLLAMA_CLIENT_CONTENT_DEBUG__?: boolean })
      .__OLLAMA_CLIENT_CONTENT_DEBUG__
    vi.restoreAllMocks()
  })

  it("is disabled by default", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})

    contentDebugLog("hidden")

    expect(isContentDebugEnabled()).toBe(false)
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it("logs when the content debug flag is enabled", () => {
    ;(
      window as unknown as { __OLLAMA_CLIENT_CONTENT_DEBUG__?: boolean }
    ).__OLLAMA_CLIENT_CONTENT_DEBUG__ = true
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})

    contentDebugLog("visible", { ok: true })

    expect(isContentDebugEnabled()).toBe(true)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ContentDebug] visible"),
      { details: [{ ok: true }] }
    )
  })

  it("always reports manual helper failures through the redacted logger", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    contentDebugError(
      "Manual test failed with password='correct horse battery staple'",
      new Error("Bearer manual-test-secret")
    )

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
      "correct horse battery staple"
    )
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
      "manual-test-secret"
    )
  })
})
