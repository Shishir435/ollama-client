import { useCallback } from "react"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"
import { requestMessageIndexing } from "@/protocol/embedding-client"
import type { ChatMessage } from "@/types"

/** The panel submits ids; the background owns chunking, writes and recovery. */
export const useAutoEmbedMessages = () => {
  const [isEnabled] = useSetting(SETTINGS.MEMORY_ENABLED)
  const embedMessages = useCallback(
    async (
      messages: ChatMessage[],
      _sessionId: string,
      isStreaming = false
    ): Promise<void> => {
      if (!isEnabled || isStreaming) return
      const ids = messages.flatMap((message) =>
        typeof message.id === "number" &&
        (message.role === "user" ||
          (message.role === "assistant" && message.done === true)) &&
        !message.metrics?.permissionNotice
          ? [message.id]
          : []
      )
      for (let index = 0; index < ids.length; index += 100)
        await requestMessageIndexing(ids.slice(index, index + 100))
    },
    [isEnabled]
  )
  const embedMessage = useCallback(
    (message: ChatMessage, sessionId: string) =>
      embedMessages([message], sessionId),
    [embedMessages]
  )
  return { embedMessage, embedMessages, isEnabled }
}
