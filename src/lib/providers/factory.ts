import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
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
    if (!config) throw new Error(`Provider ${providerId} not found`)

    let provider: LLMProvider

    switch (config.type) {
      case ProviderType.OLLAMA:
        provider = new OllamaProvider(config)
        break
      case ProviderType.OPENAI:
        if (config.id === ProviderId.LM_STUDIO) {
          provider = new LMStudioProvider(config)
        } else if (config.id === ProviderId.LLAMA_CPP) {
          provider = new LlamaCppProvider(config)
        } else if (config.id === ProviderId.VLLM) {
          provider = new VllmProvider(config)
        } else if (config.id === ProviderId.LOCALAI) {
          provider = new LocalAIProvider(config)
        } else if (config.id === ProviderId.KOBOLDCPP) {
          provider = new KoboldCppProvider(config)
        } else {
          provider = new OpenAIProvider(config)
        }
        break
      default:
        throw new Error(`Unsupported provider type: ${config.type}`)
    }

    instances.set(providerId, provider)
    return provider
  },

  async getProviderWithConfig(config: ProviderConfig): Promise<LLMProvider> {
    switch (config.type) {
      case ProviderType.OLLAMA:
        return new OllamaProvider(config)
      case ProviderType.OPENAI:
        if (config.id === ProviderId.LM_STUDIO) {
          return new LMStudioProvider(config)
        } else if (config.id === ProviderId.LLAMA_CPP) {
          return new LlamaCppProvider(config)
        } else if (config.id === ProviderId.VLLM) {
          return new VllmProvider(config)
        } else if (config.id === ProviderId.LOCALAI) {
          return new LocalAIProvider(config)
        } else if (config.id === ProviderId.KOBOLDCPP) {
          return new KoboldCppProvider(config)
        } else {
          return new OpenAIProvider(config)
        }
      default:
        throw new Error(`Unsupported provider type: ${config.type}`)
    }
  }
}
