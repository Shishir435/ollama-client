import { LlamaCppProvider } from "./llama-cpp"
import { LMStudioProvider } from "./lm-studio"
import { ProviderManager } from "./manager"
import { OllamaProvider } from "./ollama"
import { OpenAIProvider } from "./openai"
import {
  type LLMProvider,
  type ProviderConfig,
  ProviderId,
  ProviderType
} from "./types"

const instances: Map<string, LLMProvider> = new Map()

export const ProviderFactory = {
  async getProviderForModel(modelId: string): Promise<LLMProvider> {
    const mapping = await ProviderManager.getModelMapping(modelId)
    if (mapping) {
      return ProviderFactory.getProvider(mapping.providerId)
    }
    return ProviderFactory.getProvider(ProviderId.OLLAMA)
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
        } else {
          return new OpenAIProvider(config)
        }
      default:
        throw new Error(`Unsupported provider type: ${config.type}`)
    }
  }
}
