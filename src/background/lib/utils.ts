import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChatStreamMessage, ChromePort, PullStreamMessage } from "@/types"

export const safePostMessage = (
  port: ChromePort,
  message: ChatStreamMessage | PullStreamMessage
): void => {
  try {
    port.postMessage(message)
  } catch (error) {
    console.warn("Failed to send message to port:", (error as Error).message)
  }
}

export const getBaseUrl = async (): Promise<string> => {
  return (
    ((await plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL)) as string) ??
    "http://localhost:11434"
  )
}

export const getPullAbortControllerKey = (
  portName: string,
  modelName: string
) => {
  return `${portName}:${modelName}`
}
