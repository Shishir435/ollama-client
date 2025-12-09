import { handleChatStream } from "@/background/handlers/handle-chat-stream"
import {
  clearAbortController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import { memoryManager } from "@/background/lib/memory-manager"
import { getBaseUrl, safePostMessage } from "@/background/lib/utils"
import { DEFAULT_MODEL_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { retrieveContext } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type {
  ChatMessage,
  ChatWithModelMessage,
  ChromePort,
  ModelConfigMap,
  NetworkError,
  OllamaChatRequest,
  PortStatusFunction
} from "@/types"

const limitMessagesForModel = (
  model: string,
  messages: ChatMessage[]
): ChatMessage[] => {
  if (model.includes("135m") || model.includes("0.6b")) {
    return messages.slice(-5) // Only last 5 messages for small models
  }
  return messages
}

export const handleChatWithModel = async (
  msg: ChatWithModelMessage,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> => {
  const { model, messages, sessionId, chatId } = msg.payload
  const baseUrl = await getBaseUrl()

  // Always create a fresh AbortController
  const ac = new AbortController()

  setAbortController(port.name, ac)

  const modelConfigMap =
    (await plasmoGlobalStorage.get<ModelConfigMap>(
      STORAGE_KEYS.OLLAMA.MODEL_CONFIGS
    )) ?? {}
  const modelParams = modelConfigMap[model] ?? DEFAULT_MODEL_CONFIG

  try {
    const limitedMessages = limitMessagesForModel(model, messages)

    let preparedMessages = [...limitedMessages]

    // --- Contextual Memory Injection ---
    const isMemoryEnabled = await plasmoGlobalStorage.get<boolean>(
      STORAGE_KEYS.MEMORY.ENABLED
    )

    logger.verbose("Memory status check", "handleChatWithModel", {
      isMemoryEnabled,
      messageCount: messages.length
    })

    if (isMemoryEnabled && messages.length > 0) {
      const lastUserMessage = messages[messages.length - 1]
      if (lastUserMessage.role === "user") {
        const context = await retrieveContext(
          lastUserMessage.content,
          sessionId || "unknown"
        )

        if (context.length > 0) {
          logger.info(
            `Injected ${context.length} past context items`,
            "handleChatWithModel",
            {
              contextCount: context.length
            }
          )
          const contextString = context.map((c) => `- ${c}`).join("\n")
          const systemContext = `

IMPORTANT: You have access to context from previous conversations with this user:
${contextString}

Use this information to provide personalized and contextually aware responses. When the user asks about past conversations or information they've shared, refer to this context.`

          // Inject into system message if exists, or create one
          const systemMsgIndex = preparedMessages.findIndex(
            (m) => m.role === "system"
          )
          if (systemMsgIndex !== -1) {
            preparedMessages[systemMsgIndex] = {
              ...preparedMessages[systemMsgIndex],
              content: preparedMessages[systemMsgIndex].content + systemContext
            }
          } else {
            preparedMessages.unshift({
              role: "system",
              content:
                (modelParams.system || "You are a helpful AI assistant.") +
                systemContext
            })
          }
        }
      }
    }
    // -----------------------------------

    const hasSystemMessage = preparedMessages.some(
      (msg) => msg.role === "system"
    )

    if (modelParams.system && !hasSystemMessage) {
      preparedMessages = [
        { role: "system" as const, content: modelParams.system },
        ...preparedMessages
      ]
    }

    const requestBody: OllamaChatRequest = {
      model,
      messages: preparedMessages,
      stream: true,
      ...modelParams
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: ac.signal
    })

    if (!response.ok) {
      safePostMessage(port, {
        error: { status: response.status, message: response.statusText }
      })
      return
    }

    const fullResponse = await handleChatStream(response, port, isPortClosed)

    // --- Save to Memory ---
    if (isMemoryEnabled && fullResponse && messages.length > 0) {
      const lastUserMessage = messages[messages.length - 1]
      if (lastUserMessage.role === "user") {
        await memoryManager.saveChatToMemory({
          userMessage: lastUserMessage.content,
          aiResponse: fullResponse,
          sessionId: sessionId || "unknown",
          chatId
        })
      }
    }
    // ----------------------
  } catch (err) {
    const error = err as NetworkError

    if (error.name === "AbortError") {
      if (!isPortClosed()) {
        safePostMessage(port, { done: true, aborted: true })
      }
    } else {
      safePostMessage(port, {
        error: {
          status: error.status ?? 0,
          message: error.message || "Unknown error occurred - try regenerating"
        }
      })
    }
  } finally {
    // Always clear the controller after request completes or fails
    clearAbortController(port.name)
  }
}
