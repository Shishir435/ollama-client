import {
  isRetryableProviderStatus,
  parseRetryAfter
} from "@ollama-client/runtime-core/retry"
import { z } from "zod"
import { createAppError } from "@/lib/error-utils"
import { toDataUrl } from "@/lib/image-utils"
import { logger } from "@/lib/logger"
import {
  classifyProviderError,
  providerErrorUserMessage,
  readProviderStreamChunk,
  throwProviderConnectionError,
  throwProviderResponseError
} from "@/lib/providers/provider-errors"
import type { ToolCall, ToolDefinition } from "@/lib/tools/types"
import type { ChatMessage, ChatStreamMessage, ProviderModel } from "@/types"
import { resolveProviderBaseUrl } from "./base-url"
import { OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES } from "./capabilities"
import {
  decodeOpenAIEmbedding,
  decodeOpenAIEmbeddingBatch
} from "./embedding-response"
import { generatedImageFromBase64 } from "./generated-image"
import { parameterSizeFromModelId } from "./model-id-metadata"
import {
  createProviderReplayArtifact,
  getProviderReplayBlocks
} from "./provider-replay"
import {
  buildOpenAIReasoningFields,
  hasAuthoritativeReasoningCatalog,
  isReasoningEffortActive,
  resolveReasoningEffortSupport
} from "./reasoning-effort"
import { decodeProviderJson } from "./response-decoding"
import {
  getOpenAIServiceCompatibility,
  resolveProviderServiceProfile
} from "./service-profile"
import {
  type ChatRequest,
  type EmbeddingSupport,
  type ImageGenerationRequest,
  type LLMProvider,
  type ProviderConfig,
  ProviderId,
  ProviderServiceProfile
} from "./types"

const isCatalogRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const extractOpenAIOutputParts = (
  content: unknown,
  images: unknown
): { text: string; imageData: string[] } => {
  const text: string[] = []
  const imageData: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      text.push(value)
      return
    }
    const record = asRecord(value)
    if (!record) return
    if (typeof record.text === "string") text.push(record.text)
    const imageUrl = asRecord(record.image_url)?.url
    const inlineData = asRecord(record.inline_data)?.data
    const candidate =
      (typeof record.b64_json === "string" && record.b64_json) ||
      (typeof record.image_base64 === "string" && record.image_base64) ||
      (typeof inlineData === "string" && inlineData) ||
      (typeof imageUrl === "string" && imageUrl.startsWith("data:image/")
        ? imageUrl
        : undefined)
    if (candidate) imageData.push(candidate)
  }
  if (Array.isArray(content)) content.forEach(visit)
  else visit(content)
  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === "string") imageData.push(image)
      else visit(image)
    }
  }
  return { text: text.join(""), imageData }
}

const OpenAIImageGenerationResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            b64_json: z.string().optional(),
            url: z.string().optional()
          })
          .passthrough()
      )
      .max(8)
  })
  .passthrough()

const normalizeCatalogNumber = (value: unknown): number | undefined => {
  const candidate =
    typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : value
  return typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= 0
    ? candidate
    : undefined
}

const normalizeCatalogStrings = (
  value: unknown,
  maxItems = 100
): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const strings = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ].slice(0, maxItems)
  return strings.length > 0 ? strings : undefined
}

const CatalogNumberSchema = z
  .unknown()
  .transform((value) => normalizeCatalogNumber(value))
const CatalogStringsSchema = z
  .unknown()
  .transform((value) => normalizeCatalogStrings(value))
const CatalogModalitiesSchema = z
  .unknown()
  .transform((value) => normalizeCatalogStrings(value, 50))

const ReasoningEffortLevelSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
])

const OpenRouterReasoningSchema = z
  .object({
    supported_efforts: z
      .union([z.array(ReasoningEffortLevelSchema).max(10), z.null()])
      .optional(),
    default_effort: z
      .union([ReasoningEffortLevelSchema, z.literal("none")])
      .optional(),
    default_enabled: z.boolean().optional(),
    mandatory: z.boolean().optional()
  })
  .passthrough()

