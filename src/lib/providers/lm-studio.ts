import { z } from "zod"
import { logger } from "@/lib/logger"
import type { ProviderModel } from "@/types"
import { resolveProviderBaseUrl } from "./base-url"
import { parameterSizeFromModelId } from "./model-id-metadata"
import {
  lifecycleRequestFailed,
  lmStudioApiRoot,
  normalizeLmStudioLoadedModel
} from "./model-lifecycle"
import { OpenAICompatibleProvider } from "./openai-compatible"
import { decodeProviderJson } from "./response-decoding"
import { type EmbeddingSupport, type ProviderConfig, ProviderId } from "./types"

const OptionalString = z.string().optional().catch(undefined)
const LMStudioModelCatalogSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().min(1),
          type: OptionalString,
          arch: OptionalString,
          quantization: OptionalString,
          max_context_length: z.number().positive().optional().catch(undefined),
          capabilities: z.array(z.string()).optional().catch(undefined)
        })
        .passthrough()
    )
  })
  .passthrough()

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

  modelLifecycle = {
    listLoadedModels: async (signal?: AbortSignal) => {
      const response = await fetch(
        `${lmStudioApiRoot(resolveProviderBaseUrl(this.config))}/api/v1/models`,
        signal ? { signal } : undefined
      )
      if (!response.ok) {
        throw lifecycleRequestFailed("loaded model list", response, this.id)
      }
      const data = await response.json()
      const models = Array.isArray(data?.data) ? data.data : []
      return models.map(normalizeLmStudioLoadedModel)
    },
    unloadModel: async (model: string, signal?: AbortSignal) => {
      const response = await fetch(
        `${lmStudioApiRoot(resolveProviderBaseUrl(this.config))}/api/v1/models/unload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
          signal
        }
      )
      if (!response.ok) {
        throw lifecycleRequestFailed("unload", response, this.id)
      }
      return true
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

      const { data } = await decodeProviderJson(
        response,
        LMStudioModelCatalogSchema,
        {
          providerId: this.id,
          providerName: this.config.name,
          baseUrl: apiBase,
          label: "LM Studio model catalog",
          userMessage: "LM Studio returned an invalid model list."
        }
      )

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
          // Read out of the id, because no LM Studio endpoint reports a size:
          // not the list route, not the per-model route, not /v1/models. This
          // field used to hold `max_context_length / 1024`, so an 8192-token
          // window rendered in the model menu's parameter badge as "8K" — a
          // context window presented as a model size, next to genuine "8B"
          // values from other providers. The context length belongs in
          // capabilityHints below, which is where every consumer reads it.
          parameter_size: parameterSizeFromModelId(m.id),
          quantization_level: m.quantization || ""
        },
        capabilityHints: {
          // Model type ("llm"/"vlm"/"embeddings") settles vision and embeddings.
          modelType: m.type,
          contextLength: m.max_context_length,
          // Tool support is reported outright here, so detection can stop
          // inferring it from the provider default.
          ...(m.capabilities?.length ? { capabilityTags: m.capabilities } : {})
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
