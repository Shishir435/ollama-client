import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { providerErrorUserMessage } from "@/lib/providers/provider-errors"
import type { ToolCall, ToolDefinition } from "@/lib/tools/types"
import type {
  ChatStreamMessage,
  OllamaChatRequest,
  OllamaShowRequest,
  OllamaShowResponse,
  ProviderModel
} from "@/types"
import { PROVIDER_CAPABILITIES } from "./capabilities"
import {
  type ChatRequest,
  type EmbeddingSupport,
  type LLMProvider,
  type ProviderConfig,
  ProviderId
} from "./types"

/** Normalized tool → Ollama `/api/chat` `tools` entry (OpenAI-style). */
const toOllamaTool = (tool: ToolDefinition) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }
})

interface OllamaToolCall {
  id?: string
  function?: { name?: string; arguments?: unknown }
}

/** Ollama tool call → normalized {@link ToolCall}. Arguments arrive as an object. */
const normalizeOllamaToolCall = (
  raw: OllamaToolCall,
  index: number
): ToolCall => {
  const name = raw.function?.name ?? ""
  const args = raw.function?.arguments
  return {
    id: raw.id || `${name || "tool"}_${index}`,
    name,
    arguments:
      args && typeof args === "object" ? (args as Record<string, unknown>) : {}
  }
}

export class OllamaProvider implements LLMProvider {
  id = ProviderId.OLLAMA
  capabilities = { ...PROVIDER_CAPABILITIES[ProviderId.OLLAMA] }

  constructor(public config: ProviderConfig) {}

  async getModels(): Promise<ProviderModel[]> {
    try {
      if (!this.config.baseUrl) {
        return []
      }
      logger.debug(
        `Fetching models from ${this.config.baseUrl}`,
        "OllamaProvider"
      )
      const response = await fetch(`${this.config.baseUrl}/api/tags`)
      if (!response.ok) return []
      const data = await response.json()
      return (data.models as ProviderModel[]) || []
    } catch (e) {
      logger.error("Failed to fetch models", "OllamaProvider", { error: e })
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
      keep_alive,
      tools,
      tool_choice
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

    // Map to Ollama's wire shape. Vision models take image input as raw base64
    // strings (no data: prefix) on the `images` field of a message. Tool turns
    // round-trip through `assistant.tool_calls` and `tool` result messages
    // (`{ role: "tool", tool_name, content }`).
    const ollamaMessages = messages.map((m) => {
      const mapped: {
        role: string
        content: string
        images?: string[]
        tool_name?: string
        tool_calls?: Array<{ function: { name: string; arguments: unknown } }>
      } = {
        role: m.role,
        content: m.content
      }
      if (m.images && m.images.length > 0) {
        mapped.images = m.images.map((img) => img.base64)
      }
      if (m.role === "tool" && m.toolName) {
        mapped.tool_name = m.toolName
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        mapped.tool_calls = m.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.arguments }
        }))
      }
      return mapped
    })

    const body = {
      model,
      messages: ollamaMessages,
      stream: true,
      keep_alive,
      // Ollama has no `tool_choice` param; express "none" by omitting tools.
      // It accepts tool-call history without a tools array, so this is safe and
      // still prevents further tool calls in the synthesis pass.
      tools:
        tool_choice === "none" || !tools || tools.length === 0
          ? undefined
          : tools.map(toOllamaTool),
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
      throw createAppError(`Ollama Error (${response.status}): ${errorText}`, {
        kind: "provider",
        status: response.status,
        providerId: ProviderId.OLLAMA,
        retryable: response.status >= 500,
        userMessage: providerErrorUserMessage(response.status),
        debug: errorText
      })
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw createAppError("Response body is null", {
        kind: "provider",
        providerId: ProviderId.OLLAMA
      })
    }

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
          let data: {
            error?: unknown
            message?: {
              content?: string
              thinking?: string
              reasoning?: string
              reasoning_content?: string
              tool_calls?: OllamaToolCall[]
            }
            done?: boolean
            total_duration?: number
            load_duration?: number
            sample_count?: number
            sample_duration?: number
            prompt_eval_count?: number
            prompt_eval_duration?: number
            eval_count?: number
            eval_duration?: number
          }
          try {
            data = JSON.parse(line)
          } catch (error) {
            logger.warn("Failed to parse chunk", "OllamaProvider", { error })
            continue
          }

          if (data.error) {
            const message =
              typeof data.error === "string"
                ? data.error
                : "The provider reported an error while generating the response."
            throw createAppError(message, {
              kind: "provider",
              providerId: ProviderId.OLLAMA,
              userMessage:
                "The provider reported an error while generating the response.",
              debug: typeof data.error === "string" ? data.error : undefined
            })
          }

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

          // Ollama emits the whole tool_calls array in one message (arguments
          // already parsed to an object), unlike OpenAI's streamed fragments.
          const rawToolCalls = data.message?.tool_calls
          if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
            onChunk({
              toolCalls: rawToolCalls.map(normalizeOllamaToolCall),
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
      logger.error("Failed to fetch model details", "OllamaProvider", {
        error: e
      })
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
        logger.warn(`/api/embed failed: ${response.status}`, "OllamaProvider", {
          error: errorText
        })
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
        logger.warn(
          `/api/embeddings failed: ${legacyResponse.status}`,
          "OllamaProvider",
          { error: errorText }
        )
        const message = errorText
          ? `Ollama Embedding Error: ${legacyResponse.status} ${errorText}`
          : `Ollama Embedding Error: ${legacyResponse.status}`
        throw createAppError(message, {
          kind: "provider",
          status: legacyResponse.status,
          providerId: ProviderId.OLLAMA,
          retryable: legacyResponse.status >= 500,
          debug: errorText
        })
      }

      const legacyData = await legacyResponse.json()
      if (!Array.isArray(legacyData.embedding)) {
        throw createAppError(
          "Ollama Embedding Error: invalid embedding response",
          {
            kind: "provider",
            providerId: ProviderId.OLLAMA
          }
        )
      }
      return legacyData.embedding
    } catch (error) {
      logger.error("Both embed endpoints failed", "OllamaProvider", { error })
      throw error
    }
  }

  async embedBatch(texts: string[], model?: string): Promise<number[][]> {
    // Ollama doesn't have a native batch embed endpoint that takes multiple prompts in one call (it usually takes one)
    // So we parallelize here
    return Promise.all(texts.map((t) => this.embed(t, model)))
  }
}
