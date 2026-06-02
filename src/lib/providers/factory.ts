import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { KoboldCppProvider } from "./koboldcpp"
import { LlamaCppProvider } from "./llama-cpp"
import { LMStudioProvider } from "./lm-studio"
import { LocalAIProvider } from "./localai"
import { ProviderManager } from "./manager"
import { OllamaProvider } from "./ollama"
import { OpenAIProvider } from "./openai"
import {
  type LLMProvider,
  type ProviderConfig,
  ProviderId,
  ProviderType
} from "./types"
import { VllmProvider } from "./vllm"

type ProviderConstructor = new (config: ProviderConfig) => LLMProvider

// Subclasses of OpenAIProvider, keyed by ProviderId. Anything not in this map
// uses plain OpenAIProvider.
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
    case ProviderType.OPENAI: {
      const Ctor = OPENAI_COMPAT_CONSTRUCTORS[config.id] ?? OpenAIProvider
      return new Ctor(config)
    }
    default:
      throw createAppError(`Unsupported provider type: ${config.type}`, {
        kind: "validation"
      })
  }
}

const instances: Map<string, LLMProvider> = new Map()

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

    const provider = instantiate(config)
    instances.set(providerId, provider)
    return provider
  },

  async getProviderWithConfig(config: ProviderConfig): Promise<LLMProvider> {
    return instantiate(config)
  }
}
