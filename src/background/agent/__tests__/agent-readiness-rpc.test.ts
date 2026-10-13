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
      getAgentReadiness({ providerId: "ollama", modelId: "qwen3" }, undefined, {
        disclose
      })
    ).resolves.toEqual({ readiness, qualified: false })
    expect(disclose).toHaveBeenCalledWith(
      "ollama",
      "qwen3",
      {},
      { readOnly: true }
    )
  })

  it("reads without recording and passes the caller's cancellation on", async () => {
    const disclose = vi.fn(async () => undefined)
    const controller = new AbortController()
    await getAgentReadiness(
      { providerId: "ollama", modelId: "qwen3" },
      controller.signal,
      { disclose }
    )
    expect(disclose).toHaveBeenCalledWith(
      "ollama",
      "qwen3",
      {},
      { readOnly: true, signal: controller.signal }
    )
  })

  it("stops once the caller has cancelled", async () => {
    const controller = new AbortController()
    const disclose = vi.fn(async () => {
      controller.abort()
      return undefined
    })
    await expect(
      getAgentReadiness(
        { providerId: "ollama", modelId: "qwen3" },
        controller.signal,
        { disclose }
      )
    ).rejects.toBeDefined()
  })

  it("names no readiness for a provider that is not configured", async () => {
    await expect(
      getAgentReadiness({ providerId: "gone", modelId: "qwen3" }, undefined, {
        disclose: async () => undefined
      })
    ).resolves.toEqual({ qualified: false })
  })
})