const OpenAIModelCatalogItemSchema = z
  .object({
    id: z.string().trim().min(1),
    // Catalogs use several names for the same context-window fact. Zero is a
    // common unknown sentinel and remains omitted from normalized hints.
    context_length: CatalogNumberSchema.optional(),
    context_window: CatalogNumberSchema.optional(),
    max_context_length: CatalogNumberSchema.optional(),
    contextLength: CatalogNumberSchema.optional(),
    max_model_len: CatalogNumberSchema.optional(),
    architecture: z.unknown().optional(),
    input_modalities: CatalogModalitiesSchema.optional(),
    output_modalities: CatalogModalitiesSchema.optional(),
    supported_parameters: CatalogStringsSchema.optional(),
    supported_sampling_parameters: CatalogStringsSchema.optional(),
    capabilities: z.unknown().optional(),
    supportsImageInput: z.unknown().optional(),
    supportsTools: z.unknown().optional(),
    reasoning: OpenRouterReasoningSchema.optional()
  })
  .passthrough()
  .transform((model) => {
    const architecture = isCatalogRecord(model.architecture)
      ? model.architecture
      : undefined
    const capabilities = isCatalogRecord(model.capabilities)
      ? model.capabilities
      : undefined
    const contextLength = [
      model.context_length,
      model.context_window,
      model.max_context_length,
      model.contextLength,
      model.max_model_len
    ].find((value) => typeof value === "number" && value > 0)
    const reportedModalities =
      model.input_modalities ??
      normalizeCatalogStrings(architecture?.input_modalities, 50)
    const outputModalities =
      model.output_modalities ??
      normalizeCatalogStrings(architecture?.output_modalities, 50)
    const reportsVision =
      capabilities?.vision === true || model.supportsImageInput === true
    const modalities = reportedModalities
      ? [
          ...new Set([
            ...reportedModalities,
            ...(reportsVision ? ["image"] : [])
          ])
        ]
      : reportsVision
        ? ["text", "image"]
        : undefined
    const reportedParameters =
      model.supported_parameters ?? model.supported_sampling_parameters
    const reportsTools =
      capabilities?.function_calling === true || model.supportsTools === true
    const supportedParameters = reportedParameters
      ? [
          ...new Set([
            ...reportedParameters,
            ...(reportsTools ? ["tools"] : [])
          ])
        ]
      : reportsTools
        ? ["tools"]
        : undefined

    return {
      ...model,
      contextLength,
      modalities,
      outputModalities,
      supportedParameters
    }
  })

