import { OpenAIProvider } from "./openai"
import { ProviderId } from "./types"

export class KoboldCppProvider extends OpenAIProvider {
  id = ProviderId.KOBOLDCPP
  override capabilities = {
    ...this.capabilities,
    toolCalling: true
  }
}
