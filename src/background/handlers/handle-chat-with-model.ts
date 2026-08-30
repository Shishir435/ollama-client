import {
  clearAbortController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import { buildToolSystemGuidance } from "@/background/lib/build-tool-system-guidance"
import { withErrorContext } from "@/background/lib/error-handler"
import {
  resolveModelCapabilities,
  resolveModelTools
} from "@/background/lib/resolve-model-tools"
import { hasRetrievalTool } from "@/background/lib/retrieval-tools"
import { safePostChatStreamEvent } from "@/background/lib/runtime-delivery"
import { streamChatWithNonNativeTools } from "@/background/lib/stream-chat-with-non-native-tools"
import { streamChatWithTools } from "@/background/lib/stream-chat-with-tools"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  getStoredModelConfig,
  resolveModelConfig
} from "@/lib/model-config-utils"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { ProviderFactory } from "@/lib/providers/factory"
import { assertProviderEnabled } from "@/lib/providers/provider-policy"
import { getSession } from "@/lib/repositories/chat-history"
import {
  deleteToolLoopRun,
  getToolLoopRun,
  saveToolLoopRun,
  type ToolLoopMode
} from "@/lib/repositories/tool-loop-runs"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { CHAT_STREAM_EVENT_TYPES } from "@/protocol/streams"
import type {
  ChatMessage,
  ChatStreamMessage,
  ChatStreamSink,
  ChatWithModelMessage,
  PortStatusFunction
} from "@/types"

/**
 * Limits the number of messages sent to the model to stay within context window constraints.
 * Specifically targets Small Language Models (SLMs) like those in the 135M-0.6B parameter range
 * which typically have very shallow context windows.
 *
 * When truncating, the system prompt (if present) is preserved so the user-configured
 * behaviour is not silently lost.
 */
const limitMessagesForModel = (
  model: string,
  messages: ChatMessage[]
): ChatMessage[] => {
  if (model.includes("135m") || model.includes("0.6b")) {
    const systemMsg = messages.find((m) => m.role === "system")
    const nonSystem = messages.filter((m) => m.role !== "system")
    const limit = systemMsg ? 4 : 5
    const result = nonSystem.slice(-limit)
    if (systemMsg) result.unshift(systemMsg)
    return result
  }
  return messages
}

const getSessionSystemPrompt = async (
  sessionId?: string
): Promise<string | undefined> => {
  if (!sessionId) return undefined
  try {
    const session = await getSession(sessionId)
    return session?.systemPrompt?.trim() || undefined
  } catch (error) {
    logger.debug(
      "Failed to read per-chat system prompt",
      "handleChatWithModel",
      { error }
    )
    return undefined
  }
}

const latestUserMessage = (messages: ChatMessage[]): ChatMessage | undefined =>
  [...messages].reverse().find((message) => message.role === "user")

const capContext = (formattedContext: string, maxChars: number): string => {
  if (maxChars <= 0 || formattedContext.length <= maxChars) {
    return formattedContext
  }
  const marker = "\n\n[Context truncated due to length]"
  return `${formattedContext.slice(0, Math.max(0, maxChars - marker.length))}${marker}`
}

const buildMemoryContextHeader = async ({
  enabled,
  clientContextPrepared,
  retrievalToolsActive,
  conversationMessages,
  port
}: {
  enabled: boolean
  clientContextPrepared?: boolean
  retrievalToolsActive: boolean
  conversationMessages: ChatMessage[]
  port: ChatStreamSink
}): Promise<string> => {
  if (!enabled || clientContextPrepared || retrievalToolsActive) return ""
  const lastUserMessage = conversationMessages[conversationMessages.length - 1]
  if (!lastUserMessage || lastUserMessage.role !== "user") return ""

  const { retrieveContextEnhanced, formatEnhancedResults } = await import(
    "@/application/context/rag/rag-pipeline"
  )
  const enhancedResults = await retrieveContextEnhanced(
    lastUserMessage.content,
    {
      type: "chat"
    }
  )
  if (enhancedResults.length === 0) return ""

  const { formattedContext, sources } = formatEnhancedResults(enhancedResults)
  const maxRagChars = await readSetting(SETTINGS.MAX_RAG_CONTEXT_CHARS)
  const cappedContext = capContext(formattedContext, maxRagChars)

  logger.info(
    `Injected ${enhancedResults.length} past context items`,
    "handleChatWithModel",
    {
      contextChars: cappedContext.length,
      truncated: cappedContext.length < formattedContext.length
    }
  )

  try {
    safePostChatStreamEvent(port, {
      version: 1,
      type: CHAT_STREAM_EVENT_TYPES.RAG_SOURCES,
      payload: { sources, query: lastUserMessage.content }
    })
  } catch (error) {
    logger.warn("Failed to send RAG sources", "handleChatWithModel", { error })
  }

  return `\n\nIMPORTANT: You have access to context from previous conversations:\n${cappedContext}\n\nUse this context to provide personalized responses.`
}

