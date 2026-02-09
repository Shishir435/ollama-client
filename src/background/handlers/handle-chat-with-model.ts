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

const limitMessagesForModel = (
  model: string,
  messages: ChatMessage[]
): ChatMessage[] => {
  if (model.includes("135m") || model.includes("0.6b")) {
    return messages.slice(-5) // Only last 5 messages for small models
  }
  return messages
}

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
        temperature: modelParams.temperature
        // provider handles system prompt if needed, but we already injected it into messages
        // so we pass the prepared messages
      },
      (chunk) => {
        if (isPortClosed()) return

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
