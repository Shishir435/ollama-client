import { beforeEach, describe, expect, it, vi } from "vitest"

const override = vi.hoisted(() => ({ value: null as unknown }))
const provider = vi.hoisted(() => ({
  get: vi.fn()
}))

vi.mock("@/lib/providers/model-capability-overrides", () => ({
  getModelCapabilityOverride: vi.fn(async () => override.value)
}))
vi.mock("@/lib/providers/capability-probe", () => ({
  getCapabilityProbe: vi.fn(async () => null)
}))
vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: { getProviderForModel: provider.get }
}))

import { resolveContextLengthHint } from "../resolve-model-tools"

const lmStudio = {
  id: "lmstudio",
  capabilities: {},
  config: { id: "lmstudio", type: "lmstudio", baseUrl: "http://x:1234" }
}

describe("resolveContextLengthHint", () => {
  beforeEach(() => {
    override.value = null
    provider.get.mockReset()
    provider.get.mockResolvedValue(lmStudio)
  })

  it("reads the window the model's capabilities name", async () => {
    override.value = { contextLength: 8192 }

    await expect(resolveContextLengthHint("llama3", "lmstudio")).resolves.toBe(
      8192
    )
  })

  it("is unknown when the lookup fails, so the build keeps its fallback", async () => {
    provider.get.mockRejectedValue(new Error("catalog down"))

    await expect(
      resolveContextLengthHint("llama3", "lmstudio")
    ).resolves.toBeUndefined()
  })

  it("passes a stop through instead of reading it as unknown", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      resolveContextLengthHint("llama3", "lmstudio", controller.signal)
    ).rejects.toThrow()
  })
})
