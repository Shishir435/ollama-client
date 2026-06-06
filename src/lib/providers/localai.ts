import { OpenAICompatibleProvider } from "./openai-compatible"
import { type ProviderConfig, ProviderId } from "./types"

export class LocalAIProvider extends OpenAICompatibleProvider {
  id = ProviderId.LOCALAI

  constructor(config: ProviderConfig) {
    super(config)
    this.capabilities = {
      ...this.capabilities,
      toolCalling: true
    }
  }
}
