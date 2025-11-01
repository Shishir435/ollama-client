import { DEFAULT_MODEL_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { handleChatStream } from "@/background/handlers/handle-chat-stream"
import {
  clearAbortController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import { getBaseUrl, safePostMessage } from "@/background/lib/utils"
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
  const { model, messages } = msg.payload
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

    await handleChatStream(response, port, isPortClosed)
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
