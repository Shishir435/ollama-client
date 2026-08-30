import {
  PROVIDER_MODEL_CLOUD_DESCRIPTION_MAX_LENGTH,
  PROVIDER_MODEL_CLOUD_PLAN_MAX_LENGTH
} from "@ollama-client/contracts/provider-rpc"
import { z } from "zod"
import { createAppError, isAbortError } from "@/lib/error-utils"
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
import { decodeOllamaEmbedding } from "./embedding-response"
import { generatedImageFromBase64 } from "./generated-image"
import {
  lifecycleRequestFailed,
  normalizeOllamaLoadedModel
} from "./model-lifecycle"
import { toOllamaThink } from "./reasoning-effort"
import { decodeProviderJson } from "./response-decoding"
import {
  type ChatRequest,
  type EmbeddingSupport,
  type ImageGenerationRequest,
  type LLMProvider,
  type ProviderConfig,
  ProviderId
} from "./types"

/**
 * Ceiling on the per-list `/api/show` fan-out that recovers metadata missing
 * from `/api/tags`. Sized above a normal library's count of non-GGUF models so
 * the cap never bites in practice, and low enough that a server reporting no
 * metadata at all cannot turn one list request into dozens.
 */
const OLLAMA_DETAIL_BACKFILL_LIMIT = 12
const OLLAMA_CLOUD_RECOMMENDATIONS_TTL_MS = 5 * 60 * 1000
const OLLAMA_CLOUD_RECOMMENDATIONS_TIMEOUT_MS = 1_500
const OLLAMA_CLOUD_RECOMMENDATIONS_RETRY_TTL_MS = 30_000

const OptionalString = z.string().optional().catch(undefined)
const OptionalCloudDescription = z
  .string()
  .max(PROVIDER_MODEL_CLOUD_DESCRIPTION_MAX_LENGTH)
  .optional()
  .catch(undefined)
const OptionalCloudPlan = z
  .string()
  .max(PROVIDER_MODEL_CLOUD_PLAN_MAX_LENGTH)
  .optional()
  .catch(undefined)
const OllamaModelCatalogSchema = z
  .object({
    models: z.array(
      z
        .object({
          name: z.string().min(1),
          model: OptionalString,
          modified_at: OptionalString,
          size: z.number().nonnegative().optional().catch(undefined),
          digest: OptionalString,
          details: z
            .object({
              parent_model: OptionalString,
              format: OptionalString,
              family: OptionalString,
              families: z.array(z.string()).optional().catch(undefined),
              parameter_size: OptionalString,
              quantization_level: OptionalString
            })
            .passthrough()
            .optional()
            .catch(undefined)
        })
        .passthrough()
        .transform(
          (model): ProviderModel => ({
            ...model,
            model: model.model ?? model.name,
            modified_at: model.modified_at ?? "",
            size: model.size ?? 0,
            digest: model.digest ?? "",
            details: {
              parent_model: model.details?.parent_model ?? "",
              format: model.details?.format ?? "",
              family: model.details?.family ?? "",
              families: model.details?.families ?? [],
              parameter_size: model.details?.parameter_size ?? "",
              quantization_level: model.details?.quantization_level ?? ""
            }
          })
        )
    )
  })
  .passthrough()

const OllamaCloudRecommendationsSchema = z
  .object({
    recommendations: z.array(
      z
        .object({
          model: z.string().min(1),
          // Match the provider RPC boundary exactly. Supplemental metadata
          // that is malformed or oversized is dropped here so it can never
          // invalidate the successfully discovered local catalog later.
          description: OptionalCloudDescription,
          context_length: z
            .number()
            .int()
            .positive()
            .optional()
            .catch(undefined),
          max_output_tokens: z
            .number()
            .int()
            .positive()
            .optional()
            .catch(undefined),
          required_plan: OptionalCloudPlan
        })
        .passthrough()
    )
  })
  .passthrough()

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
const cloudRecommendationCache = new Map<
  string,
  { expiresAt: number; models: ProviderModel[] }
>()

const backfillCacheKey = (baseUrl: string, model: ProviderModel): string =>
  `${baseUrl}::${model.model}::${model.digest}`

/**
 * Drops every cached backfill. Called when provider configuration changes, since
 * a re-pointed base URL should not answer from the previous server's metadata.
 */
