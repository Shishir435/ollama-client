import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  isRetryableProviderStatus,
  parseRetryAfter,
  providerErrorUserMessage
} from "@/lib/providers/provider-errors"
import type { ToolCall, ToolDefinition } from "@/lib/tools/types"
import type { ChatMessage, ChatStreamMessage, ProviderModel } from "@/types"
import { ANTHROPIC_PROVIDER_CAPABILITIES } from "./capabilities"
import {
  createProviderReplayArtifact,
  getProviderReplayBlocks
} from "./provider-replay"
import { resolveProviderServiceProfile } from "./service-profile"
import type {
  ChatRequest,
  EmbeddingSupport,
  LLMProvider,
  ProviderConfig
} from "./types"
import { ProviderServiceProfile } from "./types"

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
const ANTHROPIC_VERSION = "2023-06-01"

type AnthropicContentBlock = Record<string, unknown>
interface AnthropicMessage {
  role: "user" | "assistant"
  content: AnthropicContentBlock[]
}

const textBlock = (text: string): AnthropicContentBlock => ({
  type: "text",
  text
})

const appendMessage = (
  messages: AnthropicMessage[],
  role: AnthropicMessage["role"],
  blocks: AnthropicContentBlock[]
) => {
  if (blocks.length === 0) return
  const previous = messages.at(-1)
  if (previous?.role === role) {
    previous.content.push(...blocks)
    return
  }
  messages.push({ role, content: blocks })
}

/**
 * Convert app messages to native Claude Messages API content blocks.
 * Tool results are user blocks keyed by `tool_use_id`; consecutive results are
 * merged into one user turn as required by multi-tool calls.
 */
const mapMessages = (
  messages: ChatMessage[],
  expectedReplay: { providerId: string; model: string }
): { system?: string; messages: AnthropicMessage[] } => {
  const system = messages
    .filter((message) => message.role === "system" && message.content.trim())
    .map((message) => message.content)
    .join("\n")
  const mapped: AnthropicMessage[] = []

  for (const message of messages) {
    if (message.role === "system") continue

    if (message.role === "tool") {
      appendMessage(mapped, "user", [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
          // Denials and failed executions must read as errors, or Claude
          // treats the failure text as a successful result and reasons on.
          is_error: message.toolIsError === true
        }
      ])
      continue
    }

    if (message.role === "assistant") {
      const replayBlocks = getProviderReplayBlocks(message.replayArtifact, {
        wire: "anthropic",
        ...expectedReplay
      })
      if (replayBlocks) {
        appendMessage(mapped, "assistant", replayBlocks)
        continue
      }
    }

    const blocks: AnthropicContentBlock[] = []
    if (message.content) blocks.push(textBlock(message.content))

    if (message.role === "assistant" && message.toolCalls?.length) {
      blocks.push(
        ...message.toolCalls.map((call) => ({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments ?? {}
        }))
      )
    }

    if (message.role === "user" && message.images?.length) {
      blocks.push(
        ...message.images.map((image) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mimeType,
            data: image.base64
          }
        }))
      )
    }

    appendMessage(
      mapped,
      message.role === "assistant" ? "assistant" : "user",
      blocks
    )
  }

  return { system: system || undefined, messages: mapped }
}

const mapTool = (tool: ToolDefinition) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters
})

interface AnthropicStreamEvent {
  type?: string
  index?: number
  content_block?: {
    type?: string
    id?: string
    name?: string
    text?: string
    thinking?: string
    signature?: string
    data?: string
    input?: Record<string, unknown>
  }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    signature?: string
    partial_json?: string
  }
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string; type?: string }
}

export class AnthropicProvider implements LLMProvider {
  id: string
  capabilities = { ...ANTHROPIC_PROVIDER_CAPABILITIES }

  constructor(public config: ProviderConfig) {
    this.id = String(config.id)
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(
      /\/+$/,
      ""
    )
  }

  private headers(): Record<string, string> {
    const brandedAnthropic =
      resolveProviderServiceProfile(this.config) ===
      ProviderServiceProfile.ANTHROPIC
    return {
      "content-type": "application/json",
      ...(this.config.apiKey ? { "x-api-key": this.config.apiKey } : {}),
      "anthropic-version": ANTHROPIC_VERSION,
      ...(brandedAnthropic
        ? { "anthropic-dangerous-direct-browser-access": "true" }
        : {})
    }
  }

  private async responseError(response: Response): Promise<never> {
    const detail = await response.text()
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"))
    throw createAppError(`Anthropic Error (${response.status}): ${detail}`, {
      kind: "provider",
      status: response.status,
      providerId: this.id,
      retryable: isRetryableProviderStatus(response.status),
      retryAfterMs,
      userMessage: providerErrorUserMessage(response.status, {
        baseUrl: this.baseUrl,
        retryAfterMs
      }),
      debug: detail
    })
  }