const OpenAIModelCatalogSchema = z
  .union([
    z
      .object({ data: z.array(z.unknown()) })
      .passthrough()
      .transform(({ data }) => data),
    z.array(z.unknown())
  ])
  .transform((items, context) => {
    const data: Array<z.infer<typeof OpenAIModelCatalogItemSchema>> = []
    let rejectedCount = 0
    for (const item of items) {
      const parsed = OpenAIModelCatalogItemSchema.safeParse(item)
      if (parsed.success) data.push(parsed.data)
      else rejectedCount += 1
    }

    if (items.length > 0 && data.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Model catalog contains no valid model identifiers"
      })
      return z.NEVER
    }
    return { data, rejectedCount }
  })

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

  private responseError(
    response: Response,
    label: string,
    baseUrl: string,
    model?: string
  ): Promise<never> {
    return throwProviderResponseError(response, {
      label,
      providerId: this.id,
      baseUrl,
      providerName: this.config.name,
      model
    })
  }

  private embeddingContext(baseUrl: string) {
    return {
      providerId: this.id,
      providerName: this.config.name,
      baseUrl,
      userMessage: "The provider returned an invalid embedding response."
    }
  }

  async getModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: this.headers(),
        ...(signal ? { signal } : {})
      })
      if (!response.ok) {
        await this.responseError(response, "Model list failed", baseUrl)
      }
      const catalog = await decodeProviderJson(
        response,
        OpenAIModelCatalogSchema,
        {
          providerId: this.id,
          providerName: this.config.name,
          baseUrl,
          label: "model catalog",
          userMessage: "The provider returned an invalid model list."
        }
      )
      if (catalog.rejectedCount > 0) {
        logger.warn(
          "Ignored malformed entries in provider model catalog",
          "OpenAICompatibleProvider",
          {
            providerId: this.id,
            rejectedCount: catalog.rejectedCount,
            acceptedCount: catalog.data.length
          }
        )
      }
      return catalog.data.map((m) => {
        const reasoning = m.reasoning
          ? resolveReasoningEffortSupport(this.config, m.id, {
              ...(m.reasoning.supported_efforts !== undefined
                ? { supportedEfforts: m.reasoning.supported_efforts }
                : {}),
              ...(m.reasoning.default_effort
                ? { defaultEffort: m.reasoning.default_effort }
                : {}),
              ...(m.reasoning.default_enabled !== undefined
                ? { defaultEnabled: m.reasoning.default_enabled }
                : {}),
              ...(m.reasoning.mandatory !== undefined
                ? { mandatory: m.reasoning.mandatory }
                : {})
            })
          : hasAuthoritativeReasoningCatalog(this.config)
            ? undefined
            : resolveReasoningEffortSupport(this.config, m.id)
        return {
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
            // `/v1/models` reports no size: the OpenAI schema has no field for
            // one, and neither vLLM, LocalAI, KoboldCPP, nor an LM Studio
            // fallback list adds one. So a self-hosted "Qwen3-8B" showed a
            // blank badge beside genuine sizes from Ollama and llama.cpp. The
            // id is the only source, and the parser refuses ambiguous ids
            // rather than guessing, so hosted catalogs naming no size (gpt-4o)
            // stay blank instead of inventing one.
            parameter_size: parameterSizeFromModelId(m.id),
            quantization_level: ""
          },
          ...((m.contextLength ||
            m.modalities ||
            m.outputModalities ||
            m.supportedParameters ||
            reasoning) && {
            capabilityHints: {
              ...(m.contextLength ? { contextLength: m.contextLength } : {}),
              ...(m.modalities && {
                modalities: m.modalities
              }),
              ...(m.outputModalities && {
                outputModalities: m.outputModalities
              }),
              ...(m.supportedParameters && {
                supportedParameters: m.supportedParameters
              }),
              ...(reasoning && { reasoning })
            }
          })
        }
      })
    } catch (e) {
      if (!signal?.aborted) {
        logger.error("Failed to fetch models", "OpenAICompatibleProvider", {
          error: e
        })
      }
      throw e
    }
  }

  async generateImage(
    request: ImageGenerationRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        response_format: "b64_json"
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

    if ([404, 405, 501].includes(response.status)) {
      // Some OpenAI-compatible servers generate images as multimodal chat
      // output instead of implementing the Images endpoint. Reuse the normal
      // stream adapter so inline image parts still reach the shared contract.
      await this.streamChat(
        {
          model: request.model,
          messages: [
            {
              role: "user",
              content: request.prompt,
              images: request.images
            }
          ]
        },
        onChunk,
        signal
      )
      return
    }
    if (!response.ok) {
      await this.responseError(
        response,
        "Image generation error",
        baseUrl,
        request.model
      )
    }

    const result = await decodeProviderJson(
      response,
      OpenAIImageGenerationResponseSchema,
      {
        providerId: this.id,
        providerName: this.config.name,
        baseUrl,
        label: "image generation response",
        userMessage:
          "The provider returned an invalid image generation response."
      }
    )
    const generatedImages = result.data.flatMap((item, index) => {
      if (!item.b64_json) return []
      const image = generatedImageFromBase64(
        item.b64_json,
        { providerId: this.id, model: request.model },
        index
      )
      return image ? [image] : []
    })
    if (generatedImages.length === 0) {
      throw createAppError(
        result.data.some((item) => item.url)
          ? "The provider returned image URLs after base64 output was requested."
          : "The provider returned no valid generated images.",
        {
          kind: "provider",
          providerId: this.id,
          model: request.model,
          phase: "response",
          userMessage:
            "The provider completed image generation but returned no image data the extension can store."
        }
      )
    }
    onChunk({ generatedImages, done: true })
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
      reasoningEffort,
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
      temperature: isReasoningEffortActive(reasoningEffort, this.config, model)
        ? undefined
        : temperature,
      top_p: isReasoningEffortActive(reasoningEffort, this.config, model)
        ? undefined
        : top_p,
      tools: hasTools ? tools.map(toOpenAITool) : undefined,
      // tool_choice is only valid alongside a tools array; omit it otherwise.
      tool_choice: hasTools ? tool_choice : undefined,
      ...buildOpenAIReasoningFields(this.config, reasoningEffort)
    }
    if (outputTokens !== undefined) {
      body[compatibility.maxTokensField] = outputTokens
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
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
      await this.responseError(response, "OpenAI Error", baseUrl, model)
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

    type TerminalMarker = "finish-reason" | "done" | null
    const OpenAiSseDataSchema = z
      .object({
        error: z.unknown().optional(),
        choices: z
          .array(
            z
              .object({
                delta: z
                  .object({
                    content: z.unknown().optional(),
                    images: z.unknown().optional(),
                    reasoning: z.string().optional(),
                    reasoning_content: z.string().optional(),
                    thinking: z.string().optional(),
                    thoughts: z.string().optional(),
                    reasoning_details: z.array(z.unknown()).optional(),
                    tool_calls: z.array(z.unknown()).optional()
                  })
                  .passthrough()
                  .optional(),
                finish_reason: z.string().nullable().optional()
              })
              .passthrough()
          )
          .optional(),
        usage: z
          .object({
            prompt_tokens: z.number().optional(),
            completion_tokens: z.number().optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
    type OpenAiSseData = z.infer<typeof OpenAiSseDataSchema>

    const parseSseData = (
      line: string
    ): OpenAiSseData | TerminalMarker | null => {
      const trimmed = line.trim()
      if (!trimmed) return null
      if (trimmed === "data: [DONE]") return "done"
      if (!trimmed.startsWith("data: ")) return null
      try {
        const parsed = asRecord(JSON.parse(trimmed.slice(6)))
        if (!parsed) {
          logger.warn(
            "Ignored invalid SSE data event",
            "OpenAICompatibleProvider"
          )
          return null
        }
        const decoded = OpenAiSseDataSchema.safeParse(parsed)
        if (!decoded.success) {
          logger.warn(
            "Ignored invalid SSE data event",
            "OpenAICompatibleProvider",
            { issues: decoded.error.issues }
          )
          return null
        }
        return decoded.data
      } catch (error) {
        logger.warn(
          "Failed to parse SSE data line",
          "OpenAICompatibleProvider",
          {
            error
          }
        )
        return null
      }
    }

    const throwSseError = (data: OpenAiSseData): void => {
      if (!data.error) return
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
      const classification = classifyProviderError(status, message)
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
          code:
            status === undefined ? "OLC-PROVIDER-HTTP" : classification.code,
          phase: "read-stream",
          recoveryAction: classification.recoveryAction,
          providerName: this.config.name,
          model,
          baseUrl,
          userMessage:
            status === undefined
              ? classification.reason
                ? `${this.config.name} reported an error while generating the response. ${classification.reason}`
                : `${this.config.name} reported an error while generating the response. Check its server logs and configuration.`
              : providerErrorUserMessage(status, {
                  baseUrl,
                  retryAfterMs,
                  providerName: this.config.name,
                  model,
                  reason: classification.reason
                }),
          debug:
            typeof data.error === "string"
              ? data.error
              : JSON.stringify(data.error)
        }
      )
    }

    const captureReplayDetails = (
      delta: NonNullable<OpenAiSseData["choices"]>[number]["delta"]
    ): void => {
      if (!captureReasoningDetails || !Array.isArray(delta?.reasoning_details))
        return
      for (const detail of delta.reasoning_details) {
        const record = asRecord(detail)
        if (record) reasoningDetails.push(record)
      }
    }

    const emitReasoning = (
      delta: NonNullable<OpenAiSseData["choices"]>[number]["delta"]
    ): void => {
      const thinkingDelta =
        delta?.reasoning ||
        delta?.reasoning_content ||
        delta?.thinking ||
        delta?.thoughts
      if (thinkingDelta) onChunk({ thinkingDelta, done: false })
    }

    const emitOutput = (
      delta: NonNullable<OpenAiSseData["choices"]>[number]["delta"]
    ): void => {
      const output = extractOpenAIOutputParts(delta?.content, delta?.images)
      if (output.text) {
        firstTokenTime ??= Date.now()
        onChunk({ delta: output.text, done: false })
      }
      const generatedImages = output.imageData.flatMap((value, index) => {
        const image = generatedImageFromBase64(
          value,
          { providerId: this.id, model },
          index
        )
        return image ? [image] : []
      })
      if (generatedImages.length > 0) onChunk({ generatedImages, done: false })
    }

    const accumulateToolCalls = (
      delta: NonNullable<OpenAiSseData["choices"]>[number]["delta"]
    ): void => {
      if (!Array.isArray(delta?.tool_calls)) return
      const fragments = delta.tool_calls.filter(
        (fragment): fragment is ToolCallFragment => {
          const record = asRecord(fragment)
          return Boolean(
            record &&
              Number.isInteger(record.index) &&
              Number(record.index) >= 0
          )
        }
      )
      toolCalls.add(fragments)
    }

    const updateUsage = (usage: OpenAiSseData["usage"]): void => {
      if (!usage) return
      const totalDurationNs = (Date.now() - startTime) * 1_000_000
      const evalDurationNs = firstTokenTime
        ? (Date.now() - firstTokenTime) * 1_000_000
        : 1
      const promptEvalDurationNs = firstTokenTime
        ? (firstTokenTime - startTime) * 1_000_000
        : totalDurationNs
      latestMetrics = {
        total_duration: totalDurationNs,
        prompt_eval_count: usage.prompt_tokens,
        prompt_eval_duration: promptEvalDurationNs,
        eval_count: usage.completion_tokens,
        eval_duration: evalDurationNs
      }
      onChunk({ done: false, metrics: latestMetrics })
    }

    const processLine = (line: string): TerminalMarker => {
      const parsed = parseSseData(line)
      if (parsed === "done") return "done"
      if (!parsed || typeof parsed === "string") return null
      const data = parsed
      throwSseError(data)
      const choice = data.choices?.[0]
      const delta = choice?.delta
      captureReplayDetails(delta)
      emitReasoning(delta)
      emitOutput(delta)
      accumulateToolCalls(delta)
      if (choice?.finish_reason === "tool_calls") emitToolCalls()
      updateUsage(data.usage)
      return typeof choice?.finish_reason === "string" &&
        choice.finish_reason.length > 0
        ? "finish-reason"
        : null
    }

    const finishStream = () => {
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
    }

    const bufferedTerminalMarker = (): TerminalMarker => {
      const trimmed = buffer.trim()
      if (trimmed === "data: [DONE]") return "done"
      if (!trimmed.startsWith("data: ")) return null
      try {
        const data = asRecord(JSON.parse(trimmed.slice(6)))
        const choices = Array.isArray(data?.choices) ? data.choices : []
        const finishReason = asRecord(choices[0])?.finish_reason
        return typeof finishReason === "string" && finishReason.length > 0
          ? "finish-reason"
          : null
      } catch {
        // A fetch chunk may split one SSE JSON object at any byte. Keep
        // buffering partial JSON without logging a parse warning.
        return null
      }
    }

    const TERMINAL_GRACE_MS = 250
    let terminalMarker: TerminalMarker = null
    let terminalDeadline = 0
    const readNextChunk = async () => {
      const read = readProviderStreamChunk(reader, {
        providerId: this.id,
        providerName: this.config.name,
        model,
        baseUrl: resolveProviderBaseUrl(this.config)
      })
      if (terminalMarker !== "finish-reason") {
        return { timedOut: false as const, result: await read }
      }
      const remaining = Math.max(0, terminalDeadline - Date.now())
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const timed = await Promise.race([
        read.then((result) => ({ timedOut: false as const, result })),
        new Promise<{ timedOut: true }>((resolve) => {
          timeoutId = setTimeout(() => resolve({ timedOut: true }), remaining)
        })
      ])
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      return timed
    }

    const decodeChunkMarker = (value: Uint8Array): TerminalMarker => {
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""
      let marker: TerminalMarker = null
      for (const line of lines) {
        const lineMarker = processLine(line)
        if (lineMarker === "done") return "done"
        if (!marker && lineMarker) marker = lineMarker
      }
      const bufferedMarker = bufferedTerminalMarker()
      if (!marker && bufferedMarker) {
        marker = processLine(buffer)
        buffer = ""
      }
      return marker
    }

    const finishAndCancel = async (): Promise<void> => {
      finishStream()
      await reader.cancel()
    }

    const consumeStream = async (): Promise<void> => {
      while (true) {
        const next = await readNextChunk()
        if (next.timedOut) {
          await finishAndCancel()
          return
        }
        const { done, value } = next.result
        if (done) {
          if (buffer.trim()) processLine(buffer)
          buffer = ""
          finishStream()
          return
        }
        const chunkMarker = decodeChunkMarker(value)
        if (chunkMarker === "done") {
          await finishAndCancel()
          return
        }
        if (chunkMarker === "finish-reason" && terminalMarker === null) {
          terminalMarker = chunkMarker
          terminalDeadline = Date.now() + TERMINAL_GRACE_MS
        }
      }
    }

    try {
      await consumeStream()
    } finally {
      reader.releaseLock()
    }
  }
  async getModelDetails(_model: string, _signal?: AbortSignal): Promise<null> {
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

  async embed(
    text: string,
    model?: string,
    signal?: AbortSignal
  ): Promise<number[]> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    const targetModel = model || this.config.modelId || "text-embedding-3-small"
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: targetModel, input: text }),
      ...(signal ? { signal } : {})
    })

    if (!response.ok) {
      await this.responseError(response, "OpenAI Embedding Error", baseUrl)
    }

    return decodeOpenAIEmbedding(response, this.embeddingContext(baseUrl))
  }

  async embedBatch(
    texts: string[],
    model?: string,
    signal?: AbortSignal
  ): Promise<number[][]> {
    const baseUrl = resolveProviderBaseUrl(this.config)
    const targetModel = model || this.config.modelId || "text-embedding-3-small"
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: targetModel, input: texts }),
      ...(signal ? { signal } : {})
    })

    if (!response.ok) {
      await this.responseError(response, "OpenAI Embedding Error", baseUrl)
    }

    return decodeOpenAIEmbeddingBatch(
      response,
      texts.length,
      this.embeddingContext(baseUrl)
    )
  }
}
