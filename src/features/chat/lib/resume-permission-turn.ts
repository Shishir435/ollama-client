import type { ChatStreamClaim } from "@/features/chat/hooks/use-chat-stream"
import type { OptionalApiPermission } from "@/lib/permissions"
import type { ChatMessage } from "@/types"

interface ResumePermissionTurnOptions {
  message: ChatMessage
  messages: ChatMessage[]
  sessionId: string | null
  requestPermissions: (permissions: OptionalApiPermission[]) => Promise<boolean>
  claimStream: () => ChatStreamClaim | null
  releaseStreamClaim: (claim: ChatStreamClaim) => void
  deleteMessage: (messageId: number) => Promise<void>
  navigateToNode: (
    sessionId: string,
    nodeId: number | string,
    exact?: boolean
  ) => Promise<void>
  generateResponse: (
    model: string | undefined,
    sessionId: string,
    messages: ChatMessage[],
    options: { mode: "regenerate"; streamClaim: ChatStreamClaim }
  ) => Promise<boolean>
}

/** Grant optional access, remove the app notice, and resume its original turn. */
export const resumePermissionTurn = async ({
  message,
  messages,
  sessionId,
  requestPermissions,
  claimStream,
  releaseStreamClaim,
  deleteMessage,
  navigateToNode,
  generateResponse
}: ResumePermissionTurnOptions): Promise<boolean> => {
  const notice = message.metrics?.permissionNotice
  if (!notice || typeof message.id !== "number" || !sessionId) return false

  // This must remain the first async browser operation: callers invoke this
  // directly from a button click, preserving the browser's user gesture.
  if (!(await requestPermissions(notice.missingPermissions))) return false

  const messageIndex = messages.findIndex((item) => item.id === message.id)
  if (messageIndex === -1) return false

  let prevUserIndex = -1
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      prevUserIndex = index
      break
    }
  }
  if (prevUserIndex === -1) return false

  const streamClaim = claimStream()
  if (!streamClaim) return false
  let submitted = false
  try {
    const userMessage = messages[prevUserIndex]
    await deleteMessage(message.id)
    if (userMessage.id) await navigateToNode(sessionId, userMessage.id, true)
    submitted = await generateResponse(
      message.model,
      sessionId,
      messages.slice(0, prevUserIndex + 1),
      { mode: "regenerate", streamClaim }
    )
    return submitted
  } finally {
    if (!submitted) releaseStreamClaim(streamClaim)
  }
}
