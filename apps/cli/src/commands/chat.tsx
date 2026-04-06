import { render } from "ink"
import React, { useMemo, useState } from "react"
import type { ChatMessage } from "../ui/app"
import { Repl, type ReplMessage } from "../ui/repl"

const createId = () => Math.random().toString(36).slice(2)

export const runChatCommand = async () => {
  const messages: ChatMessage[] = []

  const App = () => {
    const [state, setState] = useState<ChatMessage[]>(messages)
    const [status, setStatus] = useState<string | undefined>("Connected")

    const handleSubmit = async (input: string) => {
      const next = {
        id: createId(),
        role: "user" as const,
        content: input
      }

      const reply = {
        id: createId(),
        role: "assistant" as const,
        content: `Echo: ${input}`
      }

      setStatus("Thinking...")
      setState((current) => [...current, next])

      await new Promise((resolve) => setTimeout(resolve, 200))

      setState((current) => [...current, reply])
      setStatus("Ready")
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
