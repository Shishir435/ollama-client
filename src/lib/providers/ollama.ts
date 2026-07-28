import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  classifyProviderError,
  localCorsForbiddenMessage,
  providerErrorUserMessage,
  readProviderStreamChunk,
  throwProviderConnectionError
} from "@/lib/providers/provider-errors"
import type { ToolCall, ToolDefinition } from "@/lib/tools/types"
import type {
  ChatStreamMessage,
  OllamaChatRequest,
  OllamaShowRequest,
  OllamaShowResponse,
  ProviderModel
} from "@/types"
import { resolveProviderBaseUrl } from "./base-url"
import { PROVIDER_CAPABILITIES } from "./capabilities"
import {
  type ChatRequest,
  type EmbeddingSupport,
  type LLMProvider,
  type ProviderConfig,
  ProviderId
} from "./types"

// Ceiling on the per-list `/api/show` fan-out that recovers metadata missing
// from `/api/tags`. Sized above a normal library's count of non-GGUF models so
// the cap never bites in practice, and low enough that a server reporting no
// metadata at all cannot turn one list request into dozens.
const OLLAMA_DETAIL_BACKFILL_LIMIT = 12

/**
 * Remembers backfilled details so a repeated model list costs no extra requests.
 *
 * `getModels` runs far more often than once per user action — tool gating calls
 * it per turn, and the UI refetches — so an uncached backfill added a request per
 * affected model to every one of those. Keyed by base URL, model, and digest:
 * a model file replaced under the same name gets a new digest, so the entry
 * cannot go stale rather than expiring on a guessed timer.
 */
const detailBackfillCache = new Map<string, ProviderModel["details"]>()

const backfillCacheKey = (baseUrl: string, model: ProviderModel): string =>
  `${baseUrl}::${model.model}::${model.digest}`

/**
 * Drops every cached backfill. Called when provider configuration changes, since
 * a re-pointed base URL should not answer from the previous server's metadata.
 */
