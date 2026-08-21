import { describe, expect, it } from "vitest"
import {
  anthropicSupportsAdaptiveThinking,
  buildOpenAIReasoningFields,
  isReasoningEffortActive,
  resolveReasoningEffortSupport,
  toOllamaThink
} from "../reasoning-effort"
import {
  type ProviderConfig,
  ProviderServiceProfile,
  ProviderType
} from "../types"

const config = (
  baseUrl: string,
  serviceProfile?: ProviderServiceProfile
): ProviderConfig => ({
  id: "custom:openai:test",
  type: ProviderType.OPENAI,
  enabled: true,
  name: "Test",
  baseUrl,
  ...(serviceProfile ? { serviceProfile } : {})
})

describe("reasoning effort capability resolution", () => {
  it("prefers exact OpenRouter model metadata", () => {
    expect(
      resolveReasoningEffortSupport(
        config(
          "https://openrouter.ai/api/v1",
          ProviderServiceProfile.OPENROUTER
        ),
        "vendor/model",
        {
          supportedEfforts: ["low", "high"],
          defaultEffort: "low",
          defaultEnabled: true,
          mandatory: true
        }
      )
    ).toEqual({
      supportedEfforts: ["low", "high"],
      canEnable: true,
      canDisable: false,
      mandatory: true,
      defaultEffort: "low",
      defaultEnabled: true,
      source: "model-metadata"
    })
  })

  it("treats null OpenRouter efforts as the full gateway vocabulary", () => {
    expect(
      resolveReasoningEffortSupport(
        config("https://openrouter.ai/api/v1"),
        "vendor/model",
        { supportedEfforts: null }
      )?.supportedEfforts
    ).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"])
  })

  it("does not invent levels when catalog reasoning metadata omits them", () => {
    expect(
      resolveReasoningEffortSupport(
        config("https://openrouter.ai/api/v1"),
        "vendor/model",
        {}
      )?.supportedEfforts
    ).toEqual([])
  })

  it("uses documented OpenAI family profiles when the catalog has no capabilities", () => {
    expect(
      resolveReasoningEffortSupport(
        config("https://api.openai.com/v1"),
        "gpt-5.6-terra"
      )
    ).toMatchObject({
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      canDisable: true,
      source: "provider-profile"
    })
  })

  it("does not mistake ChatGPT aliases for configurable API reasoning models", () => {
    expect(
      resolveReasoningEffortSupport(
        config("https://api.openai.com/v1"),
        "gpt-5.2-chat-latest"
      )
    ).toBeUndefined()
  })

  it("models DeepSeek and Z.ai controls without inventing shared levels", () => {
    expect(
      resolveReasoningEffortSupport(
        config("https://api.deepseek.com"),
        "deepseek-v4-pro"
      )
    ).toMatchObject({ supportedEfforts: ["high", "max"], canDisable: true })
    expect(
      resolveReasoningEffortSupport(
        config("https://api.z.ai/api/paas/v4"),
        "glm-5.1"
      )
    ).toMatchObject({
      supportedEfforts: [],
      canEnable: true,
      canDisable: true
    })
  })

  it("limits ZenMux profiles to gateway-documented effort values", () => {
    expect(
      resolveReasoningEffortSupport(
        config("https://zenmux.ai/api/v1"),
        "openai/gpt-5.6"
      )
    ).toMatchObject({
      supportedEfforts: ["low", "medium", "high"],
      canEnable: true,
      canDisable: true
    })
  })

  it("recognizes the documented Anthropic Mythos Preview profile", () => {
    expect(
      resolveReasoningEffortSupport(
        config("https://api.anthropic.com/v1"),
        "claude-mythos-preview"
      )
    ).toMatchObject({
      supportedEfforts: ["low", "medium", "high", "max"]
    })
    expect(anthropicSupportsAdaptiveThinking("claude-mythos-preview")).toBe(
      true
    )
  })
})

describe("reasoning effort request mapping", () => {
  it("uses each provider's documented OpenAI-compatible request shape", () => {
    expect(
      buildOpenAIReasoningFields(config("https://api.openai.com/v1"), "xhigh")
    ).toEqual({ reasoning_effort: "xhigh" })
    expect(
      buildOpenAIReasoningFields(config("https://openrouter.ai/api/v1"), "max")
    ).toEqual({ reasoning: { effort: "max" } })
    expect(
      buildOpenAIReasoningFields(config("https://api.deepseek.com"), "max")
    ).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "max"
    })
    expect(
      buildOpenAIReasoningFields(config("https://api.together.xyz/v1"), "none")
    ).toEqual({ reasoning: { enabled: false } })
    expect(
      buildOpenAIReasoningFields(
        config("https://api.z.ai/api/paas/v4"),
        "enabled"
      )
    ).toEqual({ thinking: { type: "enabled" } })
  })

  it("keeps Auto absent and maps unsupported Ollama aliases conservatively", () => {
    expect(
      buildOpenAIReasoningFields(config("https://api.openai.com/v1"), "auto")
    ).toEqual({})
    expect(toOllamaThink("minimal")).toBe("low")
    expect(toOllamaThink("xhigh")).toBe("high")
  })

  it("uses documented defaults to identify active Auto reasoning", () => {
    expect(
      isReasoningEffortActive(
        "auto",
        config("https://api.openai.com/v1"),
        "gpt-5.6-terra"
      )
    ).toBe(true)
    expect(
      isReasoningEffortActive(
        "auto",
        config("https://api.openai.com/v1"),
        "gpt-5.2"
      )
    ).toBe(false)
  })
})
