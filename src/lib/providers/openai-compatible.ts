import { DEFAULT_OPENAI_COMPATIBLE_BASE_URL } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { toDataUrl } from "@/lib/image-utils"
import { logger } from "@/lib/logger"
import { providerErrorUserMessage } from "@/lib/providers/provider-errors"
import type { ToolCall, ToolDefinition } from "@/lib/tools/types"
import type { ChatMessage, ChatStreamMessage, ProviderModel } from "@/types"
import { OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES } from "./capabilities"
import {
  type ChatRequest,
  type EmbeddingSupport,
  type LLMProvider,
  type ProviderConfig,
  ProviderId
} from "./types"

/** Normalized tool → OpenAI `tools` entry. */
const toOpenAITool = (tool: ToolDefinition) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }
})

/** ChatMessage → OpenAI chat-completions message (images + tool turns). */
const mapToOpenAIMessage = (m: ChatMessage): Record<string, unknown> => {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content }
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content || "",
      tool_calls: m.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {})
        }
      }))
    }
  }
  if (m.role === "user" && m.images && m.images.length > 0) {
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: "text", text: m.content }] : []),
        ...m.images.map((img) => ({
          type: "image_url",
          image_url: { url: toDataUrl(img.mimeType, img.base64) }
        }))
      ]
    }
  }
  return { role: m.role, content: m.content }
}

/** Streamed OpenAI tool-call fragment, accumulated by `index` across chunks. */
interface ToolCallFragment {
  index: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/**
 * Accumulates OpenAI streamed tool-call fragments. `id`/`name` arrive in the
 * first fragment for an index; `arguments` is a string concatenated across
 * later fragments. Call {@link finalize} once the stream signals tool calls are
 * complete to parse arguments into normalized {@link ToolCall}s.
 */
class ToolCallAccumulator {
  private readonly byIndex = new Map<
    number,
    { id?: string; name?: string; args: string }
  >()

  add(fragments: ToolCallFragment[]): void {
    for (const fragment of fragments) {
      const entry = this.byIndex.get(fragment.index) ?? { args: "" }
      if (fragment.id) entry.id = fragment.id
      if (fragment.function?.name) entry.name = fragment.function.name
      if (fragment.function?.arguments)
        entry.args += fragment.function.arguments
      this.byIndex.set(fragment.index, entry)
    }
  }

  get size(): number {
    return this.byIndex.size
  }

  finalize(): ToolCall[] {
    return [...this.byIndex.entries()].map(([index, entry]) => {
      let args: Record<string, unknown> = {}
      if (entry.args) {
        try {
          const parsed = JSON.parse(entry.args)
          if (parsed && typeof parsed === "object") {
            args = parsed as Record<string, unknown>
          }
        } catch {
          // Leave args empty; a malformed argument string from the model
          // surfaces as an empty-args call rather than crashing the stream.
        }
      }
      return {
        id: entry.id || `${entry.name || "tool"}_${index}`,
        name: entry.name || "",
        arguments: args
      }
    })
  }
}

export class OpenAICompatibleProvider implements LLMProvider {
  id: string = ProviderId.OPENAI
  capabilities = { ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES }

  constructor(public config: ProviderConfig) {}

  async getModels(): Promise<ProviderModel[]> {
    const baseUrl = this.config.baseUrl || DEFAULT_OPENAI_COMPATIBLE_BASE_URL
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
      logger.error("Failed to fetch models", "OpenAICompatibleProvider", {
        error: e
      })
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
      max_tokens,
      top_p,
      tools,
      tool_choice
    } = request
    const hasTools = !!tools && tools.length > 0
    const baseUrl = this.config.baseUrl || DEFAULT_OPENAI_COMPATIBLE_BASE_URL

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`
    }

    // Map to OpenAI chat-completions shape. Vision models take images as
    // content parts: a text part plus one image_url part per image (data URL).
    // Tool turns round-trip through `assistant.tool_calls` (arguments as a JSON
    // string) and `tool` result messages keyed by `tool_call_id`.
    const body = {
      model,
      messages: messages.map((m) => mapToOpenAIMessage(m)),
      stream: true,
      stream_options: { include_usage: true },
      temperature,
      max_tokens,
      top_p,
      tools: hasTools ? tools.map(toOpenAITool) : undefined,
      // tool_choice is only valid alongside a tools array; omit it otherwise.
      tool_choice: hasTools ? tool_choice : undefined
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw createAppError(`OpenAI Error (${response.status}): ${errorText}`, {
        kind: "provider",
        status: response.status,
        providerId: this.id,
        retryable: response.status >= 500,
        userMessage: providerErrorUserMessage(response.status),
        debug: errorText
      })
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
    if (!reader) {
      throw createAppError("Response body is null", {
        kind: "provider",
        providerId: this.id
      })
    }

    const decoder = new TextDecoder()
    let buffer = ""
    let firstTokenTime: number | null = null
    let latestMetrics: ChatStreamMessage["metrics"] | undefined
    const toolCalls = new ToolCallAccumulator()
    let toolCallsEmitted = false

    const emitToolCalls = () => {
      if (toolCallsEmitted || toolCalls.size === 0) return
      toolCallsEmitted = true
      onChunk({ toolCalls: toolCalls.finalize(), done: false })
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          emitToolCalls()
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

              const thinkingDelta =
                delta?.reasoning ||
                delta?.reasoning_content ||
                delta?.thinking ||
                delta?.thoughts

              if (thinkingDelta) {
                onChunk({ thinkingDelta, done: false })
              }

              if (delta?.content) {
                if (!firstTokenTime) {
                  firstTokenTime = Date.now()
                }
                onChunk({ delta: delta.content, done: false })
              }

              if (Array.isArray(delta?.tool_calls)) {
                toolCalls.add(delta.tool_calls as ToolCallFragment[])
              }

              // Most providers set finish_reason "tool_calls" before usage; some
              // omit it, so the stream-done path above also flushes.
              if (data.choices?.[0]?.finish_reason === "tool_calls") {
                emitToolCalls()
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
            } catch (e) {
              logger.warn(
                "Failed to parse SSE data line",
                "OpenAICompatibleProvider",
                { error: e }
              )
            }
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
    const baseUrl = this.config.baseUrl || DEFAULT_OPENAI_COMPATIBLE_BASE_URL
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
      throw createAppError(
        `OpenAI Embedding Error (${response.status}): ${errorText}`,
        {
          kind: "provider",
          status: response.status,
          providerId: this.id,
          retryable: response.status >= 500,
          debug: errorText
        }
      )
    }

    const data = await response.json()
    return data.data[0].embedding
  }

  async embedBatch(texts: string[], model?: string): Promise<number[][]> {
    const baseUrl = this.config.baseUrl || DEFAULT_OPENAI_COMPATIBLE_BASE_URL
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
      throw createAppError(
        `OpenAI Embedding Error (${response.status}): ${errorText}`,
        {
          kind: "provider",
          status: response.status,
          providerId: this.id,
          retryable: response.status >= 500,
          debug: errorText
        }
      )
    }

    const data = await response.json()
    return data.data.map((item: { embedding: number[] }) => item.embedding)
  }
}
