import { OpenAICompatibleProvider } from "./openai-compatible"
import { type ProviderConfig, ProviderId } from "./types"

export class VllmProvider extends OpenAICompatibleProvider {
  id = ProviderId.VLLM

  constructor(config: ProviderConfig) {
    super(config)
    this.capabilities = {
      ...this.capabilities,
      toolCalling: true
    }
  }
}
