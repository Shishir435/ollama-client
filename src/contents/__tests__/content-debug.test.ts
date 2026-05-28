import { afterEach, describe, expect, it, vi } from "vitest"
import { contentDebugLog, isContentDebugEnabled } from "../content-debug"

describe("content debug logging", () => {
  afterEach(() => {
    delete (window as unknown as { __OLLAMA_CLIENT_CONTENT_DEBUG__?: boolean })
      .__OLLAMA_CLIENT_CONTENT_DEBUG__
    vi.restoreAllMocks()
  })

  it("is disabled by default", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    contentDebugLog("hidden")

    expect(isContentDebugEnabled()).toBe(false)
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it("logs when the content debug flag is enabled", () => {
    ;(
      window as unknown as { __OLLAMA_CLIENT_CONTENT_DEBUG__?: boolean }
    ).__OLLAMA_CLIENT_CONTENT_DEBUG__ = true
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    contentDebugLog("visible", { ok: true })

    expect(isContentDebugEnabled()).toBe(true)
    expect(consoleSpy).toHaveBeenCalledWith("visible", { ok: true })
  })
})
