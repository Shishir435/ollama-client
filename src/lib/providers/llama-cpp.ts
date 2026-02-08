import type { ProviderModel } from "@/types"
import { OpenAIProvider } from "./openai"
import type { EmbeddingSupport } from "./types"
import { ProviderId } from "./types"

/**
 * Specialized provider for llama.cpp hybrid response format.
 */
interface LlamaCppModel {
  id?: string
  name?: string
  model?: string
  created?: number
  size?: number | string
  meta?: {
    n_params?: number
    size?: number | string
  }
}

export class LlamaCppProvider extends OpenAIProvider {
  id = ProviderId.LLAMA_CPP

  async getEmbeddingSupport(): Promise<EmbeddingSupport> {
    return {
      supported: true,
      mode: "openai-compatible",
      notes:
        "Requires llama.cpp server started with embeddings support and compatible pooling."
    }
  }

  async getModels(): Promise<ProviderModel[]> {
    const baseUrl = this.config.baseUrl || "http://localhost:8080/v1"

    // Normalization: Ensure clean base URL without trailing slash
    const cleanBase = baseUrl.replace(/\/$/, "")

    // Try multiple endpoints to be robust against user config
    const endpoints = [
      `${cleanBase}/models`,
      `${cleanBase.replace(/\/v1$/, "")}/v1/models`
    ]

    // Use a Set to avoid duplicate requests if cleanBase already has /v1
    const uniqueEndpoints = Array.from(new Set(endpoints))

    let response: Response | null = null
    for (const url of uniqueEndpoints) {
      try {
        console.log(`[LlamaCpp] Fetching models from ${url}`)
        const res = await fetch(url)
        if (res.ok) {
          response = res
          break
        }
      } catch (e) {
        console.warn(`[LlamaCpp] Failed to fetch from ${url}`, e)
      }
    }

    if (!response) {
      console.error("[LlamaCpp] All model fetch attempts failed.")
      return []
    }

    try {
      const json = await response.json()
      // Llama.cpp returns { data: [ { id: "...", meta: { ... } } ] }
      console.log("[LlamaCpp] Raw response:", JSON.stringify(json, null, 2))

      const list = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.models)
          ? json.models
          : []

      return list.map((item: LlamaCppModel) => {
        const id = item.id || item.name || item.model || ""
        const meta = item.meta || {}

        let paramSize = ""
        if (meta.n_params) {
          const params = meta.n_params / 1_000_000_000
          paramSize = `${params.toFixed(1).replace(/\.0$/, "")}B`
        }

        // Robust size parsing: check meta.size, top-level size, or parse string
        let size = 0
        if (meta.size) {
          size =
            typeof meta.size === "string" ? parseInt(meta.size, 10) : meta.size
        } else if (item.size) {
          size =
            typeof item.size === "string" ? parseInt(item.size, 10) : item.size
        }

        return {
          name: id,
          model: id,
          modified_at: item.created
            ? new Date(item.created * 1000).toISOString()
            : new Date().toISOString(),
          size: size || 0,
          digest: id,
          details: {
            parent_model: "",
            format: "gguf",
            family: "llama-cpp",
            families: [],
            parameter_size: paramSize,
            quantization_level: ""
          }
        }
      })
    } catch (e) {
      console.error("[LlamaCpp] Model parse failed", e)
      return []
    }
  }
}
