import { describe, expect, it } from "vitest"
import {
  isProviderBrandId,
  PROVIDER_BRANDS,
  resolveModelBrand,
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
    ["https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen"],
    ["https://integrate.api.nvidia.com/v1", "nvidia"],
    ["https://ai-gateway.vercel.sh/v1", "vercel"],
    [
      "https://gateway.ai.cloudflare.com/v1/03835d22db2028fe5884b145e7f7ebd2/default/openai",
      "cloudflare"
    ],
    ["https://api.fireworks.ai/inference/v1", "fireworks"],
    ["https://api.deepinfra.com/v1/openai", "deepinfra"],
    ["https://router.huggingface.co/v1", "huggingface"],
    ["https://api.cerebras.ai/v1", "cerebras"]
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

  it("does not brand a platform that hosts other people's deployments", () => {
    /**
     * `vercel.app` and `workers.dev` are anyone's app. A gateway a user
     * deployed there is theirs, not Vercel's or Cloudflare's.
     */
    for (const baseUrl of [
      "https://my-router.vercel.app/v1",
      "https://my-router.acme.workers.dev/v1"
    ]) {
      expect(
        resolveProviderBrand({ id: "custom:openai:abc", baseUrl, name: "Mine" })
      ).toBeUndefined()
    }
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

describe("Apple's on-device model", () => {
  /** olc serves it as `apple/foundation` on loopback, where no host says whose it is. */
  it("wears Apple's mark on its model row and on a provider named for it", () => {
    expect(resolveModelBrand("apple/foundation")).toBe("apple")
    expect(
      resolveProviderBrand({
        id: "custom:openai:fm",
        baseUrl: "http://127.0.0.1:8085/v1",
        name: "Apple Foundation"
      })
    ).toBe("apple")
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

describe("a provider named for a vendor's product", () => {
  it("wears that vendor's mark", () => {
    /*
     * The left rail of the model menu is provider marks, resolved from the
     * provider's own configuration. A loopback proxy has no host to read and
     * no favicon to fetch, so the name the user gave it is the only signal
     * left — and a provider called Codex sat there as a generic glyph beside
     * the OpenAI-marked models it serves.
     */
    expect(resolveProviderBrand({ name: "Codex" })).toBe("openai")
  })
})

describe("resolveModelBrand", () => {
  it("reads the vendor a model id states for itself", () => {
    expect(resolveModelBrand("anthropic/claude-3")).toBe("anthropic")
    expect(resolveModelBrand("deepseek/deepseek-chat")).toBe("deepseek")
    /* Codex is OpenAI's, and an olc proxy names the runtime it reaches. */
    expect(resolveModelBrand("codex/gpt-5.6-luna")).toBe("openai")
  })

  it("claims nothing for a namespace with no mark of its own", () => {
    /*
     * Falling back is the point: a namespace we do not recognise keeps the
     * generic glyph rather than borrowing a vendor's logo.
     */
    expect(resolveModelBrand("opencode/muse-spark")).toBeUndefined()
    expect(resolveModelBrand("hf.co/user/model")).toBeUndefined()
  })

  it("claims nothing for an id that names no vendor", () => {
    expect(resolveModelBrand("qwen3:8b")).toBeUndefined()
    expect(resolveModelBrand("/leading-slash")).toBeUndefined()
    expect(resolveModelBrand(undefined)).toBeUndefined()
  })
})
