import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProviderManager } from "@/lib/providers/manager"
import { getOllamaBaseUrl } from "../ollama-base-url"

vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: {
    getProviderConfig: vi.fn()
  }
}))

describe("getOllamaBaseUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the normalized configured URL", async () => {
    vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
      id: "ollama",
      name: "Ollama",
      type: "ollama",
      enabled: true,
      baseUrl: "http://custom:11434/"
    } as never)

    await expect(getOllamaBaseUrl()).resolves.toBe("http://custom:11434")
  })

  it("uses the default URL for an empty configured URL", async () => {
    vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue({
      id: "ollama",
      name: "Ollama",
      type: "ollama",
      enabled: true,
      baseUrl: ""
    } as never)

    await expect(getOllamaBaseUrl()).resolves.toBe("http://localhost:11434")
  })

  it("rejects a missing canonical provider config", async () => {
    vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue(undefined)
    await expect(getOllamaBaseUrl()).rejects.toThrow(
      "Ollama provider configuration is missing"
    )
  })
})
