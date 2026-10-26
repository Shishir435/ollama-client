import type { ChatStreamClaim } from "@/features/chat/hooks/use-chat-stream"
import { hydrateMessageImages } from "@/features/sessions/lib/image-bytes"
import type { ChatMessage } from "@/types"

interface RegenerateTurnOptions {
  /** The assistant answer to replace. */
  message: ChatMessage
  /** The linear active path, whose last entry is the branch's tip. */
  messages: ChatMessage[]
  sessionId: string | null
  model?: string
  claimStream: () => ChatStreamClaim | null
  releaseStreamClaim: (claim: ChatStreamClaim) => void
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

/**
 * Ask for a new answer to the user message that produced `message`.
 *
 * The new answer has to attach beside the old one, so the branch is rewound to
 * the user message first. Anything that fails before a stream exists puts the
 * branch back at the tip the user was looking at — not at the answer being
 * replaced, which would hide every later message — and the stream claim is
 * always given back.
 */
export const regenerateTurn = async ({
  message,
  messages,
  sessionId,
  model,
  claimStream,
  releaseStreamClaim,
  navigateToNode,
  generateResponse
}: RegenerateTurnOptions): Promise<void> => {
  const messageIndex = messages.findIndex((item) => item.id === message.id)
  if (messageIndex === -1) return

  let prevUserIndex = -1
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      prevUserIndex = index
      break
    }
  }
  if (prevUserIndex === -1 || !sessionId) return

  const streamClaim = claimStream()
  if (!streamClaim) return
  let submitted = false
  let rewound = false
  const originalLeafId = messages.at(-1)?.id
  try {
    const prevUserMessage = messages[prevUserIndex]

    // The pictures the model is to be shown are read before the branch moves:
    // a failure here leaves the conversation exactly as it was.
    const contextMessages = await hydrateMessageImages(
      messages.slice(0, prevUserIndex + 1)
    )

    // `exact` stops AT the user message instead of following it on to its old
    // children, so the new answer becomes a sibling of the old one.
    if (prevUserMessage.id) {
      await navigateToNode(sessionId, prevUserMessage.id, true)
      rewound = true
    }

    // `generateResponse` adds the assistant row, which parents itself to the
    // current leaf: the user message we just rewound to.
    submitted = await generateResponse(model, sessionId, contextMessages, {
      mode: "regenerate",
      streamClaim
    })
  } finally {
    try {
      if (!submitted && rewound && originalLeafId !== undefined)
        await navigateToNode(sessionId, originalLeafId, true)
    } finally {
      if (!submitted) releaseStreamClaim(streamClaim)
    }
  }
}
