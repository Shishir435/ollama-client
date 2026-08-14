import type { ChatStreamClaim } from "@/features/chat/hooks/use-chat-stream"
import { logger } from "@/lib/logger"
import type { OptionalApiPermission } from "@/lib/permissions"
import type { ChatMessage } from "@/types"

export type PermissionResumeResult =
  | "started"
  | "permission-denied"
  | "resume-failed"

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

/** Grant optional access and resume the original turn without losing recovery. */
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
}: ResumePermissionTurnOptions): Promise<PermissionResumeResult> => {
  const notice = message.metrics?.permissionNotice
  if (!notice || typeof message.id !== "number" || !sessionId) {
    return "resume-failed"
  }
  const noticeMessageId = message.id

  // This must remain the first async browser operation: callers invoke this
  // directly from a button click, preserving the browser's user gesture.
  if (!(await requestPermissions(notice.missingPermissions))) {
    return "permission-denied"
  }

  const messageIndex = messages.findIndex((item) => item.id === noticeMessageId)
  if (messageIndex === -1) return "resume-failed"

  let prevUserIndex = -1
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      prevUserIndex = index
      break
    }
  }
  if (prevUserIndex === -1) return "resume-failed"

  const streamClaim = claimStream()
  if (!streamClaim) return "resume-failed"
  let submitted = false
  const restoreNotice = async () => {
    try {
      await navigateToNode(sessionId, noticeMessageId, true)
    } catch (error) {
      // The notice remains durable even if refreshing the visible branch fails.
      logger.error("Failed to restore permission notice branch", "Chat", {
        error,
        sessionId,
        messageId: noticeMessageId
      })
    }
  }

  try {
    const userMessage = messages[prevUserIndex]
    if (userMessage.id) await navigateToNode(sessionId, userMessage.id, true)
    submitted = await generateResponse(
      message.model,
      sessionId,
      messages.slice(0, prevUserIndex + 1),
      { mode: "regenerate", streamClaim }
    )
    if (!submitted) {
      await restoreNotice()
      return "resume-failed"
    }

    // A response row and stream now exist. The recovery action is no longer
    // needed and can be removed without risking an unanswered dead end.
    try {
      await deleteMessage(noticeMessageId)
    } catch (error) {
      // Generation already owns the active branch. A stale notice sibling is
      // preferable to disrupting the started response.
      logger.error("Failed to remove resumed permission notice", "Chat", {
        error,
        sessionId,
        messageId: noticeMessageId
      })
    }
    return "started"
  } catch (error) {
    logger.error("Failed to resume permission-blocked turn", "Chat", {
      error,
      sessionId,
      messageId: noticeMessageId
    })
    await restoreNotice()
    return "resume-failed"
  } finally {
    if (!submitted) releaseStreamClaim(streamClaim)
  }
}
