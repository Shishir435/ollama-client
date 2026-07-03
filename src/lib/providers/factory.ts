import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { AnthropicProvider } from "./anthropic"
import { KoboldCppProvider } from "./koboldcpp"
import { LlamaCppProvider } from "./llama-cpp"
import { LMStudioProvider } from "./lm-studio"
import { LocalAIProvider } from "./localai"
import { ProviderManager } from "./manager"
import { OllamaProvider } from "./ollama"
import { OpenAICompatibleProvider } from "./openai-compatible"
import {
  type LLMProvider,
  type ProviderConfig,
  ProviderId,
  ProviderType
} from "./types"
import { VllmProvider } from "./vllm"

type ProviderConstructor = new (config: ProviderConfig) => LLMProvider

// Subclasses of the shared OpenAI-compatible base, keyed by ProviderId.
// Anything not in this map uses the plain OpenAI-compatible provider.
const OPENAI_COMPAT_CONSTRUCTORS: Record<string, ProviderConstructor> = {
  [ProviderId.LM_STUDIO]: LMStudioProvider,
  [ProviderId.LLAMA_CPP]: LlamaCppProvider,
  [ProviderId.VLLM]: VllmProvider,
  [ProviderId.LOCALAI]: LocalAIProvider,
  [ProviderId.KOBOLDCPP]: KoboldCppProvider
}

function instantiate(config: ProviderConfig): LLMProvider {
  switch (config.type) {
    case ProviderType.OLLAMA:
      return new OllamaProvider(config)
    case ProviderType.ANTHROPIC:
      return new AnthropicProvider(config)
    case ProviderType.OPENAI: {
      const Ctor =
        OPENAI_COMPAT_CONSTRUCTORS[config.id] ?? OpenAICompatibleProvider
      return new Ctor(config)
    }
    default:
      throw createAppError(`Unsupported provider type: ${config.type}`, {
        kind: "validation"
      })
  }
}

export const ProviderFactory = {
  async getProviderForModel(
    modelId: string,
    preferredProviderId?: string
  ): Promise<LLMProvider> {
    if (preferredProviderId) {
      return ProviderFactory.getProvider(preferredProviderId)
    }

    const mapping = await ProviderManager.getModelMapping(modelId)
    if (mapping) {
      return ProviderFactory.getProvider(mapping.providerId)
    }
    return ProviderFactory.getProvider(DEFAULT_PROVIDER_ID)
  },

  async getProvider(providerId: string): Promise<LLMProvider> {
    const config = await ProviderManager.getProviderConfig(providerId)
    if (!config) {
      throw createAppError(`Provider ${providerId} not found`, {
        kind: "provider",
        providerId
      })
    }

    return instantiate(config)
  },

  async getProviderWithConfig(config: ProviderConfig): Promise<LLMProvider> {
    return instantiate(config)
  }
}
