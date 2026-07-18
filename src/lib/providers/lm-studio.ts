import { logger } from "@/lib/logger"
import type { ProviderModel } from "@/types"
import { resolveProviderBaseUrl } from "./base-url"
import { OpenAICompatibleProvider } from "./openai-compatible"
import { type EmbeddingSupport, type ProviderConfig, ProviderId } from "./types"

/**
 * Specialized provider for LM Studio specific metadata.
 */
export class LMStudioProvider extends OpenAICompatibleProvider {
  id = ProviderId.LM_STUDIO

  constructor(config: ProviderConfig) {
    super(config)
    this.capabilities = {
      ...this.capabilities,
      modelPull: true,
      modelUnload: true,
      providerVersion: false,
      toolCalling: true
    }
  }

  async getEmbeddingSupport(): Promise<EmbeddingSupport> {
    return {
      supported: true,
      mode: "openai-compatible",
      notes:
        "Depends on loaded model and server compatibility with /v1/embeddings."
    }
  }

  async getModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    try {
      // LM Studio's new API is at /api/v0/models, outside of /v1
      const apiBase = baseUrl.replace(/\/v1\/?$/, "")
      const response = await fetch(
        `${apiBase}/api/v0/models`,
        signal ? { signal } : undefined
      )

      if (!response.ok) return super.getModels(signal)

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
        },
        // Surface LM Studio's model type ("llm"/"vlm"/"embeddings") so vision
        // and embedding capability can be detected without a manual override.
        capabilityHints: {
          modelType: m.type,
          contextLength: m.max_context_length
        }
      }))
    } catch (_e) {
      if (signal?.aborted) throw _e
      logger.warn(
        "/api/v0/models failed, falling back to openai compat",
        "LMStudio",
        { error: _e }
      )
      return super.getModels(signal)
    }
  }
}
