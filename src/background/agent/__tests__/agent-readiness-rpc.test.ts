import { describe, expect, it, vi } from "vitest"
import { getAgentReadiness } from "../agent-readiness-rpc"

const readiness = {
  status: "ready",
  reason: "metadata",
  vision: "supported"
} as const

describe("getAgentReadiness", () => {
  it("returns the disclosure's readiness for the named model", async () => {
    const disclose = vi.fn(async () => ({
      name: "Ollama",
      model: "qwen3",
      location: "local" as const,
      readiness
    }))
    await expect(
      getAgentReadiness(
        { providerId: "ollama", modelId: "qwen3" },
        { disclose }
      )
    ).resolves.toEqual({ readiness, qualified: false })
    expect(disclose).toHaveBeenCalledWith("ollama", "qwen3")
  })

  it("names no readiness for a provider that is not configured", async () => {
    await expect(
      getAgentReadiness(
        { providerId: "gone", modelId: "qwen3" },
        { disclose: async () => undefined }
      )
    ).resolves.toEqual({ qualified: false })
  })
})
