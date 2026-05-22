import { OpenAIProvider } from "./openai"
import { type ProviderConfig, ProviderId } from "./types"

export class VllmProvider extends OpenAIProvider {
  id = ProviderId.VLLM

  constructor(config: ProviderConfig) {
    super(config)
    this.capabilities = {
      ...this.capabilities,
      toolCalling: true
    }
  }
}