  async getModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
      ...(signal ? { signal } : {})
    })
    if (!response.ok) {
      await this.responseError(response)
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; display_name?: string; created_at?: string }>
    }
    return (payload.data ?? [])
      .filter((model): model is typeof model & { id: string } =>
        Boolean(model.id)
      )
      .map((model) => ({
        name: model.id,
        model: model.id,
        modified_at: model.created_at || new Date().toISOString(),
        size: 0,
        digest: model.id,
        details: {
          parent_model: "",
          format: "anthropic",
          family: "anthropic",
          families: ["anthropic"],
          parameter_size: "",
          quantization_level: ""
        }
      }))
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const mapped = mapMessages(request.messages, {
      providerId: this.id,
      model: request.model
    })
    const tools =
      request.tool_choice === "none" ? undefined : request.tools?.map(mapTool)
    const assistantToolTurns = request.messages.filter(
      (message) => message.role === "assistant" && message.toolCalls?.length
    )
    const hasToolHistory = request.messages.some(
      (message) => message.role === "tool" || message.toolCalls?.length
    )
    const hasReplayableToolHistory =
      assistantToolTurns.length > 0 &&
      assistantToolTurns.every((message) =>
        Boolean(
          getProviderReplayBlocks(message.replayArtifact, {
            wire: "anthropic",
            providerId: this.id,
            model: request.model
          })
        )
      )
    // Thinking may continue through auto/none tool turns now that signed and
    // redacted blocks are replayed. Old/incomplete checkpoints keep the prior
    // safe degradation, and Anthropic still rejects forced tool choice.
    const thinkEnabled =
      Boolean(request.think) &&
      request.tool_choice !== "required" &&
      (!hasToolHistory || hasReplayableToolHistory)
    // num_predict:-1 (and 0) is our "unlimited" sentinel; Anthropic requires a
    // positive max_tokens, so collapse non-positive requests to a real default
    // instead of forwarding -1 or deriving a bogus thinking budget from it.
    const rawMaxTokens = request.max_tokens ?? request.num_predict ?? 4096
    const requestedMaxTokens = rawMaxTokens > 0 ? rawMaxTokens : 4096
    // Thinking needs budget_tokens ≥ 1024 and max_tokens strictly above it —
    // grow the cap rather than silently dropping thinking when the configured
    // num_predict is small. Sampling params must stay at their defaults while
    // thinking; the API rejects temperature/top_p overrides.
    const thinkingBudget = Math.max(1024, Math.floor(requestedMaxTokens / 2))
    const body = {
      model: request.model,
      messages: mapped.messages,
      system: mapped.system,
      stream: true,
      max_tokens: thinkEnabled
        ? Math.max(requestedMaxTokens, thinkingBudget + 1024)
        : requestedMaxTokens,
      thinking: thinkEnabled
        ? { type: "enabled" as const, budget_tokens: thinkingBudget }
        : undefined,
      temperature:
        thinkEnabled || request.temperature === undefined
          ? undefined
          : Math.min(1, Math.max(0, request.temperature)),
      top_p: thinkEnabled ? undefined : request.top_p,
      stop_sequences: request.stop,
      tools: tools?.length ? tools : undefined,
      tool_choice:
        tools?.length && request.tool_choice === "required"
          ? { type: "any" }
          : tools?.length
            ? { type: "auto" }
            : undefined
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal
    })
    if (!response.ok) {
      await this.responseError(response)
    }

    await this.processSSE(response, onChunk, Date.now(), request.model)
  }

  private async processSSE(
    response: Response,
    onChunk: (chunk: ChatStreamMessage) => void,
    startTime: number,
    model: string
  ): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) {
      throw createAppError("Response body is null", {
        kind: "provider",
        providerId: this.id
      })
    }

    const decoder = new TextDecoder()
    const toolBlocks = new Map<
      number,
      { id: string; name: string; input: string }
    >()
    const contentBlocks = new Map<number, AnthropicContentBlock>()
    let buffer = ""
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let emittedDone = false

    const replayArtifact = () => {
      const blocks = [...contentBlocks.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, block]) => block)
      const hasReasoning = blocks.some(
        (block) =>
          block.type === "thinking" || block.type === "redacted_thinking"
      )
      return hasReasoning
        ? createProviderReplayArtifact("anthropic", this.id, model, blocks)
        : undefined
    }

    const emitDone = () => {
      if (emittedDone) return
      emittedDone = true
      const toolCalls: ToolCall[] = [...toolBlocks.values()].map(
        (block, index) => {
          let args: Record<string, unknown> = {}
          try {
            const parsed = block.input ? JSON.parse(block.input) : {}
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              args = parsed as Record<string, unknown>
            }
          } catch {
            // Malformed model JSON becomes empty args; registry validation
            // returns a model-visible tool error instead of crashing the turn.
          }
          return {
            id: block.id || `${block.name || "tool"}_${index}`,
            name: block.name,
            arguments: args
          }
        }
      )
      for (const [index, tool] of toolBlocks) {
        let input: Record<string, unknown> = {}
        try {
          const parsed = tool.input ? JSON.parse(tool.input) : {}
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>
          }
        } catch {
          // The normalized tool call below intentionally uses the same empty
          // input fallback so replay and execution cannot diverge.
        }
        contentBlocks.set(index, {
          ...contentBlocks.get(index),
          type: "tool_use",
          id: tool.id,
          name: tool.name,
          input
        })
      }
      const artifact = replayArtifact()
      if (toolCalls.length) {
        onChunk({ toolCalls, replayArtifact: artifact, done: false })
      }
      onChunk({
        done: true,
        replayArtifact: artifact,
        metrics: {
          total_duration: (Date.now() - startTime) * 1_000_000,
          prompt_eval_count: inputTokens,
          eval_count: outputTokens
        }
      })
    }

    const processLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data: ")) return
      let event: AnthropicStreamEvent
      try {
        event = JSON.parse(trimmed.slice(6)) as AnthropicStreamEvent
      } catch (error) {
        logger.warn(
          "Failed to parse Anthropic SSE event",
          "AnthropicProvider",
          {
            error
          }
        )
        return
      }

      if (event.type === "error") {
        throw createAppError(
          event.error?.message || "Anthropic stream returned an error.",
          {
            kind: "provider",
            providerId: this.id,
            retryable: event.error?.type === "overloaded_error",
            debug: event.error
          }
        )
      }
      if (event.type === "message_start") {
        inputTokens = event.message?.usage?.input_tokens
        outputTokens = event.message?.usage?.output_tokens
        return
      }
      if (
        event.type === "content_block_start" &&
        typeof event.index === "number"
      ) {
        const block = event.content_block
        if (block?.type === "tool_use") {
          toolBlocks.set(event.index, {
            id: block.id || "",
            name: block.name || "",
            input: ""
          })
          contentBlocks.set(event.index, {
            ...block,
            type: "tool_use",
            id: block.id || "",
            name: block.name || "",
            input: block.input || {}
          })
        } else if (block?.type === "thinking") {
          contentBlocks.set(event.index, {
            ...block,
            type: "thinking",
            thinking: block.thinking || "",
            signature: block.signature || ""
          })
        } else if (
          block?.type === "redacted_thinking" &&
          typeof block.data === "string"
        ) {
          contentBlocks.set(event.index, {
            ...block,
            type: "redacted_thinking",
            data: block.data
          })
        } else if (block?.type === "text") {
          contentBlocks.set(event.index, {
            ...block,
            type: "text",
            text: block.text || ""
          })
        } else if (block?.type) {
          // Preserve unknown blocks so wire validation fails locally instead
          // of silently replaying an altered assistant message.
          contentBlocks.set(event.index, { ...block })
        }
        return
      }
      if (event.type === "content_block_delta") {
        if (event.delta?.type === "text_delta" && event.delta.text) {
          if (typeof event.index === "number") {
            const block = contentBlocks.get(event.index)
            if (block?.type === "text") {
              block.text = `${String(block.text)}${event.delta.text}`
            }
          }
          onChunk({ delta: event.delta.text, done: false })
        } else if (
          event.delta?.type === "thinking_delta" &&
          event.delta.thinking
        ) {
          if (typeof event.index === "number") {
            const block = contentBlocks.get(event.index)
            if (block?.type === "thinking") {
              block.thinking = `${String(block.thinking)}${event.delta.thinking}`
            }
          }
          onChunk({ thinkingDelta: event.delta.thinking, done: false })
        } else if (
          event.delta?.type === "signature_delta" &&
          event.delta.signature &&
          typeof event.index === "number"
        ) {
          const block = contentBlocks.get(event.index)
          if (block?.type === "thinking") {
            block.signature = `${String(block.signature)}${event.delta.signature}`
          }
        } else if (
          event.delta?.type === "input_json_delta" &&
          typeof event.index === "number"
        ) {
          const block = toolBlocks.get(event.index)
          if (block) block.input += event.delta.partial_json || ""
        }
        return
      }
      if (event.type === "message_delta") {
        if (typeof event.usage?.output_tokens === "number") {
          outputTokens = event.usage.output_tokens
        }
        return
      }
      if (event.type === "message_stop") emitDone()
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          if (buffer.trim()) processLine(buffer)
          emitDone()
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

  async getModelDetails(): Promise<null> {
    return null
  }

  async getEmbeddingSupport(): Promise<EmbeddingSupport> {
    return {
      supported: false,
      mode: "none",
      notes: "Anthropic does not expose an embeddings endpoint."
    }
  }
}
