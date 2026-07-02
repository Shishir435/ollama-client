import {
  clearAbortController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import { buildToolSystemGuidance } from "@/background/lib/build-tool-system-guidance"
import { withErrorContext } from "@/background/lib/error-handler"
import { resolveModelTools } from "@/background/lib/resolve-model-tools"
import { streamChatWithNonNativeTools } from "@/background/lib/stream-chat-with-non-native-tools"
import { streamChatWithTools } from "@/background/lib/stream-chat-with-tools"
import { safePostMessage } from "@/background/lib/utils"
import { DEFAULT_MAX_RAG_CONTEXT_CHARS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { resolveModelConfig } from "@/lib/model-config-utils"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import { getSession } from "@/lib/repositories/chat-history"
import type {
  ChatMessage,
  ChatStreamMessage,
  ChatWithModelMessage,
  ModelConfigMap
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

/**
 * Main handler for streaming chat interactions.
 * Features:
 * 1. Model-specific context window limiting.
 * 2. Automated memory/RAG injection from past conversations.
 * 3. Dynamic system prompt assembly.
 * 4. Cross-origin safe message streaming via browser ports.
 */
export const handleChatWithModel = withErrorContext(
  async (msg: ChatWithModelMessage, port, isPortClosed) => {
    const { model, providerId, messages } = msg.payload
    const abortKey = msg.payload.requestId || port.abortScopeKey || port.name

    const ac = new AbortController()
    setAbortController(abortKey, ac)

    const modelConfigMap =
      (await plasmoGlobalStorage.get<ModelConfigMap>(
        STORAGE_KEYS.PROVIDER.MODEL_CONFIGS
      )) ?? {}
    const modelParams = resolveModelConfig(modelConfigMap[model])

    const limitedMessages = limitMessagesForModel(model, messages)
    const preparedMessages = [...limitedMessages]

    // --- System Prompt & Context Injection ---
    const isMemoryEnabled =
      (await plasmoGlobalStorage.get<boolean>(STORAGE_KEYS.MEMORY.ENABLED)) ??
      true
    // A per-chat system prompt override, when set, replaces the model's
    // configured prompt for this session only. Empty/whitespace is ignored, and
    // a failed read degrades to the model default rather than breaking the turn.
    let sessionSystemPrompt: string | undefined
    if (msg.payload.sessionId) {
      try {
        const session = await getSession(msg.payload.sessionId)
        sessionSystemPrompt = session?.systemPrompt?.trim() || undefined
      } catch (error) {
        logger.debug(
          "Failed to read per-chat system prompt",
          "handleChatWithModel",
          { error }
        )
      }
    }
    const systemPrompt =
      sessionSystemPrompt ||
      modelParams.system ||
      "You are a helpful AI assistant."
    let contextHeader = ""

    if (isMemoryEnabled && messages.length > 0) {
      const lastUserMessage = messages[messages.length - 1]
      if (lastUserMessage.role === "user") {
        // Dynamic import to reduce bundle size
        const { retrieveContextEnhanced, formatEnhancedResults } = await import(
          "@/features/chat/rag/rag-pipeline"
        )

        const enhancedResults = await retrieveContextEnhanced(
          lastUserMessage.content,
          { type: "chat" }
        )
        if (enhancedResults.length > 0) {
          const { formattedContext, sources } =
            formatEnhancedResults(enhancedResults)

          // Enforce the prompt-budget ceiling (same setting the client RAG path
          // uses) so a large set of recalled memories can't blow the model's
          // context window. `<= 0` means unlimited.
          const maxRagChars =
            (await plasmoGlobalStorage.get<number>(
              STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS
            )) ?? DEFAULT_MAX_RAG_CONTEXT_CHARS
          const truncationMarker = "\n\n[Context truncated due to length]"
          const cappedContext =
            maxRagChars > 0 && formattedContext.length > maxRagChars
              ? `${formattedContext.slice(
                  0,
                  Math.max(0, maxRagChars - truncationMarker.length)
                )}${truncationMarker}`
              : formattedContext

          logger.info(
            `Injected ${enhancedResults.length} past context items`,
            "handleChatWithModel",
            {
              contextChars: cappedContext.length,
              truncated: cappedContext.length < formattedContext.length
            }
          )

          try {
            port.postMessage({
              type: "rag_sources",
              payload: { sources, query: lastUserMessage.content }
            })
          } catch (e) {
            logger.warn("Failed to send RAG sources", "handleChatWithModel", {
              error: e
            })
          }
          contextHeader = `\n\nIMPORTANT: You have access to context from previous conversations:\n${cappedContext}\n\nUse this context to provide personalized responses.`
        }
      }
    }

    // Get Provider
    const provider = await ProviderFactory.getProviderForModel(
      model,
      providerId
    )

    // Resolve tools + how to drive them. Native models get an OpenAI/Ollama tool
    // array; models opted into the prompt-based fallback get a non-native loop;
    // everything else gets no tools and the old context-injection path as-is.
    const resolvedTools = await resolveModelTools(model, providerId, provider)
    // Only the native path sends a tools array + the native system guidance; the
    // non-native path injects its own protocol prompt inside its streamer.
    const nativeTools =
      resolvedTools?.mode === "native" ? resolvedTools.tools : undefined

    // Tell the model the tools exist and when to use them. Without this, weaker
    // and reasoning-tuned models (e.g. deepseek-r1) ignore the offered tools and
    // hallucinate "I can't access your tabs" instead of calling current_tab.
    // Empty when no tools are offered natively.
    const guidance = buildToolSystemGuidance(nativeTools)

    // Build the system message in one place: append the RAG context header and
    // tool guidance to an existing system message, or prepend one from the
    // default/system prompt. Single construction means guidance can never be
    // silently dropped, regardless of whether the user kept a system prompt.
    const systemMsgIndex = preparedMessages.findIndex(
      (m) => m.role === "system"
    )
    if (systemMsgIndex !== -1) {
      preparedMessages[systemMsgIndex] = {
        ...preparedMessages[systemMsgIndex],
        content:
          preparedMessages[systemMsgIndex].content + contextHeader + guidance
      }
    } else {
      preparedMessages.unshift({
        role: "system",
        content: systemPrompt + contextHeader + guidance
      })
    }
    // -----------------------------------

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
      tools: nativeTools
      // provider handles system prompt if needed, but we already injected it into messages
      // so we pass the prepared messages
    }

    const onChunk = (chunk: ChatStreamMessage) => {
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
      safePostMessage(port, chunk)
    }

    try {
      if (resolvedTools && resolvedTools.tools.length > 0) {
        const { getToolRegistry } = await import("@/lib/tools")
        const toolResultMaxChars =
          (await plasmoGlobalStorage.get<number>(
            STORAGE_KEYS.CHAT.MAX_TOOL_RESULT_CHARS
          )) ?? undefined
        const ctx = {
          signal: ac.signal,
          sessionId: msg.payload.sessionId,
          model
        }
        if (resolvedTools.mode === "non-native") {
          await streamChatWithNonNativeTools({
            provider,
            request,
            tools: resolvedTools.tools,
            registry: getToolRegistry(),
            onChunk,
            signal: ac.signal,
            ctx,
            toolResultMaxChars
          })
        } else {
          await streamChatWithTools({
            provider,
            request,
            registry: getToolRegistry(),
            onChunk,
            signal: ac.signal,
            ctx,
            toolResultMaxChars
          })
        }
      } else {
        await provider.streamChat(request, onChunk, ac.signal)
      }
    } finally {
      clearAbortController(abortKey)
    }
  },
  {
    handler: "handleChatWithModel",
    operation: "streaming chat"
  }
)
