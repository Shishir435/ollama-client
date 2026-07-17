import {
  type OpenAIOutputTokenField,
  type ProviderConfig,
  ProviderId,
  ProviderServiceProfile,
  ProviderType
} from "./types"

export interface OpenAIServiceCompatibility {
  extraHeaders: Record<string, string>
  maxTokensField: OpenAIOutputTokenField
  sendStreamOptions: boolean
}

const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://www.ollamaclient.in",
  "X-OpenRouter-Title": "Ollama Client"
}

const STREAM_USAGE_PROVIDER_IDS = new Set<string>([
  ProviderId.LM_STUDIO,
  ProviderId.LLAMA_CPP,
  ProviderId.VLLM,
  ProviderId.LOCALAI,
  ProviderId.KOBOLDCPP
])

export const resolveProviderServiceProfile = (
  config: ProviderConfig
): ProviderServiceProfile => {
  if (config.serviceProfile) return config.serviceProfile

  if (config.type === ProviderType.ANTHROPIC) {
    try {
      if (new URL(config.baseUrl || "").hostname === "api.anthropic.com") {
        return ProviderServiceProfile.ANTHROPIC
      }
    } catch {
      // Invalid URLs are rejected when configs are created or edited.
    }
  }

  return ProviderServiceProfile.GENERIC
}

export const getOpenAIServiceCompatibility = (
  config: ProviderConfig
): OpenAIServiceCompatibility => {
  const profile = resolveProviderServiceProfile(config)
  return {
    extraHeaders:
      profile === ProviderServiceProfile.OPENROUTER ? OPENROUTER_HEADERS : {},
    maxTokensField: config.compatibility?.maxTokensField ?? "max_tokens",
    sendStreamOptions:
      config.compatibility?.sendStreamOptions === "always" ||
      (config.compatibility?.sendStreamOptions === undefined &&
        (profile === ProviderServiceProfile.OPENROUTER ||
          STREAM_USAGE_PROVIDER_IDS.has(String(config.id))))
  }
}

export const providerProfileRequiresApiKey = (
  profile: ProviderServiceProfile | undefined
): boolean =>
  profile === ProviderServiceProfile.ANTHROPIC ||
  profile === ProviderServiceProfile.OPENROUTER
