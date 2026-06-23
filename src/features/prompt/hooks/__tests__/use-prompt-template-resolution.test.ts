import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { usePromptTemplateResolution } from "../use-prompt-template-resolution"

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn()
  }
}))

const template = {
  id: "template-1",
  title: "Clipboard",
  userPrompt: "Use {{clipboard}}",
  createdAt: new Date(),
  usageCount: 0
}

describe("usePromptTemplateResolution", () => {
  it("preserves clipboard token when clipboard read fails", async () => {
    vi.spyOn(navigator.clipboard, "readText").mockRejectedValueOnce(
      new Error("Denied")
    )

    const { result } = renderHook(() => usePromptTemplateResolution())
    let resolved = ""

    await act(async () => {
      resolved = await result.current.resolveTemplatePrompt(template)
    })

    expect(resolved).toBe("Use {{clipboard}}")
  })
})