const injectSystemMessage = (
  messages: ChatMessage[],
  systemPrompt: string,
  contextHeader: string,
  guidance: string
): void => {
  const systemIndex = messages.findIndex((message) => message.role === "system")
  if (systemIndex === -1) {
    messages.unshift({
      role: "system",
      content: systemPrompt + contextHeader + guidance
    })
    return
  }
  messages[systemIndex] = {
    ...messages[systemIndex],
    content: messages[systemIndex].content + contextHeader + guidance
  }
}

const createChunkHandler = (
  port: ChatStreamSink,
  isPortClosed: PortStatusFunction
) => {
  port.streamSequence = 0
  return (chunk: ChatStreamMessage) => {
    if (isPortClosed()) return

    if (process.env.NODE_ENV === "development") {
      logger.debug("Chat stream chunk", "ChatStream", {
        hasDelta: typeof chunk.delta === "string" && chunk.delta.length > 0,
        deltaPreview:
          typeof chunk.delta === "string"
            ? chunk.delta.slice(0, 120)
            : undefined,
        hasThinkingDelta:
          typeof chunk.thinkingDelta === "string" &&
          chunk.thinkingDelta.length > 0,
        done: chunk.done,
        error: chunk.error
      })
    }
    const seq = port.streamSequence ?? 0
    port.streamSequence = seq + 1
    safePostChatStreamEvent(port, {
      version: 1,
      type: CHAT_STREAM_EVENT_TYPES.CHUNK,
      ...chunk,
      seq
    })
  }
}

/**
 * Main handler for streaming chat interactions.
 * Features:
 * 1. Model-specific context window limiting.
 * 2. Automated memory/RAG injection from past conversations.
 * 3. Dynamic system prompt assembly.
 * 4. Cross-origin safe message streaming via browser ports.
 */
