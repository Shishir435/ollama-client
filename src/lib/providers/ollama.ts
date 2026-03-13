import type {
  ChatStreamMessage,
  OllamaChatRequest,
  OllamaShowRequest,
  OllamaShowResponse,
  ProviderModel
} from "@/types"
import {
  type ChatRequest,
  type EmbeddingSupport,
  type LLMProvider,
  type ProviderConfig,
  ProviderId
} from "./types"

export class OllamaProvider implements LLMProvider {
  id = ProviderId.OLLAMA

  constructor(public config: ProviderConfig) {}

  async getModels(): Promise<ProviderModel[]> {
    try {
      if (!this.config.baseUrl) {
        return []
      }
      console.log(
        `[OllamaProvider] Fetching models from ${this.config.baseUrl}`
      )
      const response = await fetch(`${this.config.baseUrl}/api/tags`)
      if (!response.ok) return []
      const data = await response.json()
      return (data.models as ProviderModel[]) || []
    } catch (e) {
      console.error("Failed to fetch Ollama models", e)
      return []
    }
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const {
      model,
      messages,
      temperature,
      top_p,
      top_k,
      repeat_penalty,
      repeat_last_n,
      seed,
      num_ctx,
      num_predict,
      min_p,
      stop,
      num_thread,
      num_gpu,
      num_batch,
      keep_alive
    } = request
    const baseUrl = this.config.baseUrl || "http://localhost:11434"

    const options: OllamaChatRequest["options"] = {
      temperature,
      top_p,
      top_k,
      repeat_penalty,
      repeat_last_n,
      seed,
      num_ctx,
      num_predict,
      min_p,
      stop,
      num_thread,
      num_gpu,
      num_batch
    }

    // Remove undefined values to keep payload concise
    const filteredOptions = Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined)
    )

    const body: OllamaChatRequest = {
      model,
      messages,
      stream: true,
      keep_alive,
      options:
        Object.keys(filteredOptions).length > 0 ? filteredOptions : undefined
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Ollama Error (${response.status}): ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error("Response body is null")

    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          onChunk({ done: true })
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line)
            if (data.error) throw new Error(data.error)

            const thinkingDelta =
              data.message?.thinking ||
              data.message?.reasoning ||
              data.message?.reasoning_content

            if (thinkingDelta) {
              onChunk({
                thinkingDelta,
                done: false
              })
            }

            onChunk({
              delta: data.message?.content || "",
              done: data.done,
              metrics: data.done
                ? {
                    total_duration: data.total_duration,
                    load_duration: data.load_duration,
                    sample_count: data.sample_count,
                    sample_duration: data.sample_duration,
                    prompt_eval_count: data.prompt_eval_count,
                    prompt_eval_duration: data.prompt_eval_duration,
                    eval_count: data.eval_count,
                    eval_duration: data.eval_duration
                  }
                : undefined
            })
          } catch (e) {
            console.warn("Failed to parse Ollama chunk", e)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async getModelDetails(model: string): Promise<OllamaShowResponse | null> {
    const baseUrl = this.config.baseUrl || "http://localhost:11434"
    const requestBody: OllamaShowRequest = { name: model }

    try {
      const res = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      })

      if (!res.ok) return null
      return await res.json()
    } catch (e) {
      console.error("Failed to fetch Ollama model details", e)
      return null
    }
  }

  async getEmbeddingSupport(): Promise<EmbeddingSupport> {
    return {
      supported: true,
      mode: "native",
      notes: "Uses Ollama embedding endpoints (/api/embed or /api/embeddings)."
    }
  }

  async embed(text: string, model?: string): Promise<number[]> {
    const baseUrl = this.config.baseUrl || "http://localhost:11434"
    const targetModel = model || this.config.modelId || "nomic-embed-text"

    // Prefer current endpoint and fall back to legacy endpoint for compatibility.
    try {
      const requestBody = { model: targetModel, input: text }
      const response = await fetch(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      })

      if (response.ok) {
        const data = await response.json()
        const vector = Array.isArray(data.embeddings)
          ? data.embeddings[0]
          : data.embedding

        if (Array.isArray(vector) && vector.length > 0) {
          return vector
        }
      } else {
        const errorText = await response.text()
        console.warn(
          `[Ollama] /api/embed failed: ${response.status}`,
          errorText
        )
      }
    } catch (_error) {
      // Continue to legacy fallback.
    }

    try {
      const legacyBody = { model: targetModel, prompt: text }
      const legacyResponse = await fetch(`${baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyBody)
      })

      if (!legacyResponse.ok) {
        const errorText = await legacyResponse.text()
        console.warn(
          `[Ollama] /api/embeddings failed: ${legacyResponse.status}`,
          errorText
        )
        const message = errorText
          ? `Ollama Embedding Error: ${legacyResponse.status} ${errorText}`
          : `Ollama Embedding Error: ${legacyResponse.status}`
        throw new Error(message)
      }

      const legacyData = await legacyResponse.json()
      if (!Array.isArray(legacyData.embedding)) {
        throw new Error("Ollama Embedding Error: invalid embedding response")
      }
      return legacyData.embedding
    } catch (error) {
      console.error("[Ollama] Both embed endpoints failed", error)
      throw error
    }
  }

  async embedBatch(texts: string[], model?: string): Promise<number[][]> {
    // Ollama doesn't have a native batch embed endpoint that takes multiple prompts in one call (it usually takes one)
    // So we parallelize here
    return Promise.all(texts.map((t) => this.embed(t, model)))
  }
}
