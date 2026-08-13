import { describe, expect, it } from "vitest"
import {
  isProviderBrandId,
  PROVIDER_BRANDS,
  resolveProviderBrand
} from "../provider-brand"
import { ProviderId, ProviderServiceProfile } from "../types"

describe("resolveProviderBrand", () => {
  it("brands built-in providers from their id", () => {
    expect(resolveProviderBrand({ id: ProviderId.OLLAMA })).toBe("ollama")
    expect(resolveProviderBrand({ id: ProviderId.LM_STUDIO })).toBe("lm-studio")
  })

  it("leaves llama.cpp unbranded so it keeps its generic glyph", () => {
    expect(resolveProviderBrand({ id: ProviderId.LLAMA_CPP })).toBeUndefined()
  })

  it.each([
    ["https://api.openai.com/v1", "openai"],
    ["https://api.anthropic.com", "anthropic"],
    ["https://openrouter.ai/api/v1", "openrouter"],
    ["https://api.deepseek.com/v1", "deepseek"],
    ["https://open.bigmodel.cn/api/paas/v4", "zhipu"],
    ["https://api.z.ai/api/paas/v4", "zhipu"],
    ["https://api.moonshot.cn/v1", "moonshot"],
    ["https://api.mistral.ai/v1", "mistral"],
    ["https://api.groq.com/openai/v1", "groq"],
    ["https://api.together.xyz/v1", "together"],
    ["https://api.x.ai/v1", "xai"],
    ["https://generativelanguage.googleapis.com/v1beta/openai", "gemini"],
    ["https://api.perplexity.ai", "perplexity"],
    ["https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen"]
  ])("brands %s as %s", (baseUrl, brand) => {
    expect(
      resolveProviderBrand({ id: "custom:openai:abc", baseUrl, name: "My LLM" })
    ).toBe(brand)
  })

  /*
   * Every hosted vendor here is reached through an OpenAI-compatible profile,
   * so a profile-first order would put OpenAI's mark on all of them.
   */
  it("prefers the host over an OpenAI-compatible service profile", () => {
    expect(
      resolveProviderBrand({
        id: "custom:openai:abc",
        baseUrl: "https://api.deepseek.com/v1",
        serviceProfile: ProviderServiceProfile.OPENAI,
        name: "Work provider"
      })
    ).toBe("deepseek")
  })

  it("falls back to the service profile when the host is unknown", () => {
    expect(
      resolveProviderBrand({
        id: "custom:openai:abc",
        baseUrl: "https://llm.internal.example/v1",
        serviceProfile: ProviderServiceProfile.OPENROUTER,
        name: "Gateway"
      })
    ).toBe("openrouter")
  })

  it("falls back to the display name for self-hosted servers", () => {
    expect(
      resolveProviderBrand({
        id: "custom:openai:abc",
        baseUrl: "http://localhost:8000/v1",
        name: "vLLM box"
      })
    ).toBe("vllm")
  })

  it("returns nothing for an unrecognized provider", () => {
    expect(
      resolveProviderBrand({
        id: "custom:openai:abc",
        baseUrl: "http://192.168.1.10:1234/v1",
        name: "Home server"
      })
    ).toBeUndefined()
  })

  it("survives a malformed base URL", () => {
    expect(
      resolveProviderBrand({ id: "custom:openai:abc", baseUrl: "not a url" })
    ).toBeUndefined()
  })

  it("accepts a base URL with no scheme", () => {
    expect(
      resolveProviderBrand({
        id: "custom:openai:abc",
        baseUrl: "api.groq.com/openai/v1"
      })
    ).toBe("groq")
  })

  it("does not brand a host that merely ends in a vendor string", () => {
    expect(
      resolveProviderBrand({
        id: "custom:openai:abc",
        baseUrl: "https://notopenai.com/v1"
      })
    ).toBeUndefined()
  })
})

describe("isProviderBrandId", () => {
  it("accepts every declared brand", () => {
    for (const brand of PROVIDER_BRANDS) {
      expect(isProviderBrandId(brand)).toBe(true)
    }
  })

  it("rejects unknown and empty values", () => {
    expect(isProviderBrandId("cohere")).toBe(false)
    expect(isProviderBrandId(undefined)).toBe(false)
  })
})
