import { OpenAIProvider } from "./openai"
import { type ProviderConfig, ProviderId } from "./types"

export class LocalAIProvider extends OpenAIProvider {
  id = ProviderId.LOCALAI

  constructor(config: ProviderConfig) {
    super(config)
    this.capabilities = {
      ...this.capabilities,
      toolCalling: true
    }
  }
}
