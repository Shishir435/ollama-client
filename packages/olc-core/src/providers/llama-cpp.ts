import type { ProviderConfig, ProviderModel } from "../types"
import { OpenAICompatibleProvider } from "./openai-compatible"

export class LlamaCppProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super(config)
  }

  async getModels(): Promise<ProviderModel[]> {
    const cleanBase = this.config.baseUrl.replace(/\/$/, "")
    const candidates = [
      `${cleanBase}/models`,
      `${cleanBase.replace(/\/v1$/, "")}/v1/models`
    ]

    let response: Response | null = null
    for (const url of candidates) {
      try {
        const res = await fetch(url)
        if (res.ok) {
          response = res
          break
        }
      } catch {
        // Continue probing alternative endpoints.
      }
    }

    if (!response) {
      throw new Error("Failed to connect to llama.cpp model listing endpoint")
    }

    const json = (await response.json()) as {
      data?: Array<{
        id?: string
        name?: string
        model?: string
      }>
      models?: Array<{
        id?: string
        name?: string
        model?: string
      }>
    }

    const entries = json.data || json.models || []
    return entries.map((entry) => {
      const id = entry.id || entry.name || entry.model || "unknown"
      return {
        id,
        name: id,
        providerId: this.id,
        providerName: this.name,
        raw: entry
      }
    })
  }
}
