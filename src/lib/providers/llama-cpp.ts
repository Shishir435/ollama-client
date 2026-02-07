import { OpenAIProvider } from "./openai"
import { ProviderId } from "./types"

/**
 * Specialized provider for llama.cpp hybrid response format.
 */
export class LlamaCppProvider extends OpenAIProvider {
  id = ProviderId.LLAMA_CPP

  async getModels(): Promise<string[]> {
    const baseUrl = this.config.baseUrl || "http://localhost:8080/v1"
    try {
      const response = await fetch(`${baseUrl}/models`)
      if (!response.ok) return []

      const json = await response.json()
      let models: string[] = []

      if (Array.isArray(json.data)) {
        models = (json.data as { id?: string; name?: string }[]).map(
          (m) => m.id || m.name || ""
        )
      } else if (Array.isArray(json.models)) {
        models = (
          json.models as { name?: string; model?: string; id?: string }[]
        ).map((m) => m.name || m.model || m.id || "")
      }

      return models
    } catch (e) {
      console.error("[LlamaCpp] Model fetch failed", e)
      return []
    }
  }
}
