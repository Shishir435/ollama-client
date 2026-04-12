import type { ProviderConfig } from "../types"
import type { ProviderClient } from "./base"
import { LlamaCppProvider } from "./llama-cpp"
import { LMStudioProvider } from "./lm-studio"
import { OllamaProvider } from "./ollama"
import { OpenAICompatibleProvider } from "./openai-compatible"

export const createProviderClient = (
  config: ProviderConfig
): ProviderClient => {
  if (config.type === "ollama") {
    return new OllamaProvider(config)
  }

  if (config.id === "lm-studio") {
    return new LMStudioProvider(config)
  }

  if (config.id === "llama-cpp") {
    return new LlamaCppProvider(config)
  }

  return new OpenAICompatibleProvider(config)
}
