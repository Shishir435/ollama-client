import { RuntimeContext } from "@olc/core"
import { render } from "ink"
import React, { useMemo, useState } from "react"
import type { ChatMessage } from "../ui/app"
import { Repl, type ReplMessage } from "../ui/repl"

const createId = () => Math.random().toString(36).slice(2)

export const runChatCommand = async (model: string, providerId?: string) => {
  const messages: ChatMessage[] = []
  const runtime = new RuntimeContext()

  const App = () => {
    const [state, setState] = useState<ChatMessage[]>(messages)
    const [status, setStatus] = useState<string | undefined>("Connected")

    const handleSubmit = async (input: string) => {
      const next: ChatMessage = {
        id: createId(),
        role: "user" as const,
        content: input
      }

      const reply: ChatMessage = {
        id: createId(),
        role: "assistant" as const,
        content: ""
      }

      setStatus("Thinking...")
      setState((current) => [...current, next])
      setState((current) => [...current, reply])

      const provider = await runtime.resolveProviderForModel(model, providerId)
      await provider.streamChat(
        {
          model,
          messages: [
            ...state
              .filter((message) => message.id)
              .map((message) => ({
                role: message.role,
                content: message.content
              })),
            { role: "user", content: input }
          ],
          stream: true
        },
        {
          onChunk: (chunk) => {
            if (chunk.delta) {
              setState((current) =>
                current.map((message) =>
                  message.id === reply.id
                    ? {
                        ...message,
                        content: `${message.content}${chunk.delta}`
                      }
                    : message
                )
              )
            }

            if (chunk.done) {
              setStatus("Ready")
            }
          }
        }
      )
    }

    const replMessages: ReplMessage[] = useMemo(
      () => state.map((message) => ({ ...message })),
      [state]
    )

    return (
      <Repl onSubmit={handleSubmit} messages={replMessages} status={status} />
    )
  }

  render(<App />)
}
