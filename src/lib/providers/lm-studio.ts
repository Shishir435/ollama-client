import { OpenAIProvider } from "./openai"
import { ProviderId } from "./types"

/**
 * Specialized provider for LM Studio specific metadata.
 */
export class LMStudioProvider extends OpenAIProvider {
  id = ProviderId.LM_STUDIO

  async getModels(): Promise<string[]> {
    const baseUrl = this.config.baseUrl || "http://localhost:1234/v1"
    try {
      const response = await fetch(
        `${baseUrl.replace("/v1", "")}/api/v1/models`
      )
      if (!response.ok) return super.getModels()
      const data = await response.json()
      return (data.models as { key: string }[])?.map((m) => m.key) || []
    } catch (_e) {
      return super.getModels()
    }
  }
}
