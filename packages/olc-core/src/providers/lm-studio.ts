import type { ProviderConfig, ProviderModel } from "../types"
import { OpenAICompatibleProvider } from "./openai-compatible"

export class LMStudioProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super(config)
    this.capabilities.modelPull = true
    this.capabilities.modelUnload = true
  }

  async getModels(): Promise<ProviderModel[]> {
    const apiBase = this.config.baseUrl.replace(/\/v1\/?$/, "")
    const response = await fetch(`${apiBase}/api/v0/models`)

    if (!response.ok) {
      return super.getModels()
    }

    const json = (await response.json()) as {
      data?: Array<{
        id: string
        max_context_length?: number
      }>
    }

    return (json.data || []).map((entry) => ({
      id: entry.id,
      name: entry.id,
      providerId: this.id,
      providerName: this.name,
      raw: entry
    }))
  }

  async pullModel(model: string, signal?: AbortSignal): Promise<void> {
    const apiBase = this.config.baseUrl.replace(/\/v1\/?$/, "")
    const response = await fetch(`${apiBase}/api/v1/models/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal,
      body: JSON.stringify({ model })
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Pull failed for ${this.id}: ${response.status} ${response.statusText} ${body}`
      )
    }
  }

  async unloadModel(model: string, signal?: AbortSignal): Promise<void> {
    const apiBase = this.config.baseUrl.replace(/\/v1\/?$/, "")
    const response = await fetch(`${apiBase}/api/v1/models/unload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal,
      body: JSON.stringify({ model })
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Unload failed for ${this.id}: ${response.status} ${response.statusText} ${body}`
      )
    }
  }
}
