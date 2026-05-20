import { OpenAIProvider } from "./openai"
import { type ProviderConfig, ProviderId } from "./types"

export class KoboldCppProvider extends OpenAIProvider {
  id = ProviderId.KOBOLDCPP

  constructor(config: ProviderConfig) {
    super(config)
    this.capabilities = {
      ...this.capabilities,
      toolCalling: true
    }
  }
}
