import type {
  ChatChunk,
  ChatRequest,
  ProviderConfig,
  ProviderModel
} from "../types"
import { BaseProvider } from "./base"

export class OllamaProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config, {
      modelPull: true,
      modelUnload: true,
      modelDelete: true,
      providerVersion: true
    })
  }

  async getModels(): Promise<ProviderModel[]> {
    const response = await fetch(`${this.config.baseUrl}/api/tags`)
    if (!response.ok) {
      throw new Error(
        `Model listing failed for ${this.id}: ${response.status} ${response.statusText}`
      )
    }

    const json = (await response.json()) as {
      models?: Array<{
        name: string
        model?: string
        modified_at?: string
        size?: number
      }>
    }

    return (json.models || []).map((entry) => ({
      id: entry.model || entry.name,
      name: entry.name,
      providerId: this.id,
      providerName: this.name,
      createdAt: entry.modified_at,
      size: entry.size,
      raw: entry
    }))
  }

  async streamChat(
    request: ChatRequest,
    {
      onChunk,
      signal
    }: { onChunk: (chunk: ChatChunk) => void; signal?: AbortSignal }
  ): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        keep_alive: request.keep_alive,
        options: {
          temperature: request.temperature,
          top_p: request.top_p,
          top_k: request.top_k,
          repeat_penalty: request.repeat_penalty,
          repeat_last_n: request.repeat_last_n,
          seed: request.seed,
          num_ctx: request.num_ctx,
          num_predict: request.num_predict,
          min_p: request.min_p,
          stop: request.stop,
          num_thread: request.num_thread,
          num_gpu: request.num_gpu,
          num_batch: request.num_batch
        }
      })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Chat failed for ${this.id}: ${response.status} ${response.statusText} ${body}`
      )
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error(`Chat stream missing body for ${this.id}`)
    }

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        onChunk({ done: true })
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const data = JSON.parse(trimmed) as {
            done?: boolean
            message?: {
              content?: string
              thinking?: string
              reasoning?: string
              reasoning_content?: string
            }
            total_duration?: number
            load_duration?: number
            prompt_eval_count?: number
            prompt_eval_duration?: number
            eval_count?: number
            eval_duration?: number
          }

          const delta = data.message?.content || ""
          const thinking =
            data.message?.thinking ||
            data.message?.reasoning ||
            data.message?.reasoning_content

          if (thinking) {
            onChunk({
              thinkingDelta: thinking,
              done: false
            })
          }

          if (delta) {
            onChunk({ delta, done: false })
          }

          if (data.done) {
            onChunk({
              done: true,
              metrics: {
                total_duration: data.total_duration,
                load_duration: data.load_duration,
                prompt_eval_count: data.prompt_eval_count,
                prompt_eval_duration: data.prompt_eval_duration,
                eval_count: data.eval_count,
                eval_duration: data.eval_duration
              }
            })
          }
        } catch {
          // Ignore malformed chunks.
        }
      }
    }
  }

  async pullModel(model: string, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal,
      body: JSON.stringify({ name: model, stream: false })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Pull failed for ${this.id}: ${response.status} ${response.statusText} ${body}`
      )
    }
  }

  async unloadModel(model: string, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal,
      body: JSON.stringify({
        model,
        messages: [],
        keep_alive: 0
      })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Unload failed for ${this.id}: ${response.status} ${response.statusText} ${body}`
      )
    }
  }

  async deleteModel(model: string, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/delete`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      signal,
      body: JSON.stringify({ model })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Delete failed for ${this.id}: ${response.status} ${response.statusText} ${body}`
      )
    }
  }

  async getVersion(): Promise<string | null> {
    const response = await fetch(`${this.config.baseUrl}/api/version`)
    if (!response.ok) {
      return null
    }
    const json = (await response.json()) as { version?: string }
    return json.version || null
  }
}
