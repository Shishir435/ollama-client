import { describe, expect, it } from "vitest"

import { resolveProviderBaseUrl } from "../base-url"
import { ProviderId, ProviderType } from "../types"

describe("resolveProviderBaseUrl", () => {
  it("normalizes configured URLs", () => {
    expect(
      resolveProviderBaseUrl({
        id: ProviderId.OLLAMA,
        name: "Ollama",
        type: ProviderType.OLLAMA,
        enabled: true,
        baseUrl: "  http://host:11434/// "
      })
    ).toBe("http://host:11434")
  })

  it.each([
    [ProviderId.OLLAMA, ProviderType.OLLAMA, "http://localhost:11434"],
    [ProviderId.LM_STUDIO, ProviderType.OPENAI, "http://localhost:1234/v1"],
    [ProviderId.LLAMA_CPP, ProviderType.OPENAI, "http://localhost:8000/v1"]
  ])("uses the declared default for %s", (id, type, expected) => {
    expect(
      resolveProviderBaseUrl({ id, name: id, type, enabled: true, baseUrl: "" })
    ).toBe(expected)
  })

  it("rejects a custom provider without a URL", () => {
    expect(() =>
      resolveProviderBaseUrl({
        id: "custom:openai:test",
        name: "Broken",
        type: ProviderType.OPENAI,
        enabled: true,
        baseUrl: ""
      })
    ).toThrow("has no base URL")
  })
})
