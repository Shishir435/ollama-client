import { describe, expect, it } from "vitest"
import {
  parseStoredProviderConfigs,
  validateProviderConfigs
} from "../provider-config-schema"
import { ProviderType } from "../types"

const provider = {
  id: "custom:openai:test",
  type: ProviderType.OPENAI,
  enabled: true,
  name: "Test provider"
}

describe("provider config storage schemas", () => {
  it("recovers optional fields and preserves future fields", () => {
    const result = parseStoredProviderConfigs([
      {
        ...provider,
        baseUrl: 42,
        customModels: "model",
        futureOption: { enabled: true }
      }
    ])

    expect(result).toMatchObject({ rejected: 0, normalized: true })
    expect(result.providers).toEqual([
      {
        ...provider,
        futureOption: { enabled: true }
      }
    ])
  })

  it("rejects entries with invalid identity fields", () => {
    const result = parseStoredProviderConfigs([
      provider,
      { ...provider, id: "", name: 42 },
      null
    ])

    expect(result.providers).toEqual([provider])
    expect(result.rejected).toBe(2)
  })

  it("rejects malformed provider writes", () => {
    expect(() =>
      validateProviderConfigs([{ ...provider, enabled: "yes" }])
    ).toThrow(/Provider configuration is invalid/)
  })
})
