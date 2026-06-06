import { OpenAICompatibleProvider } from "./openai-compatible"
import { type ProviderConfig, ProviderId } from "./types"

export class KoboldCppProvider extends OpenAICompatibleProvider {
  id = ProviderId.KOBOLDCPP

  constructor(config: ProviderConfig) {
    super(config)
    this.capabilities = {
      ...this.capabilities,
      toolCalling: true
    }
  }
}
