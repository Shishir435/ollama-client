import type { RuntimeContext } from "../runtime"
import type { ChatChunk, ChatRequest } from "../types"

export type ChatResult = {
  text: string
  chunks: ChatChunk[]
}

export const runChat = async (
  runtime: RuntimeContext,
  request: ChatRequest & { providerId?: string }
): Promise<ChatResult> => {
  const provider = await runtime.resolveProviderForModel(
    request.model,
    request.providerId
  )

  let text = ""
  const chunks: ChatChunk[] = []

  await provider.streamChat(request, {
    onChunk: (chunk) => {
      chunks.push(chunk)
      if (chunk.delta) {
        text += chunk.delta
      }
    }
  })

  return { text, chunks }
}