export const clearOllamaDetailBackfillCache = (): void => {
  detailBackfillCache.clear()
  cloudRecommendationCache.clear()
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

  modelLifecycle = {
    listLoadedModels: async (signal?: AbortSignal) => {
      const response = await fetch(
        `${resolveProviderBaseUrl(this.config)}/api/ps`,
        signal ? { signal } : undefined
      )
      if (!response.ok) {
        throw lifecycleRequestFailed("loaded model list", response, this.id)
      }
      const data = await response.json()
      const models = Array.isArray(data?.models) ? data.models : []
      return models.map(normalizeOllamaLoadedModel)
    },
    unloadModel: async (model: string, signal?: AbortSignal) => {
      const response = await fetch(
        `${resolveProviderBaseUrl(this.config)}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
          signal
        }
      )
      if (!response.ok) {
        throw lifecycleRequestFailed("unload", response, this.id)
      }
      const data = await response.json()
      return data?.done_reason === "unload"
    },
    warmModel: async (
      model: string,
      keepAlive?: string | number,
      signal?: AbortSignal
    ) => {
      await fetch(`${resolveProviderBaseUrl(this.config)}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: "",
          stream: false,
          keep_alive: keepAlive
        }),
        signal
      })
    }
  }

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
      const { models } = await decodeProviderJson(
        response,
        OllamaModelCatalogSchema,
        {
          providerId: this.id,
          providerName: this.config.name,
          baseUrl,
          label: "model catalog",
          userMessage: "Ollama returned an invalid model list."
        }
      )
      const localModels = await this.backfillMissingDetails(models, signal)
      const cloudModels = await this.getCloudRecommendations(baseUrl, signal)
      if (cloudModels.length === 0) return localModels

      // `/api/tags` stays authoritative and byte-for-byte untouched. Cloud
      // recommendations are supplemental rows only: append successful,
      // previously unseen `:cloud` entries and never rewrite a local result.
      const localNames = new Set(localModels.map((model) => model.name))
      return [
        ...localModels,
        ...cloudModels.filter((model) => !localNames.has(model.name))
      ]
    } catch (e) {
      if (!signal?.aborted) {
        logger.error("Failed to fetch models", "OllamaProvider", { error: e })
      }
      throw e
    }
  }

  /**
   * Adds the same hosted-model recommendations the Ollama desktop app exposes.
   *
   * This endpoint is intentionally supplemental: it is experimental and older
   * daemons do not implement it. A missing or malformed response therefore
   * leaves the ordinary `/api/tags` catalog untouched. Only `:cloud` entries
   * are merged; local download recommendations still belong to model pulling.
   */
  private async getCloudRecommendations(
    baseUrl: string,
    signal?: AbortSignal
  ): Promise<ProviderModel[]> {
    const cached = cloudRecommendationCache.get(baseUrl)
    if (cached && cached.expiresAt > Date.now()) return cached.models

    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(signal?.reason)
    if (signal?.aborted) abortFromCaller()
    else signal?.addEventListener("abort", abortFromCaller, { once: true })
    const timeout = setTimeout(
      () => controller.abort(),
      OLLAMA_CLOUD_RECOMMENDATIONS_TIMEOUT_MS
    )

    try {
      const response = await fetch(
        `${baseUrl}/api/experimental/model-recommendations`,
        { signal: controller.signal }
      )
      if (!response.ok) {
        if ([404, 405, 501].includes(response.status)) {
          cloudRecommendationCache.set(baseUrl, {
            expiresAt: Date.now() + OLLAMA_CLOUD_RECOMMENDATIONS_TTL_MS,
            models: []
          })
        }
        return []
      }

      const data = await decodeProviderJson(
        response,
        OllamaCloudRecommendationsSchema,
        {
          providerId: this.id,
          providerName: this.config.name,
          baseUrl,
          label: "cloud recommendations",
          userMessage: "Ollama returned invalid cloud recommendations."
        }
      )
      const models = data.recommendations
        .filter(({ model }) => model.endsWith(":cloud"))
        .map(
          (recommendation): ProviderModel => ({
            name: recommendation.model,
            model: recommendation.model,
            modified_at: "",
            size: 0,
            digest: `ollama-cloud:${recommendation.model}`,
            details: {
              parent_model: "",
              format: "cloud",
              family: "",
              families: [],
              parameter_size: "",
              quantization_level: ""
            },
            ...(recommendation.context_length != null && {
              capabilityHints: {
                contextLength: recommendation.context_length
              }
            }),
            cloud: {
              ...(recommendation.description && {
                description: recommendation.description
              }),
              ...(recommendation.required_plan && {
                requiredPlan: recommendation.required_plan
              }),
              ...(recommendation.max_output_tokens != null && {
                maxOutputTokens: recommendation.max_output_tokens
              })
            }
          })
        )
      cloudRecommendationCache.set(baseUrl, {
        expiresAt: Date.now() + OLLAMA_CLOUD_RECOMMENDATIONS_TTL_MS,
        models
      })
      return models
    } catch (error) {
      if (signal?.aborted) throw error
      cloudRecommendationCache.set(baseUrl, {
        expiresAt: Date.now() + OLLAMA_CLOUD_RECOMMENDATIONS_RETRY_TTL_MS,
        models: []
      })
      logger.debug(
        "Ollama cloud recommendations are unavailable; using local models only",
        "OllamaProvider"
      )
      return []
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abortFromCaller)
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
   * list request into an unbounded fan-out. A failed lookup leaves that model
   * exactly as `/api/tags` gave it — a blank badge beats a broken list — but an
   * aborted one propagates, because cancellation is not a partial success.
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
        } catch (error) {
          // A cancelled request must not resolve as a partial list: the caller
          // aborted, so it gets the abort, not a catalog missing whatever the
          // backfill had not finished reading.
          if (signal?.aborted) throw error
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
      reasoningEffort,
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
      // `-1` is the app's Auto sentinel. Local Ollama accepts it, but hosted
      // Ollama models reject it with HTTP 400. Omitting the option lets the
      // daemon choose its local or cloud-safe default in both cases. Preserve
      // every other value so existing local-model behavior does not change.
      num_predict: num_predict === -1 ? undefined : num_predict,
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
      think: think ?? toOllamaThink(reasoningEffort),
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
          images?: unknown[]
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
        const parsed = JSON.parse(line)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          logger.warn("Ignored invalid stream chunk", "OllamaProvider")
          return
        }
        data = parsed
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

      const generatedImages = (data.message?.images ?? []).flatMap(
        (value, index) => {
          if (typeof value !== "string") return []
          const image = generatedImageFromBase64(
            value,
            { providerId: this.id, model },
            index
          )
          return image ? [image] : []
        }
      )
      if (generatedImages.length > 0) {
        onChunk({ generatedImages, done: false })
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

  async generateImage(
    request: ImageGenerationRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        stream: true,
        ...(request.images?.length
          ? { images: request.images.map((image) => image.base64) }
          : {})
      }),
      signal
    }).catch((error) =>
      throwProviderConnectionError(error, {
        providerId: this.id,
        providerName: this.config.name,
        model: request.model,
        baseUrl
      })
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw createAppError(`Ollama Error (${response.status}): ${errorText}`, {
        kind: "provider",
        status: response.status,
        providerId: this.id,
        providerName: this.config.name,
        model: request.model,
        baseUrl,
        phase: "response",
        userMessage: providerErrorUserMessage(response.status, {
          providerName: this.config.name,
          model: request.model
        }),
        debug: errorText
      })
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw createAppError("Response body is null", {
        kind: "provider",
        providerId: this.id
      })
    }

    const decoder = new TextDecoder()
    let buffer = ""
    let emitted = false
    const processLine = (line: string) => {
      if (!line.trim()) return
      const data = JSON.parse(line) as {
        image?: string
        completed?: number
        total?: number
        done?: boolean
      }
      if (!data.image) return
      const image = generatedImageFromBase64(data.image, {
        providerId: this.id,
        model: request.model
      })
      if (!image) {
        throw createAppError("Ollama returned invalid generated image data", {
          kind: "provider",
          providerId: this.id,
          model: request.model,
          phase: "read-stream"
        })
      }
      emitted = true
      onChunk({ generatedImages: [image], done: data.done === true })
    }

    try {
      while (true) {
        const { done, value } = await readProviderStreamChunk(reader, {
          providerId: this.id,
          providerName: this.config.name,
          model: request.model,
          baseUrl
        })
        if (done) {
          if (buffer.trim()) processLine(buffer)
          if (!emitted) {
            throw createAppError("Ollama returned no generated image", {
              kind: "provider",
              providerId: this.id,
              model: request.model,
              phase: "read-stream"
            })
          }
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

  private embeddingContext(baseUrl: string) {
    return {
      providerId: ProviderId.OLLAMA,
      providerName: this.config.name,
      baseUrl,
      userMessage: "Ollama returned an invalid embedding response."
    }
  }

  async embed(
    text: string,
    model?: string,
    signal?: AbortSignal
  ): Promise<number[]> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    const targetModel = model || this.config.modelId || "nomic-embed-text"

    // Prefer current endpoint and fall back to legacy endpoint for compatibility.
    try {
      const requestBody = { model: targetModel, input: text }
      const response = await fetch(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        ...(signal ? { signal } : {})
      })

      if (response.ok) {
        return await decodeOllamaEmbedding(
          response,
          this.embeddingContext(baseUrl)
        )
      } else {
        const errorText = await response.text()
        logger.warn(`/api/embed failed: ${response.status}`, "OllamaProvider", {
          error: errorText
        })
      }
    } catch (error) {
      // Continue to legacy fallback — unless the caller cancelled, in which
      // case a second request is exactly the work it asked to stop.
      if (isAbortError(error)) {
        throw error
      }
    }

    try {
      const legacyBody = { model: targetModel, prompt: text }
      const legacyResponse = await fetch(`${baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyBody),
        ...(signal ? { signal } : {})
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

      return await decodeOllamaEmbedding(
        legacyResponse,
        this.embeddingContext(baseUrl)
      )
    } catch (error) {
      logger.error("Both embed endpoints failed", "OllamaProvider", { error })
      throw error
    }
  }

  async embedBatch(
    texts: string[],
    model?: string,
    signal?: AbortSignal
  ): Promise<number[][]> {
    // Ollama doesn't have a native batch embed endpoint that takes multiple prompts in one call (it usually takes one)
    // So we parallelize here
    return Promise.all(texts.map((t) => this.embed(t, model, signal)))
  }
}
