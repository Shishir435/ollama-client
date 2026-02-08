import type { ChatStreamMessage, ProviderModel } from "@/types"
import {
  type ChatRequest,
  type EmbeddingSupport,
  type LLMProvider,
  type ProviderConfig,
  ProviderId
} from "./types"

export class OpenAIProvider implements LLMProvider {
  id: string = ProviderId.OPENAI

  constructor(public config: ProviderConfig) {}

  async getModels(): Promise<ProviderModel[]> {
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1"
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`
    }

    try {
      const response = await fetch(`${baseUrl}/models`, { headers })
      if (!response.ok) return []
      const data = await response.json()
      return (
        (data.data as { id: string }[])?.map((m) => ({
          name: m.id,
          model: m.id,
          modified_at: new Date().toISOString(),
          size: 0,
          digest: "",
          details: {
            parent_model: "",
            format: "",
            family: "openai",
            families: [],
            parameter_size: "",
            quantization_level: ""
          }
        })) || []
      )
    } catch (e) {
      console.error("Failed to fetch OpenAI models", e)
      return []
    }
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const { model, messages, temperature, max_tokens, top_p } = request
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1"

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`
    }

    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature,
      max_tokens,
      top_p
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI Error (${response.status}): ${errorText}`)
    }

    const startTime = Date.now()
    await this.processSSE(response, onChunk, startTime)
  }

  protected async processSSE(
    response: Response,
    onChunk: (chunk: ChatStreamMessage) => void,
    startTime: number
  ) {
    const reader = response.body?.getReader()
    if (!reader) throw new Error("Response body is null")

    const decoder = new TextDecoder()
    let buffer = ""
    let firstTokenTime: number | null = null
    let latestMetrics: ChatStreamMessage["metrics"] | undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          const totalDurationNs = (Date.now() - startTime) * 1_000_000
          onChunk({
            done: true,
            metrics: {
              ...latestMetrics,
              total_duration: totalDurationNs
            }
          })
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === "data: [DONE]") continue

          if (trimmed.startsWith("data: ")) {
            try {
              const data = JSON.parse(trimmed.slice(6))
              const delta = data.choices?.[0]?.delta

              if (delta?.content) {
                if (!firstTokenTime) {
                  firstTokenTime = Date.now()
                }
                onChunk({ delta: delta.content, done: false })
              }

              if (data.usage) {
                const totalDurationNs = (Date.now() - startTime) * 1_000_000
                const evalDurationNs = firstTokenTime
                  ? (Date.now() - firstTokenTime) * 1_000_000
                  : 1

                const promptEvalDurationNs = firstTokenTime
                  ? (firstTokenTime - startTime) * 1_000_000
                  : totalDurationNs

                latestMetrics = {
                  total_duration: totalDurationNs,
                  prompt_eval_count: data.usage.prompt_tokens,
                  prompt_eval_duration: promptEvalDurationNs,
                  eval_count: data.usage.completion_tokens,
                  eval_duration: evalDurationNs
                }

                onChunk({
                  done: false,
                  metrics: latestMetrics
                })
              }
            } catch (_e) {}
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
  async getModelDetails(_model: string): Promise<null> {
    return null
  }

  async getEmbeddingSupport(): Promise<EmbeddingSupport> {
    return {
      supported: true,
      mode: "openai-compatible",
      notes:
        "Uses /v1/embeddings for OpenAI-compatible providers when supported."
    }
  }

  async embed(text: string, model?: string): Promise<number[]> {
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1"
    const targetModel = model || this.config.modelId || "text-embedding-3-small"
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`
    }

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: targetModel, input: text })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `OpenAI Embedding Error (${response.status}): ${errorText}`
      )
    }

    const data = await response.json()
    return data.data[0].embedding
  }

  async embedBatch(texts: string[], model?: string): Promise<number[][]> {
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1"
    const targetModel = model || this.config.modelId || "text-embedding-3-small"
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`
    }

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: targetModel, input: texts })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `OpenAI Embedding Error (${response.status}): ${errorText}`
      )
    }

    const data = await response.json()
    return data.data.map((item: { embedding: number[] }) => item.embedding)
  }
}
