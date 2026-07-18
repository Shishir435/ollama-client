import { beforeEach, describe, expect, it, vi } from "vitest"

const listModels = vi.hoisted(() => vi.fn())

vi.mock("@/lib/providers/provider-rpc-service", () => ({
  ProviderRpcService: { listModels }
}))

import { handleGetModels } from "../handle-get-models"

describe("handleGetModels legacy adapter", () => {
  beforeEach(() => {
    listModels.mockResolvedValue({
      models: [{ name: "llama3", model: "llama3" }],
      failures: []
    })
  })

  it("delegates the legacy message to the provider RPC service", async () => {
    const sendResponse = vi.fn()

    await handleGetModels(sendResponse)

    expect(listModels).toHaveBeenCalledWith({
      providerId: "ollama",
      enabledOnly: false
    })
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      data: { models: [{ name: "llama3", model: "llama3" }] }
    })
  })

  it("preserves the legacy error envelope", async () => {
    listModels.mockRejectedValue(new Error("Provider unavailable"))
    const sendResponse = vi.fn()

    await expect(handleGetModels(sendResponse)).resolves.not.toThrow()

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { status: 0, message: "Provider unavailable" }
    })
  })
})
