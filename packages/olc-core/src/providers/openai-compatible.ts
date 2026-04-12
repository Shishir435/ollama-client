import type {
  ChatChunk,
  ChatRequest,
  ProviderConfig,
  ProviderModel
} from "../types"
import { BaseProvider } from "./base"

const buildHeaders = (config: ProviderConfig) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  }

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }

  return headers
}

export class OpenAICompatibleProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config)
  }

  async getModels(): Promise<ProviderModel[]> {
    const headers = buildHeaders(this.config)
    const response = await fetch(`${this.config.baseUrl}/models`, {
      headers
    })

    if (!response.ok) {
      throw new Error(
        `Model listing failed for ${this.id}: ${response.status} ${response.statusText}`
      )
    }

    const json = (await response.json()) as {
      data?: Array<{ id: string; created?: number }>
    }

    return (json.data || []).map((entry) => ({
      id: entry.id,
      name: entry.id,
      providerId: this.id,
      providerName: this.name,
      createdAt: entry.created
        ? new Date(entry.created * 1000).toISOString()
        : undefined,
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
    const headers = buildHeaders(this.config)

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: request.temperature,
        top_p: request.top_p,
        max_tokens: request.max_tokens
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
        if (!trimmed || !trimmed.startsWith("data:")) continue

        const payload = trimmed.slice(5).trim()
        if (payload === "[DONE]") continue

        try {
          const data = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: string
                reasoning?: string
                reasoning_content?: string
                thinking?: string
              }
            }>
            usage?: {
              prompt_tokens?: number
              completion_tokens?: number
            }
          }

          const delta = data.choices?.[0]?.delta
          const content = delta?.content
          const thinking =
            delta?.reasoning || delta?.reasoning_content || delta?.thinking

          if (thinking) {
            onChunk({ thinkingDelta: thinking, done: false })
          }

          if (content) {
            onChunk({ delta: content, done: false })
          }

          if (data.usage) {
            onChunk({
              done: false,
              metrics: {
                prompt_eval_count: data.usage.prompt_tokens,
                eval_count: data.usage.completion_tokens
              }
            })
          }
        } catch {
          // Ignore malformed data chunks.
        }
      }
    }
  }
}
