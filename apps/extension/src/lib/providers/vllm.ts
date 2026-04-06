import { OpenAIProvider } from "./openai"
import { ProviderId } from "./types"

export class VllmProvider extends OpenAIProvider {
  id = ProviderId.VLLM
  override capabilities = {
    ...this.capabilities,
    toolCalling: true
  }
}
