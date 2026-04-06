import { OpenAIProvider } from "./openai"
import { ProviderId } from "./types"

export class LocalAIProvider extends OpenAIProvider {
  id = ProviderId.LOCALAI
  override capabilities = {
    ...this.capabilities,
    toolCalling: true
  }
}
