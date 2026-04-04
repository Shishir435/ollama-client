import type { ProviderModel } from "@/types"
import { OpenAIProvider } from "./openai"
import type { EmbeddingSupport } from "./types"
import { ProviderId } from "./types"

/**
 * Specialized provider for LM Studio specific metadata.
 */
export class LMStudioProvider extends OpenAIProvider {
  id = ProviderId.LM_STUDIO
  override capabilities = {
    ...this.capabilities,
    modelPull: true,
    modelUnload: true,
    providerVersion: false
  }

  async getEmbeddingSupport(): Promise<EmbeddingSupport> {
    return {
      supported: true,
      mode: "openai-compatible",
      notes:
        "Depends on loaded model and server compatibility with /v1/embeddings."
    }
  }

  async getModels(): Promise<ProviderModel[]> {
    const baseUrl = this.config.baseUrl || "http://localhost:1234/v1"
    try {
      // LM Studio's new API is at /api/v0/models, outside of /v1
      const apiBase = baseUrl.replace(/\/v1\/?$/, "")
      const response = await fetch(`${apiBase}/api/v0/models`)

      if (!response.ok) return super.getModels()

      const json = await response.json()
      const data = json.data as Array<{
        id: string
        object: string
        type: string
        publisher: string
        arch: string
        quantization?: string
        max_context_length?: number
      }>

      return data.map((m) => ({
        name: m.id,
        model: m.id,
        modified_at: new Date().toISOString(),
        size: 0, // Not provided by this endpoint
        digest: m.id,
        details: {
          parent_model: "",
          format: "gguf", // LM Studio mostly uses GGUF
          family: m.arch || "lm-studio",
          families: [],
          parameter_size: m.max_context_length
            ? `${Math.round(m.max_context_length / 1024)}k`
            : "",
          quantization_level: m.quantization || ""
        }
      }))
    } catch (_e) {
      console.warn(
        "LMStudio /api/v0/models failed, falling back to openai compat",
        _e
      )
      return super.getModels()
    }
  }
}
