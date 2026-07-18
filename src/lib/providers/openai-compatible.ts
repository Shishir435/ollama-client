import { createAppError } from "@/lib/error-utils"
import { toDataUrl } from "@/lib/image-utils"
import { logger } from "@/lib/logger"
import {
  isRetryableProviderStatus,
  parseRetryAfter,
  providerErrorUserMessage
} from "@/lib/providers/provider-errors"
import type { ToolCall, ToolDefinition } from "@/lib/tools/types"
import type { ChatMessage, ChatStreamMessage, ProviderModel } from "@/types"
import { resolveProviderBaseUrl } from "./base-url"
import { OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES } from "./capabilities"
import {
  createProviderReplayArtifact,
  getProviderReplayBlocks
} from "./provider-replay"
import {
  getOpenAIServiceCompatibility,
  resolveProviderServiceProfile
} from "./service-profile"
import {
  type ChatRequest,
  type EmbeddingSupport,
  type LLMProvider,
  type ProviderConfig,
  ProviderId,
  ProviderServiceProfile
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
const mapToOpenAIMessage = (
  m: ChatMessage,
  expectedReplay?: { providerId: string; model: string }
): Record<string, unknown> => {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content }
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    const reasoningDetails = expectedReplay
      ? getProviderReplayBlocks(m.replayArtifact, {
          wire: "openai",
          ...expectedReplay
        })
      : undefined
    return {
      role: "assistant",
      content: m.content || "",
      ...(reasoningDetails ? { reasoning_details: reasoningDetails } : {}),
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
  if (m.role === "assistant") {
    const reasoningDetails = expectedReplay
      ? getProviderReplayBlocks(m.replayArtifact, {
          wire: "openai",
          ...expectedReplay
        })
      : undefined
    return {
      role: "assistant",
      content: m.content,
      ...(reasoningDetails ? { reasoning_details: reasoningDetails } : {})
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
          // Tool args must be an object; an array parses as typeof "object"
          // too, so guard it out rather than passing it through silently.
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
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

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const streamErrorStatus = (error: unknown): number | undefined => {
  const record = asRecord(error)
  if (!record) return undefined
  for (const candidate of [record.status, record.status_code, record.code]) {
    const status = Number(candidate)
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return status
    }
  }

  const kind = String(record.type ?? record.code ?? "").toLowerCase()
  if (kind.includes("rate_limit")) return 429
  if (kind.includes("overload")) return 529
  return undefined
}

const streamErrorRetryAfter = (error: unknown): number | undefined => {
  const record = asRecord(error)
  if (!record) return undefined
  const metadata = asRecord(record.metadata)
  const headers = asRecord(metadata?.headers)
  const value =
    record.retry_after ??
    record.retryAfter ??
    headers?.["Retry-After"] ??
    headers?.["retry-after"]
  return value === undefined ? undefined : parseRetryAfter(String(value))
}

export class OpenAICompatibleProvider implements LLMProvider {
  id: string = ProviderId.OPENAI
  capabilities = { ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES }

  constructor(public config: ProviderConfig) {
    this.id = String(config.id)
  }

  private headers(): Record<string, string> {
    const compatibility = getOpenAIServiceCompatibility(this.config)
    return {
      "Content-Type": "application/json",
      ...compatibility.extraHeaders,
      ...(this.config.apiKey
        ? { Authorization: `Bearer ${this.config.apiKey}` }
        : {})
    }
  }

  private async responseError(
    response: Response,
    label: string,
    baseUrl: string
  ): Promise<never> {
    const detail = await response.text()
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"))
    throw createAppError(`${label} (${response.status}): ${detail}`, {
      kind: "provider",
      status: response.status,
      providerId: this.id,
      retryable: isRetryableProviderStatus(response.status),
      retryAfterMs,
      userMessage: providerErrorUserMessage(response.status, {
        baseUrl,
        retryAfterMs
      }),
      debug: detail
    })
  }

  async getModels(): Promise<ProviderModel[]> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: this.headers()
      })
      if (!response.ok) {
        await this.responseError(response, "Model list failed", baseUrl)
      }
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
      throw e
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
      num_predict,
      top_p,
      tools,
      tool_choice
    } = request
    const hasTools = !!tools && tools.length > 0
    const baseUrl = resolveProviderBaseUrl(this.config)

    const compatibility = getOpenAIServiceCompatibility(this.config)
    const replayOwner =
      resolveProviderServiceProfile(this.config) ===
      ProviderServiceProfile.OPENROUTER
        ? { providerId: this.id, model }
        : undefined
    const requestedOutputTokens = max_tokens ?? num_predict
    const outputTokens =
      requestedOutputTokens !== undefined && requestedOutputTokens > 0
        ? requestedOutputTokens
        : undefined

    // Map to OpenAI chat-completions shape. Vision models take images as
    // content parts: a text part plus one image_url part per image (data URL).
    // Tool turns round-trip through `assistant.tool_calls` (arguments as a JSON
    // string) and `tool` result messages keyed by `tool_call_id`.
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => mapToOpenAIMessage(m, replayOwner)),
      stream: true,
      stream_options: compatibility.sendStreamOptions
        ? { include_usage: true }
        : undefined,
      temperature,
      top_p,
      tools: hasTools ? tools.map(toOpenAITool) : undefined,
      // tool_choice is only valid alongside a tools array; omit it otherwise.
      tool_choice: hasTools ? tool_choice : undefined
    }
    if (outputTokens !== undefined) {
      body[compatibility.maxTokensField] = outputTokens
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      await this.responseError(response, "OpenAI Error", baseUrl)
    }

    const startTime = Date.now()
    await this.processSSE(response, onChunk, startTime, model)
  }

  protected async processSSE(
    response: Response,
    onChunk: (chunk: ChatStreamMessage) => void,
    startTime: number,
    model: string
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
    const reasoningDetails: Array<Record<string, unknown>> = []
    const captureReasoningDetails =
      resolveProviderServiceProfile(this.config) ===
      ProviderServiceProfile.OPENROUTER

    const replayArtifact = () =>
      reasoningDetails.length > 0
        ? createProviderReplayArtifact(
            "openai",
            this.id,
            model,
            reasoningDetails
          )
        : undefined

    const emitToolCalls = () => {
      if (toolCallsEmitted || toolCalls.size === 0) return
      toolCallsEmitted = true
      onChunk({
        toolCalls: toolCalls.finalize(),
        replayArtifact: replayArtifact(),
        done: false
      })
    }

    const processLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed === "data: [DONE]") return
      if (!trimmed.startsWith("data: ")) return

      let data: {
        error?: unknown
        choices?: Array<{
          delta?: {
            content?: string
            reasoning?: string
            reasoning_content?: string
            thinking?: string
            thoughts?: string
            reasoning_details?: unknown[]
            tool_calls?: ToolCallFragment[]
          }
          finish_reason?: string
        }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      try {
        data = JSON.parse(trimmed.slice(6))
      } catch (e) {
        logger.warn(
          "Failed to parse SSE data line",
          "OpenAICompatibleProvider",
          { error: e }
        )
        return
      }

      // Mid-stream provider error (HTTP 200 already sent — vLLM/LiteLLM/etc.).
      // Throw so it surfaces as an error instead of a silently truncated
      // answer. This is outside the parse try/catch so it propagates rather
      // than being downgraded to a parse warning.
      if (data.error) {
        const errorRecord = asRecord(data.error)
        const message =
          typeof data.error === "string"
            ? data.error
            : typeof errorRecord?.message === "string"
              ? errorRecord.message
              : undefined
        const status = streamErrorStatus(data.error)
        const retryAfterMs = streamErrorRetryAfter(data.error)
        const baseUrl = resolveProviderBaseUrl(this.config)
        throw createAppError(
          message ||
            "The provider reported an error while generating the response.",
          {
            kind: "provider",
            status,
            providerId: this.id,
            retryable:
              status === undefined
                ? undefined
                : isRetryableProviderStatus(status),
            retryAfterMs,
            userMessage:
              status === undefined
                ? "The provider reported an error while generating the response."
                : providerErrorUserMessage(status, { baseUrl, retryAfterMs }),
            debug:
              typeof data.error === "string"
                ? data.error
                : JSON.stringify(data.error)
          }
        )
      }

      const delta = data.choices?.[0]?.delta

      if (captureReasoningDetails && Array.isArray(delta?.reasoning_details)) {
        for (const detail of delta.reasoning_details) {
          const record = asRecord(detail)
          if (record) reasoningDetails.push(record)
        }
      }

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
      // omit it, so the stream-done path also flushes.
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
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // Flush a final data line left without a trailing newline at EOF.
          if (buffer.trim()) processLine(buffer)
          buffer = ""
          emitToolCalls()
          const totalDurationNs = (Date.now() - startTime) * 1_000_000
          onChunk({
            done: true,
            replayArtifact: replayArtifact(),
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

        for (const line of lines) processLine(line)
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
    const baseUrl = resolveProviderBaseUrl(this.config)
    const targetModel = model || this.config.modelId || "text-embedding-3-small"
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: targetModel, input: text })
    })

    if (!response.ok) {
      await this.responseError(response, "OpenAI Embedding Error", baseUrl)
    }

    const data = await response.json()
    return data.data[0].embedding
  }

  async embedBatch(texts: string[], model?: string): Promise<number[][]> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    const targetModel = model || this.config.modelId || "text-embedding-3-small"
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: targetModel, input: texts })
    })

    if (!response.ok) {
      await this.responseError(response, "OpenAI Embedding Error", baseUrl)
    }

    const data = await response.json()
    return data.data.map((item: { embedding: number[] }) => item.embedding)
  }
}
