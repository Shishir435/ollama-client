import type { ChatMessageParsed } from "@ollama-client/contracts/chat"
import type { ChatMessage } from "./chat"

/** Convert persisted compatibility byte shapes into the app's runtime form. */
export const toRuntimeChatMessage = (
  message: ChatMessageParsed
): ChatMessage => {
  const { attachments, ...rest } = message
  return {
    ...rest,
    ...(attachments
      ? {
          attachments: attachments.map((attachment) => {
            const { data, ...attachmentRest } = attachment
            return {
              ...attachmentRest,
              ...(data !== undefined
                ? {
                    data:
                      data instanceof Uint8Array
                        ? data
                        : Uint8Array.from(
                            Array.isArray(data) ? data : Object.values(data)
                          )
                  }
                : {})
            }
          })
        }
      : {})
  }
}