export const clearOllamaDetailBackfillCache = (): void => {
  detailBackfillCache.clear()
}

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

  async getModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    try {
      const baseUrl = resolveProviderBaseUrl(this.config)
      logger.debug(`Fetching models from ${baseUrl}`, "OllamaProvider")
      const response = await fetch(
        `${baseUrl}/api/tags`,
        signal ? { signal } : undefined
      )
      if (!response.ok) {
        throw createAppError(
          `Ollama model list failed (${response.status}): ${response.statusText}`,
          {
            kind: "provider",
            status: response.status,
            providerId: ProviderId.OLLAMA,
            retryable: response.status >= 500
          }
        )
      }
      const data = await response.json()
      const models = (data.models as ProviderModel[]) || []
      return await this.backfillMissingDetails(models, signal)
    } catch (e) {
      if (!signal?.aborted) {
        logger.error("Failed to fetch models", "OllamaProvider", { error: e })
      }
      throw e
    }
  }

  /**
   * Recovers the metadata `/api/tags` omits for non-GGUF models.
   *
   * Ollama reports empty `family`, `parameter_size`, and `quantization_level` in
   * `/api/tags` for safetensors/MLX models — `gemma4:12b-mlx` comes back blank
   * while `gemma4:12b` carries "11.9B" / "Q4_K_M". The data exists; `/api/show`
   * has it ("12.4B" / "nvfp4"), so the two entries only looked different because
   * of which endpoint answered.
   *
   * One `/api/show` per affected model, so a server that reports everything costs
   * nothing extra. Capped, because a server that reports nothing must not turn one
   * list request into an unbounded fan-out. A failed or aborted lookup leaves that
   * model exactly as `/api/tags` gave it — a blank badge beats a broken list.
   */
  private async backfillMissingDetails(
    models: ProviderModel[],
    signal?: AbortSignal
  ): Promise<ProviderModel[]> {
    // Narrow to the shape that actually exhibits the gap: a model whose format
    // Ollama does report, is not GGUF, and yet has no parameter size. GGUF
    // entries always carry one, and a model with no format at all is not an
    // Ollama tags entry we can reason about — widening past this would issue an
    // /api/show for every model any provider declines to size, on every refresh.
    const baseUrl = resolveProviderBaseUrl(this.config)
    const incomplete = models.filter(
      (model) =>
        !model.details?.parameter_size &&
        !!model.details?.format &&
        model.details.format !== "gguf"
    )
    if (incomplete.length === 0) return models

    const enriched = new Map<string, ProviderModel["details"]>()
    const unresolved: ProviderModel[] = []
    for (const model of incomplete) {
      const cached = detailBackfillCache.get(backfillCacheKey(baseUrl, model))
      if (cached) enriched.set(model.model, cached)
      else unresolved.push(model)
    }

    const targets = unresolved.slice(0, OLLAMA_DETAIL_BACKFILL_LIMIT)
    if (unresolved.length > targets.length) {
      logger.debug(
        `Backfilling details for ${targets.length} of ${unresolved.length} models missing metadata`,
        "OllamaProvider"
      )
    }

    await Promise.all(
      targets.map(async (model) => {
        try {
          const shown = await this.getModelDetails(model.model, signal)
          if (shown?.details?.parameter_size) {
            enriched.set(model.model, shown.details)
            detailBackfillCache.set(
              backfillCacheKey(baseUrl, model),
              shown.details
            )
          }
        } catch {
          // Already logged by getModelDetails; this model keeps its blank fields.
        }
      })
    )

    if (enriched.size === 0) return models
    return models.map((model) => {
      const details = enriched.get(model.model)
      return details ? { ...model, details } : model
    })
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
      think,
      tools,
      tool_choice
    } = request
    const baseUrl = resolveProviderBaseUrl(this.config)

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
      think,
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
    }).catch((error) =>
      throwProviderConnectionError(error, {
        providerId: this.id,
        providerName: this.config.name,
        model,
        baseUrl
      })
    )

    if (!response.ok) {
      const errorText = await response.text()
      const classification = classifyProviderError(response.status, errorText)
      throw createAppError(`Ollama Error (${response.status}): ${errorText}`, {
        kind: "provider",
        status: response.status,
        providerId: ProviderId.OLLAMA,
        providerName: this.config.name,
        model,
        baseUrl,
        retryable: response.status >= 500,
        code:
          response.status === 401 || response.status === 403
            ? "OLC-CORS-BLOCKED"
            : classification.code,
        phase: "response",
        recoveryAction: classification.recoveryAction,
        userMessage:
          response.status === 401 || response.status === 403
            ? localCorsForbiddenMessage(response.status)
            : providerErrorUserMessage(response.status, {
                providerName: this.config.name,
                model,
                reason: classification.reason
              }),
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
    // A single NDJSON object can straddle a read boundary, so accumulate and
    // only parse complete (newline-terminated) lines; the remainder carries to
    // the next read. Without this, a split object fails to parse and the whole
    // message (which may carry tool_calls or the final done+metrics) is lost.
    let buffer = ""

    const processLine = (line: string) => {
      if (!line.trim()) return
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
        return
      }

      if (data.error) {
        const message =
          typeof data.error === "string"
            ? data.error
            : "The provider reported an error while generating the response."
        const classification = classifyProviderError(undefined, message)
        throw createAppError(message, {
          kind: "provider",
          providerId: ProviderId.OLLAMA,
          providerName: this.config.name,
          model,
          baseUrl,
          code: classification.code,
          phase: "read-stream",
          recoveryAction: classification.recoveryAction,
          userMessage: classification.reason
            ? `${this.config.name} reported an error while generating the response. ${classification.reason}`
            : `${this.config.name} reported an error while generating the response. Check its server logs and configuration.`,
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

    try {
      while (true) {
        const { done, value } = await readProviderStreamChunk(reader, {
          providerId: this.id,
          providerName: this.config.name,
          model,
          baseUrl
        })
        if (done) {
          // Flush a final line left without a trailing newline at EOF.
          if (buffer.trim()) processLine(buffer)
          buffer = ""
          onChunk({ done: true })
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) processLine(line)
      }
    } finally {
      reader.releaseLock()
    }
  }

  async getModelDetails(
    model: string,
    signal?: AbortSignal
  ): Promise<OllamaShowResponse | null> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    const requestBody: OllamaShowRequest = { name: model }

    try {
      const res = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        ...(signal ? { signal } : {})
      })

      if (!res.ok) {
        throw createAppError(
          `Ollama model details failed (${res.status}): ${res.statusText}`,
          {
            kind: "provider",
            status: res.status,
            providerId: ProviderId.OLLAMA,
            retryable: res.status >= 500
          }
        )
      }
      return await res.json()
    } catch (e) {
      logger.error("Failed to fetch model details", "OllamaProvider", {
        error: e
      })
      throw e
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
    const baseUrl = resolveProviderBaseUrl(this.config)
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
