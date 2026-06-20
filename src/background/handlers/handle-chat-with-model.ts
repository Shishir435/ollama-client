import { setAbortController } from "@/background/lib/abort-controller-registry"
import { buildToolSystemGuidance } from "@/background/lib/build-tool-system-guidance"
import { withErrorContext } from "@/background/lib/error-handler"
import { resolveModelTools } from "@/background/lib/resolve-model-tools"
import { streamChatWithTools } from "@/background/lib/stream-chat-with-tools"
import { safePostMessage } from "@/background/lib/utils"
import { DEFAULT_MAX_RAG_CONTEXT_CHARS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { resolveModelConfig } from "@/lib/model-config-utils"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
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

    const ac = new AbortController()
    setAbortController(port.name, ac)

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
    const systemPrompt = modelParams.system || "You are a helpful AI assistant."
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

    // Offer tools only to models that resolve `toolCalling` true; otherwise the
    // request is unchanged and the old context-injection path is used as-is.
    const tools = await resolveModelTools(model, providerId, provider)

    // Tell the model the tools exist and when to use them. Without this, weaker
    // and reasoning-tuned models (e.g. deepseek-r1) ignore the offered tools and
    // hallucinate "I can't access your tabs" instead of calling current_tab.
    // Empty when no tools are offered.
    const guidance = buildToolSystemGuidance(tools)

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
      tools
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

    if (tools && tools.length > 0) {
      const { getToolRegistry } = await import("@/lib/tools")
      const toolResultMaxChars =
        (await plasmoGlobalStorage.get<number>(
          STORAGE_KEYS.CHAT.MAX_TOOL_RESULT_CHARS
        )) ?? undefined
      await streamChatWithTools({
        provider,
        request,
        registry: getToolRegistry(),
        onChunk,
        signal: ac.signal,
        ctx: { signal: ac.signal, sessionId: msg.payload.sessionId, model },
        toolResultMaxChars
      })
    } else {
      await provider.streamChat(request, onChunk, ac.signal)
    }
  },
  {
    handler: "handleChatWithModel",
    operation: "streaming chat"
  }
)
