import { setAbortController } from "@/background/lib/abort-controller-registry"
import { withErrorContext } from "@/background/lib/error-handler"
import { safePostMessage } from "@/background/lib/utils"
// Dynamic import to reduce bundle size
// import {
//   formatEnhancedResults,
//   retrieveContextEnhanced
// } from "@/features/chat/rag/rag-pipeline"
import { DEFAULT_MODEL_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import type { ChatMessage, ChatWithModelMessage, ModelConfigMap } from "@/types"

/**
 * Limits the number of messages sent to the model to stay within context window constraints.
 * Specifically targets Small Language Models (SLMs) like those in the 135M-0.6B parameter range
 * which typically have very shallow context windows.
 */
const limitMessagesForModel = (
  model: string,
  messages: ChatMessage[]
): ChatMessage[] => {
  if (model.includes("135m") || model.includes("0.6b")) {
    return messages.slice(-5) // Only last 5 messages for small models
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
    const { model, messages } = msg.payload

    const ac = new AbortController()
    setAbortController(port.name, ac)

    const modelConfigMap =
      (await plasmoGlobalStorage.get<ModelConfigMap>(
        STORAGE_KEYS.PROVIDER.MODEL_CONFIGS
      )) ?? {}
    const modelParams = modelConfigMap[model] ?? DEFAULT_MODEL_CONFIG

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
          logger.info(
            `Injected ${enhancedResults.length} past context items`,
            "handleChatWithModel"
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
          contextHeader = `\n\nIMPORTANT: You have access to context from previous conversations:\n${formattedContext}\n\nUse this context to provide personalized responses.`
        }
      }
    }

    const systemMsgIndex = preparedMessages.findIndex(
      (m) => m.role === "system"
    )
    if (systemMsgIndex !== -1) {
      if (contextHeader) {
        preparedMessages[systemMsgIndex] = {
          ...preparedMessages[systemMsgIndex],
          content: preparedMessages[systemMsgIndex].content + contextHeader
        }
      }
    } else {
      preparedMessages.unshift({
        role: "system",
        content: systemPrompt + contextHeader
      })
    }
    // -----------------------------------

    // Get Provider
    const provider = await ProviderFactory.getProviderForModel(model)

    await provider.streamChat(
      {
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
        keep_alive: modelParams.keep_alive
        // provider handles system prompt if needed, but we already injected it into messages
        // so we pass the prepared messages
      },
      (chunk) => {
        if (isPortClosed()) return

        if (process.env.NODE_ENV === "development") {
          console.log("[ChatStream] chunk", {
            hasDelta: typeof chunk.delta === "string" && chunk.delta.length > 0,
            deltaPreview:
              typeof chunk.delta === "string"
                ? chunk.delta.slice(0, 120)
                : undefined,
            hasThinkingDelta:
              typeof chunk.thinkingDelta === "string" &&
              chunk.thinkingDelta.length > 0,
            thinkingPreview:
              typeof chunk.thinkingDelta === "string"
                ? chunk.thinkingDelta.slice(0, 120)
                : undefined,
            done: chunk.done,
            error: chunk.error
          })
        }
        safePostMessage(port, chunk)
      },
      ac.signal
    )
  },
  {
    handler: "handleChatWithModel",
    operation: "streaming chat"
  }
)