export const handleChatWithModel = withErrorContext(
  async (
    msg: ChatWithModelMessage,
    port: ChatStreamSink,
    isPortClosed: PortStatusFunction
  ) => {
    const { model, providerId, messages } = msg.payload
    const abortKey = msg.payload.requestId || port.abortScopeKey || port.name
    const ac = new AbortController()
    setAbortController(abortKey, ac)

    const modelConfigMap = await readSetting(SETTINGS.MODEL_CONFIGS)
    const modelParams = resolveModelConfig(
      getStoredModelConfig(modelConfigMap, model, providerId)
    )
    const conversationMessages = messages.filter(
      (message) => !message.metrics?.permissionNotice
    )
    const preparedMessages = [
      ...limitMessagesForModel(model, conversationMessages)
    ]
    const isMemoryEnabled = await readSetting(SETTINGS.MEMORY_ENABLED)
    const sessionSystemPrompt = await getSessionSystemPrompt(
      msg.payload.sessionId
    )
    const systemPrompt =
      sessionSystemPrompt ||
      modelParams.system ||
      "You are a helpful AI assistant."

    const provider = await ProviderFactory.getProviderForModel(
      model,
      providerId
    )
    assertProviderEnabled(provider, model)

    const latestUserText = latestUserMessage(conversationMessages)?.content
    const resolvedCapabilities = await resolveModelCapabilities(
      model,
      providerId,
      provider,
      ac.signal
    )
    const { capabilities } = resolvedCapabilities
    const imageGenerator = capabilities.imageOutput
      ? provider.generateImage
      : undefined
    if (capabilities.imageOutput && !imageGenerator) {
      throw createAppError("Provider does not support image generation.", {
        kind: "validation",
        status: 400,
        code: "OLC-INPUT-UNSUPPORTED",
        phase: "configuration",
        providerId: provider.id,
        providerName: provider.config.name,
        model,
        userMessage:
          "This provider cannot generate images. Disable the image-output override or choose another provider."
      })
    }

    const resolvedTools = imageGenerator
      ? null
      : await resolveModelTools(
          model,
          providerId,
          provider,
          latestUserText,
          resolvedCapabilities,
          ac.signal
        )
    const nativeTools =
      resolvedTools?.mode === "native" ? resolvedTools.tools : undefined
    const contextHeader = await buildMemoryContextHeader({
      enabled: isMemoryEnabled,
      clientContextPrepared: msg.payload.clientContextPrepared,
      retrievalToolsActive: hasRetrievalTool(resolvedTools),
      conversationMessages,
      port
    })
    injectSystemMessage(
      preparedMessages,
      systemPrompt,
      contextHeader,
      buildToolSystemGuidance(nativeTools)
    )

    const request = {
      model,
      messages: preparedMessages,
      temperature: modelParams.temperature,
      top_p: modelParams.top_p,
      top_k: modelParams.top_k,
      repeat_penalty: modelParams.repeat_penalty,
      repeat_last_n: modelParams.repeat_last_n,
      seed: modelParams.seed,
      num_ctx: modelParams.num_ctx,
      num_predict: modelParams.num_predict,
      min_p: modelParams.min_p,
      stop: modelParams.stop,
      num_thread: modelParams.num_thread,
      num_gpu: modelParams.num_gpu,
      num_batch: modelParams.num_batch,
      keep_alive: modelParams.keep_alive,
      reasoningEffort: modelParams.reasoning_effort,
      tools: nativeTools
    }
    const onChunk = createChunkHandler(port, isPortClosed)

    const runImageGeneration = async () => {
      if (!imageGenerator) return false
      const userMessage = latestUserMessage(conversationMessages)
      await imageGenerator.call(
        provider,
        {
          model,
          prompt: userMessage?.content ?? "",
          images: userMessage?.images
        },
        onChunk,
        ac.signal
      )
      return true
    }

    const runToolGeneration = async () => {
      if (!resolvedTools || resolvedTools.tools.length === 0) return false
      const { getToolRegistry } = await import("@/lib/tools")
      const toolResultMaxChars = await readSetting(
        SETTINGS.MAX_TOOL_RESULT_CHARS
      )
      const ctx = {
        signal: ac.signal,
        sessionId: msg.payload.sessionId,
        model
      }
      const mode: ToolLoopMode = resolvedTools.mode
      const durableRun = msg.payload.requestId
        ? await getToolLoopRun(msg.payload.requestId)
        : null
      const initialState =
        durableRun &&
        durableRun.model === model &&
        durableRun.mode === mode &&
        durableRun.sessionId === msg.payload.sessionId
          ? durableRun.state
          : undefined
      const onCheckpoint = msg.payload.requestId
        ? async (
            state: NonNullable<typeof initialState>,
            awaitingConfirmation: boolean
          ) => {
            await saveToolLoopRun({
              requestId: msg.payload.requestId as string,
              sessionId: msg.payload.sessionId,
              model,
              providerId,
              mode,
              status: awaitingConfirmation
                ? "awaiting-confirmation"
                : "running",
              state,
              updatedAt: Date.now()
            })
          }
        : undefined

      try {
        if (resolvedTools.mode === "non-native") {
          await streamChatWithNonNativeTools({
            provider,
            request,
            tools: resolvedTools.tools,
            registry: getToolRegistry(),
            onChunk,
            signal: ac.signal,
            ctx,
            toolResultMaxChars,
            initialState,
            onCheckpoint
          })
        } else {
          await streamChatWithTools({
            provider,
            request,
            registry: getToolRegistry(),
            onChunk,
            signal: ac.signal,
            ctx,
            toolResultMaxChars,
            toolResultMode:
              resolvedTools.mode === "native-user-results" ? "user" : "tool",
            initialState,
            onCheckpoint
          })
        }
      } finally {
        if (msg.payload.requestId) {
          await deleteToolLoopRun(msg.payload.requestId).catch((error) => {
            logger.warn(
              "Failed to remove completed tool-loop checkpoint",
              "handleChatWithModel",
              { error }
            )
          })
        }
      }
      return true
    }

    try {
      if (await runImageGeneration()) return
      if (await runToolGeneration()) return
      await provider.streamChat(request, onChunk, ac.signal)
    } finally {
      clearAbortController(abortKey)
    }
  },
  {
    handler: "handleChatWithModel",
    operation: "streaming chat",
    resolveDiagnosticSessionId: (msg) => msg.payload.sessionId,
    resolveProviderErrorContext: async (msg) => {
      const { model, providerId } = msg.payload
      const provider = await ProviderFactory.getProviderForModel(
        model,
        providerId
      )
      return {
        providerId: provider.id,
        providerName: provider.config.name,
        model,
        baseUrl: resolveProviderBaseUrl(provider.config)
      }
    }
  }
)
